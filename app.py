from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import subprocess
import json
import os
import tempfile
import threading
import shutil
import sys
import time
import signal
import atexit
import psutil
from database import db
import logging
from background_tasks import KubernetesDataUpdater
from kubernetes import client, config
from kubernetes.client import ApiClient
from kubernetes.config import load_kube_config, load_incluster_config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Kubernetes client
def initialize_kubernetes_client():
    """Initialize the Kubernetes client with in-cluster or kubeconfig."""
    try:
        # Try in-cluster config first (when running in a pod)
        try:
            load_incluster_config()
            logger.info("Initialized Kubernetes client using in-cluster config")
        except config.ConfigException:
            # Fall back to kubeconfig
            load_kube_config()
            logger.info("Initialized Kubernetes client using kubeconfig file")
        
        return True
    except Exception as e:
        logger.error(f"Error initializing Kubernetes client: {str(e)}")
        return False

# Initialize the client at startup
has_kubernetes_access = initialize_kubernetes_client()

def run_k8s_command(api_func, *args, **kwargs):
    """Execute a Kubernetes API function with proper error handling."""
    try:
        return api_func(*args, **kwargs)
    except Exception as e:
        logger.error(f"Error executing Kubernetes API call: {str(e)}")
        return None

# We'll check for git availability at runtime rather than import time
git_available = False
try:
    import git
    git_available = True
except ImportError:
    logger.warning("Git module could not be imported. GitHub update functionality will be disabled.")

app = Flask(__name__)
# Configure SocketIO with enhanced settings for reliability
socketio = SocketIO(
    app, 
    cors_allowed_origins="*",  # Allow connections from any origin
    ping_timeout=60,           # Increase ping timeout
    ping_interval=25,          # Adjust ping interval
    max_http_buffer_size=10e7, # Increase buffer size for larger messages
    async_mode='threading',    # Use threading mode for better performance
    logger=True,               # Enable logging
    engineio_logger=True,      # Enable Engine.IO logging
    websocket_class=None,      # Use default WebSocket implementation
    websocket_max_message_size=10e7,  # Increase WebSocket message size limit
    allow_upgrades=True,       # Allow transport upgrades
    http_compression=True,     # Enable HTTP compression
    compression_threshold=1024 # Compress messages larger than 1KB
)

# Get GitHub repo URL from environment variable or use default
github_repo_url = os.environ.get('GITHUB_REPO_URL', 'https://github.com/AlexanderOllman/PodManager.git')

# Check and store initial Kubernetes access status
logger.info(f"Initial Kubernetes access status: {'Available' if has_kubernetes_access else 'Not available'}")

@app.route('/')
def index():
    return render_template('index.html', has_kubernetes_access=has_kubernetes_access)

@app.route('/get_resources', methods=['POST'])
def get_resources():
    """Get Kubernetes resources based on type."""
    resource_type = request.form.get('resource_type')
    namespace = request.form.get('namespace', 'all')
    critical_only = request.form.get('critical_only', 'false').lower() == 'true'
    
    # Add pagination parameters
    page = int(request.form.get('page', 1))
    page_size = int(request.form.get('page_size', 50))
    count_only = request.form.get('count_only', 'false').lower() == 'true'
    
    if not resource_type:
        return jsonify(error="Resource type is required")
    
    try:
        # Get resources from database
        if namespace and namespace != 'all':
            resources = db.get_resources(resource_type, namespace)
        else:
            resources = db.get_resources(resource_type)
        
        # If count_only is true, just return the count
        if count_only:
            return jsonify(data={"totalCount": len(resources)})
        
        # Apply pagination
        total_count = len(resources)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_resources = resources[start_idx:end_idx]
        
        # Add pagination metadata
        paginated_data = {
            'totalCount': total_count,
            'page': page,
            'pageSize': page_size,
            'totalPages': (total_count + page_size - 1) // page_size,
            'items': paginated_resources
        }
        
        return jsonify(data=paginated_data)
    except Exception as e:
        logging.error(f"Error getting resources: {str(e)}")
        return jsonify(error=f"Failed to get {resource_type}: {str(e)}")

@app.route('/run_action', methods=['POST'])
def run_action():
    action = request.form['action']
    resource_type = request.form['resource_type']
    resource_name = request.form['resource_name']
    namespace = request.form['namespace']

    if action == 'describe':
        command = f"kubectl describe {resource_type} {resource_name} -n {namespace}"
    elif action == 'logs':
        command = f"kubectl logs {resource_name} -n {namespace} --tail=100"
    elif action == 'exec':
        command = f"kubectl exec {resource_name} -n {namespace} -- ps aux"
    elif action == 'delete':
        command = f"kubectl delete {resource_type} {resource_name} -n {namespace}"
    else:
        return jsonify(format='error', message="Invalid action")

    output = run_kubectl_command(command)
    return jsonify(format='text', output=output)

def run_command(command, sid):
    process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    while True:
        output = process.stdout.readline()
        if output == '' and process.poll() is not None:
            break
        if output:
            socketio.emit('terminal_output', {'data': output}, room=sid)
    
    error_output = process.stderr.read()
    if error_output:
        socketio.emit('terminal_output', {'data': f"\nError: {error_output}", 'error': True}, room=sid)
    
    # Send completion signal without the message
    print(f"Command completed: {command}")
    socketio.emit('terminal_output', {'complete': True}, room=sid)

@app.route('/run_cli_command', methods=['POST'])
def run_cli_command():
    command = request.form['command']
    sid = request.sid
    thread = threading.Thread(target=run_command, args=(command, sid))
    thread.start()
    return jsonify(success=True)

@app.route('/upload_yaml', methods=['POST'])
def upload_yaml():
    if 'file' not in request.files:
        return jsonify(error="No file part")
    file = request.files['file']
    if file.filename == '':
        return jsonify(error="No selected file")
    if file and file.filename.endswith('.yaml'):
        with tempfile.NamedTemporaryFile(delete=False, suffix='.yaml') as temp_file:
            file.save(temp_file.name)
            command = f"kubectl apply -f {temp_file.name}"
            output = run_kubectl_command(command)
            os.unlink(temp_file.name)
        return jsonify(output=output)
    return jsonify(error="Invalid file type")

@app.route('/get_namespaces', methods=['GET'])
def get_namespaces():
    try:
        v1 = client.CoreV1Api()
        namespaces = run_k8s_command(v1.list_namespace)
        if namespaces:
            namespace_names = [ns.metadata.name for ns in namespaces.items]
            return jsonify(namespaces=namespace_names)
        return jsonify(namespaces=[], error="Unable to fetch namespaces")
    except Exception as e:
        logger.error(f"Error fetching namespaces: {str(e)}")
        return jsonify(namespaces=[], error=str(e))

@app.route('/get_namespace_details', methods=['GET'])
def get_namespace_details():
    """Get detailed information about all namespaces including resource usage."""
    try:
        v1 = client.CoreV1Api()
        namespaces = run_k8s_command(v1.list_namespace)
        if not namespaces:
            return jsonify(namespaces=[], error="Unable to fetch namespaces")

        namespace_details = []
        for ns in namespaces.items:
            namespace_name = ns.metadata.name
            
            # Get pods in namespace
            pods = run_k8s_command(v1.list_namespaced_pod, namespace_name)
            if not pods:
                continue
                
            # Calculate resource usage
            cpu_usage = 0
            gpu_usage = 0
            memory_usage = 0
            
            for pod in pods.items:
                if pod.spec.containers:
                    for container in pod.spec.containers:
                        if container.resources and container.resources.requests:
                            cpu_req = container.resources.requests.get('cpu', '0')
                            memory_req = container.resources.requests.get('memory', '0')
                            gpu_req = container.resources.requests.get('nvidia.com/gpu', '0')
                            
                            # Convert CPU millicores to cores
                            if isinstance(cpu_req, str) and cpu_req.endswith('m'):
                                cpu_usage += int(cpu_req[:-1]) / 1000
                            else:
                                try:
                                    cpu_usage += float(cpu_req)
                                except ValueError:
                                    pass
                            
                            # Convert memory to Mi
                            if isinstance(memory_req, str):
                                if memory_req.endswith('Ki'):
                                    memory_usage += int(memory_req[:-2]) / 1024
                                elif memory_req.endswith('Mi'):
                                    memory_usage += int(memory_req[:-2])
                                elif memory_req.endswith('Gi'):
                                    memory_usage += int(memory_req[:-2]) * 1024
                            
                            # Add GPU usage
                            try:
                                gpu_usage += int(gpu_req)
                            except ValueError:
                                pass
            
            namespace_details.append({
                'name': namespace_name,
                'pod_count': len(pods.items),
                'cpu_usage': round(cpu_usage, 2),
                'memory_usage': round(memory_usage, 2),
                'gpu_usage': gpu_usage
            })
        
        return jsonify(namespaces=namespace_details)
    except Exception as e:
        logger.error(f"Error fetching namespace details: {str(e)}")
        return jsonify(namespaces=[], error=str(e))

@app.route('/api/namespace/describe', methods=['POST'])
def api_namespace_describe():
    """Describe a namespace using kubectl describe."""
    namespace = request.form.get('namespace')
    if not namespace:
        return jsonify(error="Namespace not specified")
    
    command = f"kubectl describe namespace {namespace}"
    output = run_kubectl_command(command)
    
    return jsonify(output=output)

@app.route('/api/namespace/edit', methods=['POST'])
def api_namespace_edit():
    """Get editable fields for a namespace."""
    namespace = request.form.get('namespace')
    if not namespace:
        return jsonify(error="Namespace not specified")
    
    # Get namespace yaml for editing
    command = f"kubectl get namespace {namespace} -o yaml"
    output = run_kubectl_command(command)
    
    try:
        # Return the raw YAML for now, as the front end will handle displaying it
        return jsonify(yaml=output)
    except Exception as e:
        return jsonify(error=f"Error retrieving namespace data: {str(e)}")

@app.route('/api/namespace/update', methods=['POST'])
def api_namespace_update():
    """Update a namespace with the provided YAML."""
    namespace = request.form.get('namespace')
    yaml_content = request.form.get('yaml')
    
    if not namespace or not yaml_content:
        return jsonify(error="Namespace or YAML content not specified")
    
    # Create a temporary file to store the YAML
    try:
        with tempfile.NamedTemporaryFile(suffix='.yaml', delete=False) as temp:
            temp_path = temp.name
            temp.write(yaml_content.encode('utf-8'))
        
        # Apply the YAML file
        command = f"kubectl apply -f {temp_path}"
        output = run_kubectl_command(command)
        
        # Clean up the temporary file
        os.unlink(temp_path)
        
        return jsonify(output=output)
    except Exception as e:
        return jsonify(error=f"Error updating namespace: {str(e)}")

@app.route('/api/namespace/events', methods=['POST'])
def api_namespace_events():
    """Get events for a specific namespace."""
    namespace = request.form.get('namespace')
    if not namespace:
        return jsonify(error="Namespace not specified")
    
    command = f"kubectl get events -n {namespace} --sort-by='.lastTimestamp'"
    output = run_kubectl_command(command)
    
    return jsonify(output=output)

@app.route('/api/namespace/delete', methods=['POST'])
def api_namespace_delete():
    """Delete a namespace and all resources within it."""
    namespace = request.form.get('namespace')
    if not namespace:
        return jsonify(error="Namespace not specified")
    
    # Prevent deletion of critical namespaces
    critical_namespaces = ['default', 'kube-system', 'kube-public', 'kube-node-lease']
    if namespace in critical_namespaces:
        return jsonify(error=f"Cannot delete critical namespace: {namespace}")
    
    # Execute the delete command
    command = f"kubectl delete namespace {namespace}"
    output = run_kubectl_command(command)
    
    return jsonify(output=output)

@app.route('/get_events', methods=['POST'])
def get_events():
    namespace = request.form['namespace']
    command = f"kubectl get events -n {namespace} --sort-by='.lastTimestamp'"
    output = run_kubectl_command(command)
    return jsonify(output=output)

@app.route('/update_from_github', methods=['POST'])
def update_from_github():
    if not git_available:
        return jsonify({
            "status": "error", 
            "message": "Git functionality is not available. Make sure git is installed and the GitPython package can find it."
        })
    
    try:
        repo_url = request.json['repo_url']
        
        # Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        
        # Clone the repository
        git.Repo.clone_from(repo_url, temp_dir)
        
        # Copy new files to the application directory
        app_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Copy files while preserving the app instance
        for item in os.listdir(temp_dir):
            if item != '.git':
                src = os.path.join(temp_dir, item)
                dst = os.path.join(app_dir, item)
                if os.path.isdir(src):
                    if os.path.exists(dst):
                        shutil.rmtree(dst)
                    shutil.copytree(src, dst)
                else:
                    shutil.copy2(src, dst)
        
        # Clean up
        shutil.rmtree(temp_dir)
        
        return jsonify({"status": "success", "message": "Application updated successfully"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/restart', methods=['POST'])
def restart_application():
    try:
        os.execv(sys.executable, ['python'] + sys.argv)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/explore/<namespace>/<pod_name>')
def explore_pod(namespace, pod_name):
    return render_template('explore.html', namespace=namespace, pod_name=pod_name)

@app.route('/api/pod/describe', methods=['POST'])
def api_pod_describe():
    try:
        # Handle both JSON and form data
        if request.is_json:
            data = request.get_json()
            namespace = data.get('namespace')
            pod_name = data.get('pod_name')
        else:
            namespace = request.form['namespace']
            pod_name = request.form['pod_name']
            
        if not namespace or not pod_name:
            return jsonify({"error": "Missing namespace or pod_name parameter"}), 400
            
        command = f"kubectl describe pod {pod_name} -n {namespace}"
        output = run_kubectl_command(command)
        return jsonify({"output": output})
    except Exception as e:
        app.logger.error(f"Error in api_pod_describe: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/pod/logs', methods=['POST'])
def api_pod_logs():
    try:
        # Handle both JSON and form data
        if request.is_json:
            data = request.get_json()
            namespace = data.get('namespace')
            pod_name = data.get('pod_name')
            tail_lines = data.get('tail_lines', 100)
        else:
            namespace = request.form['namespace']
            pod_name = request.form['pod_name']
            tail_lines = request.form.get('tail_lines', 100)
            
        if not namespace or not pod_name:
            return jsonify({"error": "Missing namespace or pod_name parameter"}), 400
            
        v1 = client.CoreV1Api()
        logs = run_k8s_command(
            v1.read_namespaced_pod_log,
            name=pod_name,
            namespace=namespace,
            tail_lines=int(tail_lines)
        )
        return jsonify({"output": logs if logs else ""})
    except Exception as e:
        logger.error(f"Error in api_pod_logs: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/pod/exec', methods=['POST'])
def api_pod_exec():
    try:
        # Handle both JSON and form data
        if request.is_json:
            data = request.get_json()
            namespace = data.get('namespace')
            pod_name = data.get('pod_name')
            command = data.get('command', 'ps aux')
        else:
            namespace = request.form['namespace']
            pod_name = request.form['pod_name']
            command = request.form.get('command', 'ps aux')
            
        if not namespace or not pod_name:
            return jsonify({"error": "Missing namespace or pod_name parameter"}), 400
            
        kubectl_command = f"kubectl exec {pod_name} -n {namespace} -- {command}"
        output = run_kubectl_command(kubectl_command)
        return jsonify({"output": output})
    except Exception as e:
        app.logger.error(f"Error in api_pod_exec: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/pod/details', methods=['POST'])
def api_pod_details():
    try:
        # Handle both JSON and form data
        if request.is_json:
            data = request.get_json()
            namespace = data.get('namespace')
            pod_name = data.get('pod_name')
        else:
            namespace = request.form['namespace']
            pod_name = request.form['pod_name']
            
        if not namespace or not pod_name:
            return jsonify({"error": "Missing namespace or pod_name parameter"}), 400
        
        v1 = client.CoreV1Api()
        pod = run_k8s_command(v1.read_namespaced_pod, name=pod_name, namespace=namespace)
        if not pod:
            return jsonify({"error": "Pod not found"}), 404
            
        # Extract the relevant fields
        pod_details = {
            'name': pod.metadata.name,
            'namespace': pod.metadata.namespace,
            'creation_timestamp': pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else '',
            'pod_ip': pod.status.pod_ip if pod.status else '',
            'node': pod.spec.node_name if pod.spec else '',
            'status': pod.status.phase if pod.status else '',
            'labels': pod.metadata.labels or {},
            'annotations': pod.metadata.annotations or {}
        }
        
        # Calculate ready containers count
        total_containers = len(pod.spec.containers)
        ready_containers = sum(1 for status in (pod.status.container_statuses or []) if status.ready)
        pod_details['ready'] = f"{ready_containers}/{total_containers}"
        
        return jsonify(pod_details)
    except Exception as e:
        logger.error(f"Error in api_pod_details: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/git_status', methods=['GET'])
def git_status():
    return jsonify(available=git_available)

@app.route('/refresh_application', methods=['POST'])
def refresh_application():
    if not git_available:
        socketio.emit('refresh_log', {'message': 'Error: Git functionality is not available. Make sure git is installed and the GitPython package can find it.', 'status': 'error'})
        return jsonify({
            "status": "error", 
            "message": "Git functionality is not available. Make sure git is installed and the GitPython package can find it."
        })
    
    try:
        # Emit starting message
        socketio.emit('refresh_log', {'message': 'Starting application refresh process...', 'status': 'info'})
        
        # Step 1: Prepare for shutdown
        socketio.emit('refresh_log', {'message': 'Preparing to stop application...', 'status': 'info'})
        time.sleep(1)  # Give time for the message to be sent
        
        # Step 2: Get repo URL (from environment or request)
        repo_url = request.json.get('repo_url', github_repo_url)
        socketio.emit('refresh_log', {'message': f'Using repository: {repo_url}', 'status': 'info'})
        
        # Step 3: Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        socketio.emit('refresh_log', {'message': f'Created temporary directory: {temp_dir}', 'status': 'info'})
        
        # Step 4: Clone the repository with --hard option
        socketio.emit('refresh_log', {'message': 'Cloning repository (hard pull)...', 'status': 'info'})
        git.Repo.clone_from(repo_url, temp_dir)
        socketio.emit('refresh_log', {'message': 'Repository successfully cloned', 'status': 'info'})
        
        # Step 5: Copy new files to the application directory
        app_dir = os.path.dirname(os.path.abspath(__file__))
        socketio.emit('refresh_log', {'message': f'Copying files to application directory: {app_dir}', 'status': 'info'})
        
        # Copy files while preserving the app instance
        for item in os.listdir(temp_dir):
            if item != '.git':
                src = os.path.join(temp_dir, item)
                dst = os.path.join(app_dir, item)
                if os.path.isdir(src):
                    if os.path.exists(dst):
                        shutil.rmtree(dst)
                    shutil.copytree(src, dst)
                    socketio.emit('refresh_log', {'message': f'Copied directory: {item}', 'status': 'info'})
                else:
                    shutil.copy2(src, dst)
                    socketio.emit('refresh_log', {'message': f'Copied file: {item}', 'status': 'info'})
        
        # Step 6: Clean up
        shutil.rmtree(temp_dir)
        socketio.emit('refresh_log', {'message': 'Cleaned up temporary files', 'status': 'info'})
        
        # Step 7: Prepare for restart
        socketio.emit('refresh_log', {'message': 'All files updated. Preparing to restart application...', 'status': 'info'})
        
        # Return success response (the client will then call restart)
        return jsonify({"status": "success", "message": "Application ready for restart"})
        
    except Exception as e:
        error_message = f"Error during refresh: {str(e)}"
        socketio.emit('refresh_log', {'message': error_message, 'status': 'error'})
        return jsonify({"status": "error", "message": error_message})

@app.route('/health_check', methods=['GET'])
def health_check():
    """Simple health check endpoint to verify the application is running."""
    return jsonify({
        'status': 'ok',
        'message': 'Application is running'
    })

@app.route('/get_cluster_capacity', methods=['GET'])
def get_cluster_capacity():
    """Get the total capacity of the Kubernetes cluster."""
    try:
        v1 = client.CoreV1Api()
        nodes = run_k8s_command(v1.list_node)
        if not nodes:
            return jsonify({"error": "Unable to fetch nodes"}), 500
            
        total_cpu = 0
        total_memory_ki = 0
        total_gpu = 0
        
        for node in nodes.items:
            allocatable = node.status.allocatable if node.status else {}
            
            # CPU
            cpu_str = allocatable.get('cpu', '0')
            if isinstance(cpu_str, str) and cpu_str.endswith('m'):
                total_cpu += int(cpu_str[:-1]) / 1000
            else:
                try:
                    total_cpu += float(cpu_str)
                except (ValueError, TypeError):
                    pass
            
            # Memory
            memory_str = allocatable.get('memory', '0')
            if isinstance(memory_str, str):
                if memory_str.endswith('Ki'):
                    total_memory_ki += int(memory_str[:-2])
                elif memory_str.endswith('Mi'):
                    total_memory_ki += int(memory_str[:-2]) * 1024
                elif memory_str.endswith('Gi'):
                    total_memory_ki += int(memory_str[:-2]) * 1024 * 1024
            
            # GPU
            gpu_count = allocatable.get('nvidia.com/gpu', '0')
            try:
                total_gpu += int(gpu_count)
            except (ValueError, TypeError):
                pass
            
            # Check for generic GPU resource
            generic_gpu = allocatable.get('gpu', '0')
            try:
                total_gpu += int(generic_gpu)
            except (ValueError, TypeError):
                pass
        
        # Convert memory to Gi for easier display
        total_memory_gi = round(total_memory_ki / (1024 * 1024), 1)
        
        return jsonify({
            'cpu_cores': round(total_cpu, 1),
            'memory_gi': total_memory_gi,
            'gpu_count': total_gpu
        })
    except Exception as e:
        logger.error(f"Error getting cluster capacity: {str(e)}")
        return jsonify({"error": str(e)}), 500

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    return None

@socketio.on('disconnect')
def handle_disconnect():
    print(f'Client disconnected: {request.sid}')
    return None

@socketio.on('terminal_command')
def handle_terminal_command(data):
    # Handle control signals
    if 'control' in data:
        control_type = data.get('control')
        print(f"Received control signal: {control_type}")
        
        if control_type == 'SIGINT':
            # In a real implementation, we would send SIGINT to the process
            # For now, we'll just acknowledge it
            return
        
        elif control_type == 'EOF':
            # Handle EOF signal
            return
        
        elif control_type == 'SIGTSTP':
            # Handle SIGTSTP signal
            return
            
        return
    
    # Handle regular commands
    command = data.get('command', '')
    if not command:
        return
    
    print(f"Executing command: {command}")
    sid = request.sid
    thread = threading.Thread(target=run_command, args=(command, sid))
    thread.daemon = True
    thread.start()

@app.route('/api/cli/exec', methods=['POST'])
def api_cli_exec():
    try:
        # Get command from request
        data = request.get_json() if request.is_json else request.form
        command = data.get('command', '')
        
        if not command:
            return jsonify({"error": "Missing command parameter"}), 400
            
        # Run the command directly in the current environment
        result = run_kubectl_command(command)
        return jsonify({"output": result})
    except Exception as e:
        app.logger.error(f"Error in api_cli_exec: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/charts/list', methods=['GET'])
def list_charts():
    """Get list of all charts from ChartMuseum"""
    try:
        # First check if ChartMuseum is accessible
        check_command = "curl -s http://127.0.0.1:8855/api/charts"
        result = subprocess.run(check_command, shell=True, capture_output=True, text=True)
        
        if result.returncode != 0 or not result.stdout:
            # Get the pod name first - using a more specific command to get the pod name
            pod_cmd = "kubectl get pods -n ez-chartmuseum-ns -o jsonpath='{.items[0].metadata.name}'"
            pod_result = subprocess.run(pod_cmd, shell=True, capture_output=True, text=True)
            
            if pod_result.returncode != 0:
                return jsonify({
                    'success': False,
                    'error': 'ChartMuseum pod not found in ez-chartmuseum-ns namespace'
                })
            
            pod_name = pod_result.stdout.strip()
            
            # Try to set up port forwarding in a new thread
            def setup_port_forward():
                port_forward_cmd = f"kubectl port-forward {pod_name} -n ez-chartmuseum-ns 8855:8080"
                subprocess.run(port_forward_cmd, shell=True)
            
            # Kill any existing port forwards on 8855
            subprocess.run("pkill -f 'port-forward.*8855'", shell=True)
            
            # Start port forwarding in background
            import threading
            port_forward_thread = threading.Thread(target=setup_port_forward, daemon=True)
            port_forward_thread.start()
            
            # Wait a moment for port forwarding to establish
            import time
            time.sleep(2)
            
            # Try the check again
            result = subprocess.run(check_command, shell=True, capture_output=True, text=True)
            if result.returncode != 0 or not result.stdout:
                return jsonify({
                    'success': False,
                    'error': 'ChartMuseum is not accessible. Port forwarding was attempted but failed.'
                })
            
        charts_data = json.loads(result.stdout)
        return jsonify({
            'success': True,
            'charts': charts_data
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

@app.route('/api/charts/delete', methods=['POST'])
def delete_chart():
    """Delete a chart or specific version from ChartMuseum"""
    try:
        chart_name = request.form.get('chart_name')
        version = request.form.get('version')
        
        if not chart_name:
            return jsonify({
                'success': False,
                'error': 'Chart name is required'
            })
            
        if version:
            # Delete specific version
            command = f"curl -X DELETE http://127.0.0.1:8855/api/charts/{chart_name}/{version}"
        else:
            # Delete entire chart
            command = f"curl -X DELETE http://127.0.0.1:8855/api/charts/{chart_name}"
            
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        
        if result.returncode != 0:
            return jsonify({
                'success': False,
                'error': f'Failed to delete chart: {result.stderr}'
            })
            
        return jsonify({
            'success': True,
            'message': f'Successfully deleted chart {chart_name}'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

# Add error handlers for Socket.IO
@socketio.on_error_default
def default_error_handler(e):
    print('Socket.IO error:', str(e))
    return None

@socketio.on('connect_error')
def handle_connect_error(error):
    print('Connection error:', str(error))
    return None

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')
    return None

@app.route('/api/gpu-pods', methods=['GET'])
def get_gpu_pods():
    try:
        namespace = request.args.get('namespace')
        
        # Get pods from database
        if namespace:
            pods = db.get_resources('pods', namespace)
        else:
            pods = db.get_resources('pods')
        
        # Filter pods that use GPU resources
        gpu_pods = []
        for pod in pods:
            has_gpu = False
            gpu_count = 0
            
            # Check containers for GPU requests
            for container in pod.get('spec', {}).get('containers', []):
                resources = container.get('resources', {})
                limits = resources.get('limits', {})
                
                # Look for NVIDIA GPU or generic GPU resources
                for resource_name, value in limits.items():
                    if 'nvidia.com' in resource_name or 'gpu' in resource_name:
                        has_gpu = True
                        try:
                            gpu_count += int(value)
                        except ValueError:
                            pass
            
            if has_gpu:
                gpu_pods.append({
                    'name': pod.get('metadata', {}).get('name', ''),
                    'namespace': pod.get('metadata', {}).get('namespace', ''),
                    'node': pod.get('spec', {}).get('nodeName', ''),
                    'status': pod.get('status', {}).get('phase', ''),
                    'gpu_count': gpu_count
                })
        
        return jsonify(gpu_pods)
    
    except Exception as e:
        logging.error(f"Error getting GPU pods: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/namespace-metrics', methods=['GET'])
def get_namespace_metrics():
    try:
        metric_type = request.args.get('metric', 'gpu')
        
        # Get metrics from database
        metrics = db.get_metrics(metric_type)
        
        # Sort by the requested metric
        if metric_type == 'gpu':
            metrics.sort(key=lambda x: x.get('gpu_usage', 0), reverse=True)
        elif metric_type == 'cpu':
            metrics.sort(key=lambda x: x.get('cpu_usage', 0), reverse=True)
        elif metric_type == 'memory':
            metrics.sort(key=lambda x: x.get('memory_usage', 0), reverse=True)
        
        # Return only namespaces with the relevant resource usage
        filtered_metrics = [m for m in metrics if m.get(f'{metric_type}_usage', 0) > 0]
        
        return jsonify(filtered_metrics[:10])  # Return top 10 namespaces
    
    except Exception as e:
        logging.error(f"Error getting namespace metrics: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/pods/delete', methods=['POST'])
def delete_pod():
    try:
        namespace = request.args.get('namespace')
        name = request.args.get('name')
        
        if not namespace or not name:
            return jsonify({"error": "Namespace and pod name are required"}), 400
        
        v1 = client.CoreV1Api()
        result = run_k8s_command(
            v1.delete_namespaced_pod,
            name=name,
            namespace=namespace
        )
        
        if result:
            return jsonify({"success": True, "message": f"Pod {name} deleted successfully"})
        return jsonify({"error": "Failed to delete pod"}), 500
        
    except Exception as e:
        logger.error(f"Error deleting pod: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/refresh-database', methods=['POST'])
def refresh_database():
    """Manually trigger a database refresh."""
    try:
        updater = KubernetesDataUpdater()
        updater._update_resources()  # Force an immediate update
        return jsonify({
            'success': True,
            'message': 'Database refresh completed successfully'
        })
    except Exception as e:
        logging.error(f"Error refreshing database: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port='8080', allow_unsafe_werkzeug=True)