import subprocess
import json
import logging
import time
import threading
from database import db
from datetime import datetime, timezone # Added for age calculation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class KubernetesDataUpdater:
    def __init__(self, update_interval: int = 300, env_metrics_collector_func=None):  # 5 minutes default
        self.update_interval = update_interval
        self.thread = None
        self.running = False
        self.env_metrics_collector = env_metrics_collector_func
        self.db = db  # Add database reference

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

    def _update_resources(self):
        """Update all cached resources."""
        if not self.running:
            return
            
        logger.info("Starting resource cache update...")
        
        # Resource types to fetch
        resource_types = ['pods', 'services', 'deployments', 'inferenceservices', 'configmaps', 'secrets', 'nodes']
        
        # Dictionary to store all resources
        all_resources = {}
        
        for resource_type in resource_types:
            try:
                logger.info(f"Fetching {resource_type}...")
                
                if resource_type == 'inferenceservices':
                    # Custom command for InferenceServices
                    command = ["get", "inferenceservices", "-A", "-o", "json"]
                else:
                    # Standard command for other resources
                    command = ["get", resource_type, "-A", "-o", "json"]
                
                result = subprocess.run(['kubectl'] + command, 
                                     capture_output=True, text=True, timeout=60)
                
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    items = data.get('items', [])
                    all_resources[resource_type] = items
                    logger.info(f"Successfully fetched {len(items)} {resource_type}")
                else:
                    logger.error(f"Failed to fetch {resource_type}: {result.stderr}")
                    all_resources[resource_type] = []
                    
            except subprocess.TimeoutExpired:
                logger.error(f"Timeout fetching {resource_type}")
                all_resources[resource_type] = []
            except json.JSONDecodeError as e:
                logger.error(f"JSON decode error for {resource_type}: {e}")
                all_resources[resource_type] = []
            except Exception as e:
                logger.error(f"Unexpected error fetching {resource_type}: {e}")
                all_resources[resource_type] = []
        
        # Update database atomically
        success = self.db.update_resources_atomically(all_resources)
        
        if success:
            logger.info("Resource cache update completed successfully")
            
            # After successful resource update, calculate and store namespace metrics
            self._update_namespace_metrics()
        else:
            logger.error("Failed to update resource cache")
    
    def _update_namespace_metrics(self):
        """Calculate and store namespace-level resource metrics."""
        try:
            logger.info("Calculating namespace resource metrics...")
            
            # Get all pods to calculate namespace-level metrics
            pods = self.db.get_resources('pods')
            
            # Dictionary to store namespace metrics
            namespace_metrics = {}
            
            for pod in pods:
                if not isinstance(pod, dict):
                    continue
                    
                metadata = pod.get('metadata', {})
                namespace = metadata.get('namespace', 'default')
                spec = pod.get('spec', {})
                status = pod.get('status', {})
                phase = status.get('phase', '')
                
                # Initialize namespace metrics if not exists
                if namespace not in namespace_metrics:
                    namespace_metrics[namespace] = {
                        'namespace': namespace,
                        'pod_count': 0,
                        'cpu_usage': 0,
                        'gpu_usage': 0,
                        'memory_usage': 0,  # in MB
                        'running_pods': 0,
                        'pending_pods': 0,
                        'failed_pods': 0
                    }
                
                # Count pods by phase
                namespace_metrics[namespace]['pod_count'] += 1
                if phase == 'Running':
                    namespace_metrics[namespace]['running_pods'] += 1
                elif phase == 'Pending':
                    namespace_metrics[namespace]['pending_pods'] += 1
                elif phase == 'Failed':
                    namespace_metrics[namespace]['failed_pods'] += 1
                
                # Calculate resource usage from containers
                for container in spec.get('containers', []):
                    requests = container.get('resources', {}).get('requests', {})
                    
                    # CPU usage
                    if 'cpu' in requests:
                        cpu_str = requests['cpu']
                        if cpu_str.endswith('m'):
                            namespace_metrics[namespace]['cpu_usage'] += float(cpu_str[:-1]) / 1000
                        else:
                            try:
                                namespace_metrics[namespace]['cpu_usage'] += float(cpu_str)
                            except ValueError:
                                pass
                    
                    # GPU usage
                    if 'nvidia.com/gpu' in requests:
                        try:
                            namespace_metrics[namespace]['gpu_usage'] += float(requests['nvidia.com/gpu'])
                        except ValueError:
                            pass
                    
                    # Memory usage (convert to MB)
                    if 'memory' in requests:
                        memory_str = requests['memory']
                        if memory_str.endswith('Mi'):
                            namespace_metrics[namespace]['memory_usage'] += float(memory_str[:-2])
                        elif memory_str.endswith('Gi'):
                            namespace_metrics[namespace]['memory_usage'] += float(memory_str[:-2]) * 1024
                        elif memory_str.endswith('Ki'):
                            namespace_metrics[namespace]['memory_usage'] += float(memory_str[:-2]) / 1024
                        else:
                            try:
                                # Assume bytes if no unit
                                namespace_metrics[namespace]['memory_usage'] += float(memory_str) / (1024 * 1024)
                            except ValueError:
                                pass
            
            # Store metrics in database for each metric type
            for namespace, metrics in namespace_metrics.items():
                # Store GPU metrics
                if metrics['gpu_usage'] > 0:
                    self.db.update_metrics('gpu', namespace, metrics)
                
                # Store CPU metrics
                if metrics['cpu_usage'] > 0:
                    self.db.update_metrics('cpu', namespace, metrics)
                
                # Store memory metrics
                if metrics['memory_usage'] > 0:
                    self.db.update_metrics('memory', namespace, metrics)
            
            logger.info(f"Successfully calculated metrics for {len(namespace_metrics)} namespaces")
            
        except Exception as e:
            logger.error(f"Error calculating namespace metrics: {e}")

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
            try:
                self._update_resources()
                if self.env_metrics_collector:
                    logger.info("Calling environment metrics collector from background task...")
                    self.env_metrics_collector() # Call the passed-in function
            except Exception as e:
                logger.error(f"Error in update loop: {str(e)}")
            time.sleep(self.update_interval)

    def stop(self):
        """Stop the background updater thread."""
        self.running = False
        if self.thread:
            self.thread.join()
            logger.info("Background updater stopped")

    def set_env_metrics_collector(self, collector_func):
        """Allows app.py to set the metrics collector function after initialization."""
        self.env_metrics_collector = collector_func
        logger.info("Environment metrics collector function has been set for background updater.")

# Create a global instance
updater = KubernetesDataUpdater() 