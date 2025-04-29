import subprocess
import json
import logging
import time
import threading
from database import db
from datetime import datetime, timezone # Added for age calculation
from collections import defaultdict # Import defaultdict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class KubernetesDataUpdater:
    def __init__(self, update_interval: int = 300):  # 5 minutes default
        self.update_interval = update_interval
        self.thread = None
        self.running = False

    def run_kubectl_command(self, command: str) -> dict:
        """Execute kubectl command and return JSON output."""
        try:
            result = subprocess.run(f"kubectl {command} -o json", 
                                 shell=True, 
                                 capture_output=True, 
                                 text=True)
            if result.returncode == 0:
                # Handle potential empty output for commands like get
                if not result.stdout.strip():
                    return {"items": []} 
                return json.loads(result.stdout)
            else:
                logger.error(f"kubectl command failed: {result.stderr}")
                return {}
        except json.JSONDecodeError as e:
            logger.error(f"Error decoding JSON from kubectl: {str(e)} - Output: {result.stdout[:500]}") # Log partial output
            return {}
        except Exception as e:
            logger.error(f"Error running kubectl command: {str(e)}")
            return {}

    def _get_age(self, creation_timestamp_str: str) -> str:
        """Calculate age from creation timestamp string."""
        try:
            if not creation_timestamp_str:
                return 'Unknown'
            # Parse the timestamp (usually RFC3339 format from kubectl)
            created_time = datetime.fromisoformat(creation_timestamp_str.replace('Z', '+00:00'))
            current_time = datetime.now(timezone.utc)
            delta = current_time - created_time
            
            if delta.days > 0:
                return f"{delta.days}d"
            elif delta.seconds >= 3600:
                return f"{delta.seconds // 3600}h"
            elif delta.seconds >= 60:
                return f"{delta.seconds // 60}m"
            else:
                return f"{max(0, delta.seconds)}s" # Ensure non-negative age
        except Exception as e:
            logger.error(f"Error calculating age for {creation_timestamp_str}: {e}")
            return 'Error'

    def _fetch_kubernetes_resources(self, resource_type: str) -> list:
        """Fetch resources using kubectl and add calculated age."""
        try:
            if resource_type == 'pods':
                data = self.run_kubectl_command('get pods --all-namespaces')
                pods = data.get('items', [])
                for pod in pods:
                    pod['age'] = self._get_age(pod.get('metadata', {}).get('creationTimestamp'))
                return pods

            elif resource_type == 'services':
                data = self.run_kubectl_command('get services --all-namespaces')
                services = data.get('items', [])
                for svc in services:
                    svc['age'] = self._get_age(svc.get('metadata', {}).get('creationTimestamp'))
                return services
            
            # Add other resource types here if needed, fetching raw data and adding age

            return [] # Return empty list if resource type not handled
        except Exception as e:
            logger.error(f"Error fetching {resource_type}: {str(e)}")
            return []

    def _get_resource_requests(self, pod: dict, resource_type: str) -> str:
        """Extract resource requests from pod spec."""
        # This function might not be needed anymore if frontend calculates usage, 
        # but keeping it for now in case background tasks use it later.
        try:
            for container in pod.get('spec', {}).get('containers', []):
                requests = container.get('resources', {}).get('requests', {})
                if resource_type in requests:
                    return requests[resource_type]
            return '0'
        except Exception:
            return '0'

    def _update_namespace_metrics(self):
        """Calculate and update namespace metrics in the database."""
        logger.info("Starting namespace metric calculation...")
        try:
            pods = self._fetch_kubernetes_resources('pods')
            if not pods:
                logger.warning("No pods found to calculate metrics.")
                return

            namespace_metrics = defaultdict(lambda: {'cpu_usage': 0, 'memory_usage': 0, 'gpu_usage': 0, 'pod_count': 0})

            for pod in pods:
                metadata = pod.get('metadata', {})
                namespace = metadata.get('namespace', 'default')
                spec = pod.get('spec', {})
                
                namespace_metrics[namespace]['pod_count'] += 1

                if 'containers' in spec:
                    for container in spec['containers']:
                        requests = container.get('resources', {}).get('requests', {})
                        
                        # CPU aggregation (convert to millicores)
                        if 'cpu' in requests:
                            cpu_req = requests['cpu']
                            try:
                                if cpu_req.endswith('m'):
                                    namespace_metrics[namespace]['cpu_usage'] += int(cpu_req[:-1])
                                else:
                                    namespace_metrics[namespace]['cpu_usage'] += int(float(cpu_req) * 1000)
                            except ValueError:
                                logger.warning(f"Could not parse CPU request '{cpu_req}' for pod {metadata.get('name')} in {namespace}")

                        # Memory aggregation (convert to Mi)
                        if 'memory' in requests:
                            mem_req = requests['memory']
                            try:
                                mem_val_mi = 0
                                if mem_req.endswith('Ki'):
                                    mem_val_mi = float(mem_req[:-2]) / 1024
                                elif mem_req.endswith('Mi'):
                                    mem_val_mi = float(mem_req[:-2])
                                elif mem_req.endswith('Gi'):
                                    mem_val_mi = float(mem_req[:-2]) * 1024
                                elif mem_req.endswith('Ti'):
                                    mem_val_mi = float(mem_req[:-2]) * 1024 * 1024
                                # Add Pi, Ei if necessary, or handle raw bytes
                                else: # Assume raw bytes if no unit
                                    mem_val_mi = float(mem_req) / (1024 * 1024)
                                namespace_metrics[namespace]['memory_usage'] += mem_val_mi
                            except ValueError:
                                logger.warning(f"Could not parse Memory request '{mem_req}' for pod {metadata.get('name')} in {namespace}")

                        # GPU aggregation (nvidia.com/gpu)
                        if 'nvidia.com/gpu' in requests:
                            try:
                                namespace_metrics[namespace]['gpu_usage'] += int(requests['nvidia.com/gpu'])
                            except ValueError:
                                logger.warning(f"Could not parse GPU request '{requests['nvidia.com/gpu']}' for pod {metadata.get('name')} in {namespace}")

            # Update database for each namespace
            updated_ns_count = 0
            for namespace, metrics in namespace_metrics.items():
                # Round memory usage for storage/display
                metrics['memory_usage'] = round(metrics['memory_usage'], 2)
                # Store CPU as millicores
                metrics['cpu_usage'] = metrics['cpu_usage']
                
                # Use a composite key or separate calls if DB schema requires it
                # Assuming db.update_metrics takes type, namespace, and data dict
                success_cpu = db.update_metrics('cpu', namespace, metrics)
                success_mem = db.update_metrics('memory', namespace, metrics)
                success_gpu = db.update_metrics('gpu', namespace, metrics)
                
                if success_cpu and success_mem and success_gpu:
                    updated_ns_count += 1
                else:
                    logger.error(f"Failed to update metrics for namespace {namespace}")

            logger.info(f"Successfully calculated and updated metrics for {updated_ns_count} namespaces.")

        except Exception as e:
            logger.error(f"Error calculating or updating namespace metrics: {str(e)}", exc_info=True)

    def _update_resources(self):
        """Update all resources in the database."""
        resource_types = ['pods', 'services'] # Add other types as needed
        
        for resource_type in resource_types:
            try:
                resources = self._fetch_kubernetes_resources(resource_type)
                if resources:
                    # Pass the raw resource dictionaries (with added 'age') to the DB
                    success = db.update_resource(resource_type, resources)
                    if success:
                        logger.info(f"Successfully updated {len(resources)} {resource_type}")
                    else:
                        logger.error(f"Failed to update {resource_type} in database")
                else:
                    # Handle case where fetching might return empty list or None
                    logger.info(f"No {resource_type} found or error fetching, skipping update.")
            except Exception as e:
                logger.error(f"Error updating {resource_type}: {str(e)}")

    def start(self):
        """Start the background updater thread."""
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._run, daemon=True)
            self.thread.start()
            logger.info("Background updater started")

    def _run(self):
        """Run the update loop."""
        while self.running:
            logger.info("Background update cycle started.")
            try:
                # Update resources first
                self._update_resources()
                
                # Then update metrics based on latest resource data
                self._update_namespace_metrics()
                
            except Exception as e:
                logger.error(f"Error in background update _run loop: {str(e)}", exc_info=True)
            
            logger.info(f"Background update cycle finished. Sleeping for {self.update_interval} seconds.")
            time.sleep(self.update_interval)

    def stop(self):
        """Stop the background updater thread."""
        self.running = False
        if self.thread:
            self.thread.join()
            logger.info("Background updater stopped")

# Create a global instance
updater = KubernetesDataUpdater() 