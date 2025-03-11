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

def run_kubectl_command(command, interactive=False):
    try:
        if interactive:
            # For interactive sessions, just return the command to be executed in a terminal
            return command
        else:
            # For non-interactive sessions, capture output
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

@app.route('/api/metrics/pods_count', methods=['GET'])
def get_pods_count():
    command = "kubectl get pods -A -o json"
    output = run_kubectl_command(command)
    
    try:
        pods_data = json.loads(output)
        pods_count = len(pods_data.get('items', []))
        return jsonify(count=pods_count)
    except json.JSONDecodeError:
        return jsonify(count=0)

@app.route('/api/metrics/vcpu_count', methods=['GET'])
def get_vcpu_count():
    command = "kubectl get pods -A -o json"
    output = run_kubectl_command(command)
    
    total_vcpu = 0
    try:
        pods_data = json.loads(output)
        for pod in pods_data.get('items', []):
            for container in pod.get('spec', {}).get('containers', []):
                resources = container.get('resources', {})
                requests = resources.get('requests', {})
                limits = resources.get('limits', {})
                
                # Try to get CPU from requests, then limits
                cpu_value = requests.get('cpu') or limits.get('cpu') or '0'
                
                # Convert CPU value to a number
                if cpu_value.endswith('m'):
                    # Convert milliCPU to CPU
                    cpu_num = int(cpu_value[:-1]) / 1000
                else:
                    # Handle values like '1' or '0.5'
                    try:
                        cpu_num = float(cpu_value)
                    except ValueError:
                        cpu_num = 0
                        
                total_vcpu += cpu_num
                
        return jsonify(count=round(total_vcpu, 1))
    except json.JSONDecodeError:
        return jsonify(count=0)

@app.route('/api/metrics/gpu_count', methods=['GET'])
def get_gpu_count():
    command = "kubectl get pods -A -o json"
    output = run_kubectl_command(command)
    
    total_gpus = 0
    try:
        pods_data = json.loads(output)
        for pod in pods_data.get('items', []):
            for container in pod.get('spec', {}).get('containers', []):
                resources = container.get('resources', {})
                requests = resources.get('requests', {})
                limits = resources.get('limits', {})
                
                # Look for NVIDIA GPU resources
                for resource_type in ['nvidia.com/gpu', 'amd.com/gpu']:
                    gpu_value = requests.get(resource_type) or limits.get(resource_type) or '0'
                    
                    try:
                        gpu_num = int(gpu_value)
                    except ValueError:
                        gpu_num = 0
                        
                    total_gpus += gpu_num
                
        return jsonify(count=total_gpus)
    except json.JSONDecodeError:
        return jsonify(count=0)

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

@socketio.on('run_cli_command')
def handle_cli_command(data):
    command = data.get('command', '')
    is_interactive = data.get('interactive', False)
    
    if command:
        if is_interactive:
            # For interactive sessions, we'll start a pseudo-terminal session
            # Send command back to client to initiate the session
            emit('terminal_command', {'command': command})
        else:
            # Normal command execution with output
            output = run_kubectl_command(command)
            emit('output', {'data': output + '\n'})
    else:
        emit('output', {'data': 'Error: No command provided\n'})

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
            interactive = data.get('interactive', False)
        else:
            namespace = request.form['namespace']
            pod_name = request.form['pod_name']
            command = request.form.get('command', 'ps aux')
            interactive = request.form.get('interactive', 'false').lower() == 'true'
            
        if not namespace or not pod_name:
            return jsonify({"error": "Missing namespace or pod_name parameter"}), 400
            
        if interactive:
            # For interactive shell, try bash first, fallback to sh if needed
            bash_cmd = f"kubectl exec -it {pod_name} -n {namespace} -- bash"
            sh_cmd = f"kubectl exec -it {pod_name} -n {namespace} -- /bin/sh"
            # Return both commands for the client to try
            return jsonify({
                "interactive": True,
                "bash_command": bash_cmd,
                "sh_command": sh_cmd
            })
        else:
            # For regular commands, execute and return output
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

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port='8080', allow_unsafe_werkzeug=True)