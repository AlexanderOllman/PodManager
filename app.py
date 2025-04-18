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
import logging
from database import get_db, clear_db
from datetime import datetime, timedelta

# We'll check for git availability at runtime rather than import time
git_available = False
try:
    import git
    git_available = True
except ImportError:
    print("Git module could not be imported. GitHub update functionality will be disabled.")

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

def run_kubectl_command(command):
    try:
        result = subprocess.run(command, shell=True, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result.stdout.decode('utf-8')
    except subprocess.CalledProcessError as e:
        return f"Error: {e.stderr.decode('utf-8')}"

@app.route('/')
def index():
    return render_template('index.html')

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
    
    print(f"[DB] Processing /get_resources request for {resource_type}")
    
    # Get database instance
    db = get_db()
    
    # Check when was the last update for this resource type
    last_updated = db.get_last_updated(resource_type)
    current_time = datetime.now().isoformat()
    
    # If resources haven't been loaded or are stale (older than 5 minutes), populate from kubectl
    if not last_updated or (
        datetime.fromisoformat(last_updated) < 
        datetime.fromisoformat(current_time) - timedelta(minutes=5)
    ):
        print(f"[DB] Data for {resource_type} is stale (last updated: {last_updated}) or missing, fetching from Kubernetes")
        app.logger.info(f"Data for {resource_type} is stale or missing, fetching from Kubernetes")
        fetch_success = fetch_k8s_data(resource_type)
        if not fetch_success:
            print(f"[DB] Failed to fetch {resource_type} from Kubernetes")
            return jsonify(error=f"Failed to fetch {resource_type} from Kubernetes")
    else:
        print(f"[DB] Using cached data for {resource_type} - last updated: {last_updated}")
    
    try:
        # If count_only is true, just return the count from the database
        if count_only:
            print(f"[DB] Getting count for {resource_type} from database")
            count_result = db.get_resources(resource_type, namespace)
            count = count_result['total']
            print(f"[DB] Found {count} {resource_type} in database")
            return jsonify(data={"totalCount": count})
        
        # Get paginated resources from database
        print(f"[DB] Getting resources for {resource_type} from database - page {page}, page_size {page_size}")
        result = db.get_resources(
            resource_type=resource_type, 
            namespace=namespace,
            page=page,
            page_size=page_size
        )
        print(f"[DB] Retrieved {len(result['items'])} {resource_type} items from database (total: {result['total']})")
        
        # Format data to match the expected structure from kubectl
        paginated_data = {
            'totalCount': result['total'],
            'page': result['page'],
            'pageSize': result['page_size'],
            'totalPages': result['total_pages'],
            'items': result['items']
        }
        
        # For critical-only loads, strip out non-essential data
        if critical_only and 'items' in paginated_data:
            print(f"[DB] Applying critical_only filter for {resource_type}")
            for item in paginated_data['items']:
                # Keep only essential metadata and status
                minimal_item = {
                    'metadata': {
                        'name': item['metadata'].get('name'),
                        'namespace': item['metadata'].get('namespace'),
                        'creationTimestamp': item['metadata'].get('creationTimestamp')
                    },
                    'status': {}
                }
                
                # Keep essential status fields based on resource type
                if resource_type == 'pods':
                    minimal_item['status'] = {
                        'phase': item['status'].get('phase'),
                        'containerStatuses': [
                            {
                                'ready': status.get('ready'),
                                'restartCount': status.get('restartCount'),
                                'state': status.get('state')
                            } for status in item['status'].get('containerStatuses', [])
                        ]
                    }
                    # Include spec data for pods to calculate resource usage
                    minimal_item['spec'] = {
                        'containers': [
                            {
                                'name': container.get('name'),
                                'resources': container.get('resources', {})
                            } for container in item.get('spec', {}).get('containers', [])
                        ]
                    }
                elif resource_type == 'services':
                    minimal_item['spec'] = {
                        'type': item['spec'].get('type'),
                        'clusterIP': item['spec'].get('clusterIP')
                    }
                elif resource_type == 'deployments':
                    minimal_item['status'] = {
                        'replicas': item['status'].get('replicas'),
                        'readyReplicas': item['status'].get('readyReplicas')
                    }
                
                item.clear()
                item.update(minimal_item)
        
        return jsonify(data=paginated_data)
    except Exception as e:
        print(f"[DB] Error retrieving {resource_type} from database: {str(e)}")
        app.logger.error(f"Error retrieving {resource_type} from database: {str(e)}")
        # Fallback to kubectl if database query fails
        try:
            print(f"[DB] Falling back to kubectl for {resource_type}")
            app.logger.info(f"Falling back to kubectl for {resource_type}")
            # Build kubectl command based on resource type and namespace
            if namespace and namespace != 'all':
                command = f"kubectl get {resource_type} -n {namespace} -o json"
            else:
                command = f"kubectl get {resource_type} --all-namespaces -o json"
                
            print(f"[DB] Executing kubectl command: {command}")
            output = run_kubectl_command(command)
            data = json.loads(output)
            
            # Get total count before pagination
            total_count = len(data.get('items', []))
            print(f"[DB] Retrieved {total_count} {resource_type} items from kubectl")
            
            # Apply pagination to limit memory usage
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            
            # Add pagination metadata
            paginated_data = {
                'totalCount': total_count,
                'page': page,
                'pageSize': page_size,
                'totalPages': (total_count + page_size - 1) // page_size
            }
            
            # Paginate the results
            if 'items' in data:
                paginated_data['items'] = data['items'][start_idx:end_idx]
            
            return jsonify(data=paginated_data)
        except Exception as fallback_error:
            print(f"[DB] Error with kubectl fallback for {resource_type}: {str(fallback_error)}")
            return jsonify(error=f"Failed to get {resource_type}: {str(fallback_error)}")

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
    command = "kubectl get namespaces -o json"
    output = run_kubectl_command(command)
    
    try:
        namespaces = json.loads(output)
        # Extract just the namespace names for simplicity
        namespace_names = [ns['metadata']['name'] for ns in namespaces.get('items', [])]
        return jsonify(namespaces=namespace_names)
    except json.JSONDecodeError:
        return jsonify(namespaces=[], error="Unable to fetch namespaces")

@app.route('/get_namespace_details', methods=['GET'])
def get_namespace_details():
    """Get detailed information about all namespaces including resource usage."""
    # Get all namespaces
    ns_command = "kubectl get namespaces -o json"
    ns_output = run_kubectl_command(ns_command)
    
    try:
        namespaces_data = json.loads(ns_output)
        namespaces = []
        
        # For each namespace, get pod count and resource usage
        for ns in namespaces_data['items']:
            namespace_name = ns['metadata']['name']
            
            # Get pod count
            pod_command = f"kubectl get pods -n {namespace_name} -o json"
            pod_output = run_kubectl_command(pod_command)
            
            try:
                pods_data = json.loads(pod_output)
                pod_count = len(pods_data['items'])
                
                # Calculate resource usage
                cpu_usage = 0
                gpu_usage = 0
                memory_usage = 0
                
                for pod in pods_data['items']:
                    if 'containers' in pod.get('spec', {}):
                        for container in pod['spec']['containers']:
                            if 'resources' in container and 'requests' in container['resources']:
                                requests = container['resources']['requests']
                                
                                # CPU usage
                                if 'cpu' in requests:
                                    cpu_req = requests['cpu']
                                    # Convert to numeric value
                                    if cpu_req.endswith('m'):
                                        cpu_usage += float(cpu_req[:-1]) / 1000
                                    else:
                                        try:
                                            cpu_usage += float(cpu_req)
                                        except ValueError:
                                            pass
                                
                                # Memory usage
                                if 'memory' in requests:
                                    mem_req = requests['memory']
                                    # Convert to MB for display
                                    if mem_req.endswith('Mi'):
                                        memory_usage += float(mem_req[:-2])
                                    elif mem_req.endswith('Gi'):
                                        memory_usage += float(mem_req[:-2]) * 1024
                                    elif mem_req.endswith('Ki'):
                                        memory_usage += float(mem_req[:-2]) / 1024
                                    else:
                                        try:
                                            # Assume bytes if no unit
                                            memory_usage += float(mem_req) / (1024 * 1024)
                                        except ValueError:
                                            pass
                                
                                # GPU usage
                                if 'nvidia.com/gpu' in requests:
                                    try:
                                        gpu_usage += float(requests['nvidia.com/gpu'])
                                    except ValueError:
                                        pass
                
                # Format the resource usage for display
                namespace_info = {
                    'name': namespace_name,
                    'podCount': pod_count,
                    'resources': {
                        'cpu': round(cpu_usage, 2),
                        'gpu': round(gpu_usage, 2),
                        'memory': round(memory_usage, 2)  # Memory in MB
                    },
                    'metadata': ns.get('metadata', {})
                }
                
                namespaces.append(namespace_info)
                
            except json.JSONDecodeError:
                # If we can't get pod data, still include the namespace with zero counts
                namespaces.append({
                    'name': namespace_name,
                    'podCount': 0,
                    'resources': {'cpu': 0, 'gpu': 0, 'memory': 0},
                    'metadata': ns.get('metadata', {})
                })
                
        return jsonify(namespaces=namespaces)
    
    except json.JSONDecodeError:
        return jsonify(error="Unable to fetch namespace details")

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
            
        command = f"kubectl logs {pod_name} -n {namespace} --tail={tail_lines}"
        output = run_kubectl_command(command)
        return jsonify({"output": output})
    except Exception as e:
        app.logger.error(f"Error in api_pod_logs: {str(e)}")
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
        
        # Fetch the pod details using kubectl
        command = f"kubectl get pod {pod_name} -n {namespace} -o json"
        output = run_kubectl_command(command)
        
        try:
            pod_data = json.loads(output)
            
            # Extract the relevant fields
            pod_details = {
                'name': pod_data.get('metadata', {}).get('name', ''),
                'namespace': pod_data.get('metadata', {}).get('namespace', ''),
                'creation_timestamp': pod_data.get('metadata', {}).get('creationTimestamp', ''),
                'pod_ip': pod_data.get('status', {}).get('podIP', ''),
                'node': pod_data.get('spec', {}).get('nodeName', ''),
                'status': pod_data.get('status', {}).get('phase', ''),
                'labels': pod_data.get('metadata', {}).get('labels', {}),
                'annotations': pod_data.get('metadata', {}).get('annotations', {})
            }
            
            # Calculate ready containers count
            containers = pod_data.get('spec', {}).get('containers', [])
            total_containers = len(containers)
            
            # Check container statuses
            container_statuses = pod_data.get('status', {}).get('containerStatuses', [])
            ready_containers = sum(1 for status in container_statuses if status.get('ready', False))
            pod_details['ready'] = f"{ready_containers}/{total_containers}"
            
            # Calculate restarts
            restart_count = sum(status.get('restartCount', 0) for status in container_statuses)
            pod_details['restarts'] = str(restart_count)
            
            # Calculate age
            if pod_details['creation_timestamp']:
                from datetime import datetime, timezone
                created_time = datetime.fromisoformat(pod_details['creation_timestamp'].replace('Z', '+00:00'))
                current_time = datetime.now(timezone.utc)
                delta = current_time - created_time
                
                if delta.days > 0:
                    age = f"{delta.days}d"
                elif delta.seconds >= 3600:
                    age = f"{delta.seconds // 3600}h"
                elif delta.seconds >= 60:
                    age = f"{delta.seconds // 60}m"
                else:
                    age = f"{delta.seconds}s"
                    
                pod_details['age'] = age
            
            # Extract container information including resource requests and limits
            pod_details['containers'] = []
            for container in containers:
                container_info = {
                    'name': container.get('name', ''),
                    'image': container.get('image', ''),
                    'resources': container.get('resources', {})
                }
                pod_details['containers'].append(container_info)
            
            return jsonify(pod_details)
            
        except json.JSONDecodeError:
            return jsonify({"error": "Unable to parse pod details"}), 500
            
    except Exception as e:
        app.logger.error(f"Error in api_pod_details: {str(e)}")
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
        
        # Step 1: Clear the database
        socketio.emit('refresh_log', {'message': 'Clearing database...', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'clearing_database', 'progress': 10})
        
        if clear_db():
            socketio.emit('refresh_log', {'message': 'Database cleared successfully', 'status': 'success'})
        else:
            socketio.emit('refresh_log', {'message': 'Warning: Failed to clear database', 'status': 'warning'})
        
        # Step 2: Prepare for shutdown
        socketio.emit('refresh_log', {'message': 'Preparing to stop application...', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'preparing', 'progress': 20})
        time.sleep(1)  # Give time for the message to be sent
        
        # Step 3: Get repo URL (from environment or request)
        repo_url = request.json.get('repo_url', github_repo_url)
        socketio.emit('refresh_log', {'message': f'Using repository: {repo_url}', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'preparing_repo', 'progress': 30})
        
        # Step 4: Create a temporary directory
        temp_dir = tempfile.mkdtemp()
        socketio.emit('refresh_log', {'message': f'Created temporary directory: {temp_dir}', 'status': 'info'})
        
        # Step 5: Clone the repository with --hard option
        socketio.emit('refresh_log', {'message': 'Cloning repository (hard pull)...', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'cloning_repo', 'progress': 40})
        git.Repo.clone_from(repo_url, temp_dir)
        socketio.emit('refresh_log', {'message': 'Repository successfully cloned', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'repo_cloned', 'progress': 60})
        
        # Step 6: Copy new files to the application directory
        app_dir = os.path.dirname(os.path.abspath(__file__))
        socketio.emit('refresh_log', {'message': f'Copying files to application directory: {app_dir}', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'copying_files', 'progress': 70})
        
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
        
        # Step 7: Clean up
        shutil.rmtree(temp_dir)
        socketio.emit('refresh_log', {'message': 'Cleaned up temporary files', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'cleanup_complete', 'progress': 90})
        
        # Step 8: Prepare for restart
        socketio.emit('refresh_log', {'message': 'All files updated. Preparing to restart application...', 'status': 'info'})
        socketio.emit('refresh_status', {'step': 'preparing_restart', 'progress': 100})
        
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
    """
    Get the total capacity of the Kubernetes cluster
    Returns CPU cores, memory in Gi, and GPU count
    """
    try:
        # Get nodes information
        command = "kubectl get nodes -o json"
        output = run_kubectl_command(command)
        nodes_data = json.loads(output)
        
        total_cpu = 0
        total_memory_ki = 0
        total_gpu = 0
        
        # Sum up allocatable resources from all nodes
        for node in nodes_data.get("items", []):
            allocatable = node.get("status", {}).get("allocatable", {})
            
            # CPU - convert from Kubernetes format (can be in cores or millicores)
            cpu_str = allocatable.get("cpu", "0")
            if cpu_str.endswith('m'):
                # Convert millicores to cores
                total_cpu += int(cpu_str[:-1]) / 1000
            else:
                total_cpu += int(cpu_str)
            
            # Memory - convert from Kubernetes format (usually in Ki)
            memory_str = allocatable.get("memory", "0")
            if memory_str.endswith('Ki'):
                total_memory_ki += int(memory_str[:-2])
            elif memory_str.endswith('Mi'):
                total_memory_ki += int(memory_str[:-2]) * 1024
            elif memory_str.endswith('Gi'):
                total_memory_ki += int(memory_str[:-2]) * 1024 * 1024
            
            # GPU - look for NVIDIA GPUs or any custom GPU resource
            gpu_count = allocatable.get("nvidia.com/gpu", 0)
            if gpu_count:
                total_gpu += int(gpu_count)
            
            # Also check for generic 'gpu' resource
            generic_gpu = allocatable.get("gpu", 0)
            if generic_gpu:
                total_gpu += int(generic_gpu)
        
        # Convert memory to Gi for easier display
        total_memory_gi = round(total_memory_ki / (1024 * 1024), 1)
        
        return jsonify({
            "cpu": round(total_cpu, 1),
            "memory": total_memory_gi,
            "gpu": total_gpu
        })
    except Exception as e:
        app.logger.error(f"Error getting cluster capacity: {str(e)}")
        return jsonify({
            "cpu": 256,  # Default fallback
            "memory": 1024,
            "gpu": 0,
            "error": str(e)
        }), 500

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
        
        # Get all pods
        pods = []
        if namespace:
            command = f"kubectl get pods -n {namespace} -o json"
        else:
            command = "kubectl get pods --all-namespaces -o json"
        
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        pod_list = json.loads(result.stdout)
        
        # Filter pods that use GPU resources
        gpu_pods = []
        for pod in pod_list.get('items', []):
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
    
    except subprocess.CalledProcessError as e:
        app.logger.error(f"Error executing kubectl command: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        app.logger.error(f"Error fetching GPU pods: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/namespace-metrics', methods=['GET'])
def get_namespace_metrics():
    try:
        metric_type = request.args.get('metric', 'gpu')
        
        # Get all pods
        command = "kubectl get pods --all-namespaces -o json"
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        pod_list = json.loads(result.stdout)
        
        # Group pods by namespace and calculate resource usage
        namespace_metrics = {}
        
        for pod in pod_list.get('items', []):
            namespace = pod.get('metadata', {}).get('namespace', 'default')
            
            if namespace not in namespace_metrics:
                namespace_metrics[namespace] = {
                    'namespace': namespace,
                    'pod_count': 0,
                    'gpu_usage': 0,
                    'cpu_usage': 0,
                    'memory_usage': 0
                }
            
            # Increment pod count
            namespace_metrics[namespace]['pod_count'] += 1
            
            # Calculate resource usage from containers
            for container in pod.get('spec', {}).get('containers', []):
                resources = container.get('resources', {})
                limits = resources.get('limits', {})
                
                # CPU
                cpu = limits.get('cpu', '')
                if cpu:
                    cpu_cores = 0
                    if cpu.endswith('m'):
                        cpu_cores = float(cpu[:-1]) / 1000
                    else:
                        try:
                            cpu_cores = float(cpu)
                        except ValueError:
                            pass
                    namespace_metrics[namespace]['cpu_usage'] += cpu_cores
                
                # Memory
                memory = limits.get('memory', '')
                if memory:
                    memory_bytes = 0
                    if memory.endswith('Ki'):
                        memory_bytes = float(memory[:-2]) * 1024
                    elif memory.endswith('Mi'):
                        memory_bytes = float(memory[:-2]) * 1024 * 1024
                    elif memory.endswith('Gi'):
                        memory_bytes = float(memory[:-2]) * 1024 * 1024 * 1024
                    else:
                        try:
                            memory_bytes = float(memory)
                        except ValueError:
                            pass
                    namespace_metrics[namespace]['memory_usage'] += memory_bytes
                
                # GPU
                for resource_name, value in limits.items():
                    if 'nvidia.com' in resource_name or 'gpu' in resource_name:
                        try:
                            namespace_metrics[namespace]['gpu_usage'] += int(value)
                        except ValueError:
                            pass
        
        # Convert to list and sort by the requested metric
        metrics_list = list(namespace_metrics.values())
        if metric_type == 'gpu':
            metrics_list.sort(key=lambda x: x['gpu_usage'], reverse=True)
        elif metric_type == 'cpu':
            metrics_list.sort(key=lambda x: x['cpu_usage'], reverse=True)
        elif metric_type == 'memory':
            metrics_list.sort(key=lambda x: x['memory_usage'], reverse=True)
        
        # Return only namespaces with the relevant resource usage
        filtered_metrics = [m for m in metrics_list if m[f'{metric_type}_usage'] > 0]
        
        return jsonify(filtered_metrics[:10])  # Return top 10 namespaces
    
    except subprocess.CalledProcessError as e:
        app.logger.error(f"Error executing kubectl command: {e}")
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        app.logger.error(f"Error calculating namespace metrics: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/pods/delete', methods=['POST'])
def delete_pod():
    try:
        namespace = request.args.get('namespace')
        name = request.args.get('name')
        
        if not namespace or not name:
            return jsonify({"error": "Namespace and pod name are required"}), 400
        
        # Execute kubectl delete command
        command = f"kubectl delete pod {name} -n {namespace}"
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        
        return jsonify({"success": True, "message": f"Pod {name} deleted successfully"})
    
    except subprocess.CalledProcessError as e:
        app.logger.error(f"Error deleting pod: {e}")
        error_message = e.stderr if e.stderr else str(e)
        return jsonify({"error": error_message}), 500
    except Exception as e:
        app.logger.error(f"Error deleting pod: {e}")
        return jsonify({"error": str(e)}), 500

# Fetch function that gets data from Kubernetes and stores in database
def fetch_k8s_data(resource_type):
    """
    Fetch data from Kubernetes and store in database
    """
    print(f"[DB] fetch_k8s_data() - Fetching {resource_type} from Kubernetes")
    db = get_db()
    try:
        # Simulate fetching data from Kubernetes
        # In real implementation, this would call kubernetes API
        cmd = ["kubectl", "get", resource_type, "--all-namespaces", "-o", "json"]
        print(f"[DB] Executing kubectl command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        
        # Count items to be stored
        item_count = len(data.get('items', []))
        print(f"[DB] Retrieved {item_count} {resource_type} from Kubernetes")
        
        # Update database with new data
        print(f"[DB] Storing {item_count} {resource_type} in database")
        success = db.update_resource(resource_type, data.get('items', []))
        
        # Update namespace metrics if we've updated pods
        if resource_type == 'pods':
            print(f"[DB] Updating namespace metrics based on new pod data")
            db.update_namespace_metrics()
        
        print(f"[DB] Successfully updated {resource_type} in database")
        return success
    except Exception as e:
        print(f"[DB] Error fetching {resource_type} from Kubernetes: {str(e)}")
        logger.error(f"Error fetching {resource_type}: {e}")
        return False

# API for refreshing all resources
@app.route('/api/refresh/all', methods=['POST'])
def refresh_all():
    # Start a background thread to refresh all resources
    thread = threading.Thread(target=refresh_all_resources)
    thread.daemon = True
    thread.start()
    
    return jsonify({'status': 'refresh started'})

def refresh_all_resources():
    """Background task to refresh all resources"""
    resource_types = ['pods', 'services', 'deployments', 'configmaps', 'secrets', 'namespaces']
    for resource_type in resource_types:
        logger.info(f"Refreshing {resource_type}")
        fetch_k8s_data(resource_type)
        # Small delay to avoid overwhelming the API server
        time.sleep(1)
    
    # Update namespace metrics
    get_db().update_namespace_metrics()
    logger.info("All resources refreshed")

# API for namespaces
@app.route('/api/namespaces')
def get_namespaces_api():
    # Get data from database
    db = get_db()
    
    # Check if we should force refresh
    refresh = request.args.get('refresh', 'false').lower() == 'true'
    
    if refresh:
        fetch_k8s_data('namespaces')
    
    namespaces = db.get_namespaces_list()
    return jsonify({'items': namespaces})

# API for resources data
@app.route('/api/resources/<resource_type>')
def get_resources(resource_type):
    namespace = request.args.get('namespace', 'all')
    search = request.args.get('search', '')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 50))
    sort_by = request.args.get('sort_by', None)
    sort_desc = request.args.get('sort_desc', 'false').lower() == 'true'
    
    # Check if we should force refresh from Kubernetes
    refresh = request.args.get('refresh', 'false').lower() == 'true'
    
    if refresh:
        fetch_k8s_data(resource_type)
    
    # Get data from database
    db = get_db()
    result = db.get_resources(resource_type, namespace, search, page, page_size, sort_by, sort_desc)
    
    # Add last_updated timestamp
    result['last_updated'] = db.get_last_updated(resource_type)
    
    return jsonify(result)

# API for dashboard metrics
@app.route('/api/dashboard/metrics')
def get_dashboard_metrics():
    # Get data from database
    db = get_db()
    
    # Check if we should force refresh
    refresh = request.args.get('refresh', 'false').lower() == 'true'
    
    if refresh:
        fetch_k8s_data('pods')
    
    metrics = db.get_dashboard_metrics()
    return jsonify(metrics)

# API endpoint for GPU pods
@app.route('/api/gpu-pods')
def get_gpu_pods():
    # Get data from database
    db = get_db()
    
    # Check if we should force refresh
    refresh = request.args.get('refresh', 'false').lower() == 'true'
    
    if refresh:
        fetch_k8s_data('pods')
    
    pods = db.get_gpu_pods()
    return jsonify({'items': pods})

# API endpoint for namespace metrics
@app.route('/api/namespace-metrics')
def get_namespace_metrics():
    metric_type = request.args.get('metric_type', 'gpu')
    
    # Get data from database
    db = get_db()
    
    # Check if we should force refresh
    refresh = request.args.get('refresh', 'false').lower() == 'true'
    
    if refresh:
        fetch_k8s_data('pods')
        fetch_k8s_data('namespaces')
        db.update_namespace_metrics()
    
    metrics = db.get_namespace_metrics(metric_type)
    return jsonify({'items': metrics})

@app.route('/metrics-test')
def metrics_test():
    """Test page for GPU pods and namespace metrics"""
    return render_template('metrics_test.html')

# API endpoint for resources with offset/limit for infinite scrolling
@app.route('/api/resources/<resource_type>', methods=['POST'])
def api_resources(resource_type):
    namespace = request.form.get('namespace', 'all')
    search = request.form.get('search', '')
    offset = int(request.form.get('offset', 0))
    limit = int(request.form.get('limit', 50))
    critical_only = request.form.get('critical_only', 'false').lower() == 'true'
    
    try:
        # Get database instance
        db = get_db()
        
        # Check if we need to refresh data
        last_updated = db.get_last_updated(resource_type)
        current_time = datetime.now().isoformat()
        
        # If resources haven't been loaded or are stale (older than 5 minutes), populate from kubectl
        if not last_updated or (
            datetime.fromisoformat(last_updated) < 
            datetime.fromisoformat(current_time) - timedelta(minutes=5)
        ):
            app.logger.info(f"Data for {resource_type} is stale or missing, fetching from Kubernetes")
            fetch_success = fetch_k8s_data(resource_type)
            if not fetch_success:
                return jsonify({"error": f"Failed to fetch {resource_type} from Kubernetes"}), 500
        
        # Get resources with pagination from database
        # We use page_size=limit and calculate the page number from offset
        page = (offset // limit) + 1
        result = db.get_resources(
            resource_type=resource_type,
            namespace=namespace,
            search=search,
            page=page,
            page_size=limit
        )
        
        # Format for response
        response = {
            'items': result['items'],
            'totalCount': result['total'],
            'offset': offset,
            'limit': limit,
            'hasMore': (offset + len(result['items'])) < result['total']
        }
        
        # For critical-only loads, strip out non-essential data
        if critical_only and response['items']:
            for item in response['items']:
                # Keep only essential metadata and status
                minimal_item = {
                    'metadata': {
                        'name': item['metadata'].get('name'),
                        'namespace': item['metadata'].get('namespace'),
                        'creationTimestamp': item['metadata'].get('creationTimestamp')
                    },
                    'status': {}
                }
                
                # Keep essential status fields based on resource type
                if resource_type == 'pods':
                    minimal_item['status'] = {
                        'phase': item['status'].get('phase'),
                        'containerStatuses': [
                            {
                                'ready': status.get('ready'),
                                'restartCount': status.get('restartCount'),
                                'state': status.get('state')
                            } for status in item['status'].get('containerStatuses', [])
                        ]
                    }
                    
                elif resource_type == 'services':
                    minimal_item['spec'] = {
                        'type': item['spec'].get('type'),
                        'clusterIP': item['spec'].get('clusterIP')
                    }
                    
                elif resource_type == 'deployments':
                    minimal_item['status'] = {
                        'replicas': item['status'].get('replicas'),
                        'readyReplicas': item['status'].get('readyReplicas')
                    }
                
                item.clear()
                item.update(minimal_item)
        
        return jsonify(response)
    
    except Exception as e:
        app.logger.error(f"Error retrieving {resource_type} from database: {str(e)}")
        
        # Fallback to kubectl if database query fails
        try:
            app.logger.info(f"Falling back to kubectl for {resource_type}")
            # Build kubectl command based on resource type and namespace
            if namespace and namespace != 'all':
                command = f"kubectl get {resource_type} -n {namespace} -o json"
            else:
                command = f"kubectl get {resource_type} --all-namespaces -o json"
            
            result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
            data = json.loads(result.stdout)
            
            # Get all items
            all_items = data.get('items', [])
            
            # Apply filters if search is provided
            if search:
                search = search.lower()
                filtered_items = []
                for item in all_items:
                    name = item.get('metadata', {}).get('name', '').lower()
                    ns = item.get('metadata', {}).get('namespace', '').lower()
                    if search in name or search in ns:
                        filtered_items.append(item)
                all_items = filtered_items
            
            # Get total count
            total_count = len(all_items)
            
            # Apply pagination
            paginated_items = all_items[offset:offset+limit]
            
            # For critical-only loads, strip out non-essential data
            if critical_only:
                for item in paginated_items:
                    # Keep only essential metadata and status
                    minimal_item = {
                        'metadata': {
                            'name': item['metadata'].get('name'),
                            'namespace': item['metadata'].get('namespace'),
                            'creationTimestamp': item['metadata'].get('creationTimestamp')
                        },
                        'status': {}
                    }
                    
                    # Keep essential status fields based on resource type
                    if resource_type == 'pods':
                        minimal_item['status'] = {
                            'phase': item['status'].get('phase'),
                            'containerStatuses': [{
                                'ready': status.get('ready'),
                                'restartCount': status.get('restartCount'),
                                'state': status.get('state')
                            } for status in item['status'].get('containerStatuses', [])]
                        }
                    elif resource_type == 'services':
                        minimal_item['spec'] = {
                            'type': item['spec'].get('type'),
                            'clusterIP': item['spec'].get('clusterIP')
                        }
                    elif resource_type == 'deployments':
                        minimal_item['status'] = {
                            'replicas': item['status'].get('replicas'),
                            'readyReplicas': item['status'].get('readyReplicas')
                        }
                    
                    item.clear()
                    item.update(minimal_item)
            
            # Return response with metadata for infinite scrolling
            response = {
                'items': paginated_items,
                'totalCount': total_count,
                'offset': offset,
                'limit': limit,
                'hasMore': offset + len(paginated_items) < total_count
            }
            
            return jsonify(response)
        
        except Exception as fallback_error:
            app.logger.error(f"Error with kubectl fallback for {resource_type}: {str(fallback_error)}")
            return jsonify({"error": str(fallback_error)}), 500

if __name__ == '__main__':
    # Initialize the database with a background thread
    init_thread = threading.Thread(target=init_app)
    init_thread.daemon = True
    init_thread.start()
    
    socketio.run(app, debug=True, host='0.0.0.0', port='8080', allow_unsafe_werkzeug=True)