import threading
import time
import logging
from typing import Dict, List
import kubernetes
from kubernetes.client import ApiClient
from database import db

class KubernetesDataUpdater:
    def __init__(self, update_interval: int = 300):  # 5 minutes default
        self.update_interval = update_interval
        self.api_client = None
        self.stop_event = threading.Event()
        
        try:
            kubernetes.config.load_incluster_config()
        except kubernetes.config.ConfigException:
            try:
                kubernetes.config.load_kube_config()
            except kubernetes.config.ConfigException:
                logging.error("Could not configure kubernetes client")
                return
                
        self.api_client = kubernetes.client.ApiClient()
        logging.info("Kubernetes client initialized successfully")
        
        # Start the update thread
        self.update_thread = threading.Thread(target=self._update_loop, daemon=True)
        self.update_thread.start()
        logging.info("Resource update thread started")

    def _update_loop(self):
        """Main update loop that runs periodically."""
        while not self.stop_event.is_set():
            try:
                self._update_resources()
            except Exception as e:
                logging.error(f"Error in update loop: {str(e)}")
            self.stop_event.wait(self.update_interval)

    def stop(self):
        """Stop the update thread."""
        self.stop_event.set()
        if self.update_thread.is_alive():
            self.update_thread.join()
            logging.info("Resource update thread stopped")

    def _fetch_kubernetes_resources(self, resource_type: str) -> List[Dict]:
        """Fetch resources from Kubernetes API."""
        if not self.api_client:
            return []

        try:
            if resource_type == 'pods':
                api = kubernetes.client.CoreV1Api(self.api_client)
                pods = api.list_pod_for_all_namespaces().items
                return [{
                    'namespace': pod.metadata.namespace,
                    'name': pod.metadata.name,
                    'status': pod.status.phase,
                    'cpu': self._get_resource_requests(pod, 'cpu'),
                    'gpu': self._get_resource_requests(pod, 'nvidia.com/gpu'),
                    'memory': self._get_resource_requests(pod, 'memory'),
                    'age': self._get_age(pod.metadata.creation_timestamp)
                } for pod in pods]

            elif resource_type == 'services':
                api = kubernetes.client.CoreV1Api(self.api_client)
                services = api.list_service_for_all_namespaces().items
                return [{
                    'namespace': svc.metadata.namespace,
                    'name': svc.metadata.name,
                    'type': svc.spec.type,
                    'cluster_ip': svc.spec.cluster_ip,
                    'external_ip': svc.spec.external_i_ps[0] if svc.spec.external_i_ps else None,
                    'ports': [{'port': port.port, 'target_port': port.target_port} for port in svc.spec.ports],
                    'age': self._get_age(svc.metadata.creation_timestamp)
                } for svc in services]

            # Add similar blocks for other resource types...

            return []
        except Exception as e:
            logging.error(f"Error fetching {resource_type}: {str(e)}")
            return []

    def _get_resource_requests(self, pod, resource_type: str) -> str:
        """Get resource requests from pod spec."""
        try:
            for container in pod.spec.containers:
                if container.resources and container.resources.requests:
                    return container.resources.requests.get(resource_type, '0')
            return '0'
        except Exception:
            return '0'

    def _get_age(self, creation_timestamp) -> str:
        """Calculate age from creation timestamp."""
        try:
            if not creation_timestamp:
                return 'Unknown'
            age = time.time() - creation_timestamp.timestamp()
            if age < 60:
                return f"{int(age)}s"
            elif age < 3600:
                return f"{int(age/60)}m"
            elif age < 86400:
                return f"{int(age/3600)}h"
            else:
                return f"{int(age/86400)}d"
        except Exception:
            return 'Unknown'

    def _update_resources(self):
        """Update all resources in the database."""
        if not self.api_client:
            logging.error("Kubernetes client not available")
            return

        resource_types = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets']
        
        for resource_type in resource_types:
            try:
                resources = self._fetch_kubernetes_resources(resource_type)
                if resources:
                    success = db.update_resource(resource_type, resources)
                    if success:
                        logging.info(f"Successfully updated {len(resources)} {resource_type}")
                    else:
                        logging.error(f"Failed to update {resource_type} in database")
            except Exception as e:
                logging.error(f"Error updating {resource_type}: {str(e)}")

# Create a global instance
updater = KubernetesDataUpdater() 