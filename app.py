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

# We'll check for git availability at runtime rather than import time
git_available = False
try:
    import git
    git_available = True
except ImportError:
    print("Git module could not be imported. GitHub update functionality will be disabled.")

app = Flask(__name__)
socketio = SocketIO(app)

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
    resource_type = request.form['resource_type']
    command = f"kubectl get {resource_type} -A -o json"
    output = run_kubectl_command(command)
    
    try:
        resources = json.loads(output)
        return jsonify(format='table', data=resources)
    except json.JSONDecodeError:
        return jsonify(format='error', message=f"Unable to fetch {resource_type}")

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
    process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    while True:
        output = process.stdout.readline()
        if output == b'' and process.poll() is not None:
            break
        if output:
            socketio.emit('output', {'data': output.decode('utf-8')}, room=sid)
    socketio.emit('output', {'data': 'Command finished.'}, room=sid)

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
        namespace_names = [item['metadata']['name'] for item in namespaces['items']]
        return jsonify(namespaces=namespace_names)
    except json.JSONDecodeError:
        return jsonify(error="Unable to fetch namespaces")

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

@app.route('/charts')
def charts():
    """Render the charts management page."""
    return render_template('charts.html')

@app.route('/api/charts', methods=['GET'])
def get_charts():
    """Get all charts from the ChartMuseum instance."""
    try:
        import requests
        response = requests.get('http://127.0.0.1:8855/api/charts')
        if response.status_code == 200:
            return jsonify(response.json())
        else:
            return jsonify({"error": f"Error fetching charts: Status code {response.status_code}"}), response.status_code
    except Exception as e:
        app.logger.error(f"Error in get_charts: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/charts/<chart_name>', methods=['DELETE'])
def delete_chart(chart_name):
    """Delete a chart by name."""
    try:
        import requests
        response = requests.delete(f'http://127.0.0.1:8855/api/charts/{chart_name}')
        if response.status_code == 200:
            return jsonify({"status": "success", "message": f"Chart {chart_name} deleted successfully"})
        else:
            return jsonify({"error": f"Error deleting chart: Status code {response.status_code}"}), response.status_code
    except Exception as e:
        app.logger.error(f"Error in delete_chart: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/charts/<chart_name>/<version>', methods=['DELETE'])
def delete_chart_version(chart_name, version):
    """Delete a specific version of a chart."""
    try:
        import requests
        response = requests.delete(f'http://127.0.0.1:8855/api/charts/{chart_name}/{version}')
        if response.status_code == 200:
            return jsonify({"status": "success", "message": f"Chart {chart_name} version {version} deleted successfully"})
        else:
            return jsonify({"error": f"Error deleting chart version: Status code {response.status_code}"}), response.status_code
    except Exception as e:
        app.logger.error(f"Error in delete_chart_version: {str(e)}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port='8080', allow_unsafe_werkzeug=True)