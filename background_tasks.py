import kubernetes
import logging
import time
import threading
from typing import Dict, List
from database import db

class KubernetesDataUpdater:
    def __init__(self, update_interval: int = 300):  # 5 minutes default
        self.update_interval = update_interval
        self.api_client = None
        self.running = False
        self.thread = None
        self._initialize_kubernetes()

    def _initialize_kubernetes(self):
        """Initialize Kubernetes client."""
        try:
            kubernetes.config.load_incluster_config()
        except kubernetes.config.ConfigException:
            try:
                kubernetes.config.load_kube_config()
            except kubernetes.config.ConfigException as e:
                logging.error(f"Failed to initialize Kubernetes client: {str(e)}")
                return
        
        self.api_client = kubernetes.client.ApiClient()
        logging.info("Kubernetes client initialized successfully")

    def start(self):
        """Start the background updater thread."""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        
        # Do an initial update immediately
        self._update_resources()
        logging.info("Background updater started")

    def stop(self):
        """Stop the background updater thread."""
        self.running = False
        if self.thread:
            self.thread.join()
        logging.info("Background updater stopped")

    def _run(self):
        """Run the background update loop."""
        while self.running:
            time.sleep(self.update_interval)
            if self.running:  # Check again in case we were stopped
                self._update_resources()

    def _fetch_kubernetes_resources(self, resource_type: str) -> List[Dict]:
        """Fetch resources from Kubernetes API."""
        if not self.api_client:
            logging.error("Kubernetes client not initialized")
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

            # Add other resource types as needed
            return []
        except Exception as e:
            logging.error(f"Error fetching {resource_type}: {str(e)}")
            return []

    def _get_resource_requests(self, pod, resource_type: str) -> str:
        """Get resource requests from pod spec."""
        try:
            total = 0
            for container in pod.spec.containers:
                if container.resources and container.resources.requests:
                    request = container.resources.requests.get(resource_type, '0')
                    if isinstance(request, str):
                        if request.endswith('m'):  # millicores
                            total += float(request[:-1]) / 1000
                        elif request.endswith('Mi'):  # Mebibytes
                            total += float(request[:-2])
                        elif request.endswith('Gi'):  # Gibibytes
                            total += float(request[:-2]) * 1024
                        else:
                            total += float(request)
            return str(total)
        except Exception as e:
            logging.error(f"Error getting resource requests: {str(e)}")
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
        except Exception as e:
            logging.error(f"Error calculating age: {str(e)}")
            return 'Unknown'

    def _update_resources(self):
        """Update all resources in the database."""
        if not self.api_client:
            logging.error("Kubernetes client not initialized")
            return

        resource_types = ['pods', 'services']
        updated = False
        
        for resource_type in resource_types:
            try:
                resources = self._fetch_kubernetes_resources(resource_type)
                if resources:
                    success = db.update_resource(resource_type, resources)
                    if success:
                        logging.info(f"Successfully updated {len(resources)} {resource_type}")
                        updated = True
                    else:
                        logging.error(f"Failed to update {resource_type} in database")
            except Exception as e:
                logging.error(f"Error updating {resource_type}: {str(e)}")
        
        return updated

# Create a global instance
updater = KubernetesDataUpdater() 