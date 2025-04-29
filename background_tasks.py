import threading
import time
import logging
from typing import Dict, List
import kubernetes.client
from kubernetes.client import ApiClient
from kubernetes.config import load_kube_config, load_incluster_config
from database import db

class KubernetesDataUpdater:
    def __init__(self, update_interval: int = 300):  # 5 minutes default
        self.update_interval = update_interval
        self.running = False
        self.thread = None
        self.api_client = None
        self._initialize_kubernetes_client()

    def _initialize_kubernetes_client(self):
        """Initialize the Kubernetes client."""
        try:
            # Try in-cluster config first (when running in a pod)
            try:
                load_incluster_config()
                logging.info("Initialized Kubernetes client using in-cluster config")
            except kubernetes.config.ConfigException:
                # Fall back to kubeconfig file
                load_kube_config()
                logging.info("Initialized Kubernetes client using kubeconfig file")
            
            self.api_client = ApiClient()
            logging.info("Kubernetes client initialized successfully")
        except Exception as e:
            logging.error(f"Error initializing Kubernetes client: {str(e)}")
            self.api_client = None

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

    def start(self):
        """Start the background update thread."""
        if self.running:
            return

        self.running = True
        self.thread = threading.Thread(target=self._run)
        self.thread.daemon = True
        self.thread.start()
        logging.info("Background updater started")

    def stop(self):
        """Stop the background update thread."""
        self.running = False
        if self.thread:
            self.thread.join()
        logging.info("Background updater stopped")

    def _run(self):
        """Main update loop."""
        while self.running:
            try:
                self._update_resources()
            except Exception as e:
                logging.error(f"Error in background updater: {str(e)}")
            time.sleep(self.update_interval)

# Create a global instance
updater = KubernetesDataUpdater() 