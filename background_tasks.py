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
            try:
                self._update_resources()
            except Exception as e:
                logger.error(f"Error in update loop: {str(e)}")
            time.sleep(self.update_interval)

    def stop(self):
        """Stop the background updater thread."""
        self.running = False
        if self.thread:
            self.thread.join()
            logger.info("Background updater stopped")

# Create a global instance
updater = KubernetesDataUpdater() 