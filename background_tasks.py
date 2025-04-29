import subprocess
import json
import logging
import time
import threading
from database import db

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
                return json.loads(result.stdout)
            else:
                logger.error(f"kubectl command failed: {result.stderr}")
                return {}
        except Exception as e:
            logger.error(f"Error running kubectl command: {str(e)}")
            return {}

    def _fetch_kubernetes_resources(self, resource_type: str) -> list:
        """Fetch resources using kubectl."""
        try:
            if resource_type == 'pods':
                data = self.run_kubectl_command('get pods --all-namespaces')
                return [{
                    'namespace': pod['metadata']['namespace'],
                    'name': pod['metadata']['name'],
                    'status': pod['status']['phase'],
                    'cpu': self._get_resource_requests(pod, 'cpu'),
                    'gpu': self._get_resource_requests(pod, 'nvidia.com/gpu'),
                    'memory': self._get_resource_requests(pod, 'memory'),
                    'age': pod['metadata']['creationTimestamp']
                } for pod in data.get('items', [])]

            elif resource_type == 'services':
                data = self.run_kubectl_command('get services --all-namespaces')
                return [{
                    'namespace': svc['metadata']['namespace'],
                    'name': svc['metadata']['name'],
                    'type': svc['spec']['type'],
                    'cluster_ip': svc['spec']['clusterIP'],
                    'external_ip': svc['spec'].get('externalIPs', [None])[0],
                    'ports': [{'port': port['port'], 'target_port': port['targetPort']} 
                             for port in svc['spec']['ports']],
                    'age': svc['metadata']['creationTimestamp']
                } for svc in data.get('items', [])]

            return []
        except Exception as e:
            logger.error(f"Error fetching {resource_type}: {str(e)}")
            return []

    def _get_resource_requests(self, pod: dict, resource_type: str) -> str:
        """Extract resource requests from pod spec."""
        try:
            for container in pod['spec']['containers']:
                if 'resources' in container and 'requests' in container['resources']:
                    return container['resources']['requests'].get(resource_type, '0')
            return '0'
        except Exception:
            return '0'

    def _update_resources(self):
        """Update all resources in the database."""
        resource_types = ['pods', 'services']
        
        for resource_type in resource_types:
            try:
                resources = self._fetch_kubernetes_resources(resource_type)
                if resources:
                    success = db.update_resource(resource_type, resources)
                    if success:
                        logger.info(f"Successfully updated {len(resources)} {resource_type}")
                    else:
                        logger.error(f"Failed to update {resource_type} in database")
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