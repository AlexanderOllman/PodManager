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
from background_tasks import updater
import pty
import select
import struct
import fcntl
import termios

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# We'll check for git availability at runtime rather than import time
git_available = False
try:
    import git
    git_available = True
except ImportError:
    print("Git module could not be imported. GitHub update functionality will be disabled.")

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

# Start the background updater
updater.start()

# Register cleanup function
@atexit.register
def cleanup():
    updater.stop()

# Dictionary to store active PTY sessions
# Structure: {sid: {'pid': child_pid, 'fd': master_fd, 'namespace': ns, 'pod_name': pn, 'type': 'pod_exec' | 'control_plane_cli'}}
active_pty_sessions = {}

# --- Get App's Pod and Namespace ---
APP_POD_NAME = os.environ.get('HOSTNAME')
APP_POD_NAMESPACE = os.environ.get('POD_NAMESPACE')

if not APP_POD_NAMESPACE:
    logger.info("POD_NAMESPACE environment variable not set, attempting to read from service account file.")
    try:
        with open("/var/run/secrets/kubernetes.io/serviceaccount/namespace", "r") as f:
            APP_POD_NAMESPACE = f.read().strip()
        logger.info(f"Successfully read namespace from service account file: {APP_POD_NAMESPACE}")
    except FileNotFoundError:
        logger.warning("Service account namespace file not found.")
    except Exception as e:
        logger.error(f"Error reading service account namespace file: {e}")

if APP_POD_NAME and APP_POD_NAMESPACE:
    logger.info(f"Application Target for Control Plane CLI - Pod: {APP_POD_NAME}, Namespace: {APP_POD_NAMESPACE}")
else:
    if not APP_POD_NAME:
        logger.warning("Could not determine application POD_NAME (tried HOSTNAME env var).")
    if not APP_POD_NAMESPACE:
        logger.warning("Could not determine application POD_NAMESPACE (tried POD_NAMESPACE env var and service account file).")
    logger.warning("Control Plane CLI will show an error if initiated, as it cannot exec into the application's pod.")
# --- End Get App's Pod and Namespace ---

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

def read_and_forward_pty_output(sid, fd, namespace, pod_name, output_event_name, exit_event_name, session_type):
    logger.info(f"[{session_type} sid:{sid}] Starting PTY read loop for {namespace or 'N/A'}/{pod_name or 'CONTROL_PLANE'}")
    max_read_bytes = 1024 * 20 # Read up to 20KB at a time
    try:
        while True:
            socketio.sleep(0.01) # Small sleep to prevent tight loop and allow other greenlets
            if sid not in active_pty_sessions or active_pty_sessions.get(sid, {}).get('fd') != fd:
                logger.info(f"[{session_type} sid:{sid}] Session terminated or FD changed, stopping read loop for {namespace or 'N/A'}/{pod_name or 'CONTROL_PLANE'}.")
                break
            
            # Check if fd is readable without blocking
            ready_to_read, _, _ = select.select([fd], [], [], 0) # Timeout of 0 makes it non-blocking
            
            if ready_to_read:
                try:
                    output = os.read(fd, max_read_bytes)
                except OSError as e: # This can happen if the PTY is closed (e.g., shell exits)
                    logger.info(f"[{session_type} sid:{sid}] OSError on os.read() for {namespace or 'N/A'}/{pod_name or 'CONTROL_PLANE'}: {e}. Assuming PTY closed.")
                    break # Exit loop, PTY likely closed

                if output:
                    decoded_output = output.decode('utf-8', errors='replace')
                    logger.debug(f"[{session_type} sid:{sid}] PTY Read {len(decoded_output)} chars for {namespace or 'N/A'}/{pod_name or 'CONTROL_PLANE'}")
                    socketio.emit(output_event_name,
                                  {'output': decoded_output,
                                   'namespace': namespace, 
                                   'pod_name': pod_name},
                                  room=sid)
                else: # EOF, process exited or PTY stream closed
                    logger.info(f"[{session_type} sid:{sid}] EOF (empty read) received for PTY session {namespace or 'N/A'}/{pod_name or 'CONTROL_PLANE'}.")
                    break 
    except Exception as e: # Catch any other unexpected errors in the loop
        logger.error(f"[{session_type} sid:{sid}] Exception in PTY read loop for {namespace or 'N/A'}/{pod_name or 'CONTROL_PLANE'}: {e}", exc_info=True)
        socketio.emit(output_event_name,
                      {'error': f'Backend PTY read error: {str(e)}',
                       'namespace': namespace, 'pod_name': pod_name},
                      room=sid)
    finally:
        logger.info(f"[{session_type} sid:{sid}] Exiting PTY read loop and initiating cleanup for {namespace or 'N/A'}/{pod_name or 'CONTROL_PLANE'}.")
        # Emit exit event to client
        socketio.emit(exit_event_name, {'namespace': namespace, 'pod_name': pod_name, 'message': 'Session terminated.'}, room=sid)
        
        session_to_clean = active_pty_sessions.pop(sid, None) 
        if session_to_clean and session_to_clean.get('fd') == fd:
            logger.info(f"[{session_type} sid:{sid}] Cleaning up session from read_and_forward (FD: {fd}).")
            try:
                os.close(fd) # Close the master PTY descriptor
                logger.info(f"[{session_type} sid:{sid}] Closed PTY FD {fd}.")
            except OSError as e:
                logger.warning(f"[{session_type} sid:{sid}] OSError on closing PTY FD {fd} during cleanup: {e}")
            
            pid_to_kill = session_to_clean.get('pid')
            if pid_to_kill:
                logger.info(f"[{session_type} sid:{sid}] Attempting to terminate PID {pid_to_kill}.")
                try:
                    os.kill(pid_to_kill, signal.SIGTERM) # Politely ask to terminate
                    time.sleep(0.1) # Give it a moment
                    os.kill(pid_to_kill, signal.SIGKILL) # Ensure it's gone
                    logger.info(f"[{session_type} sid:{sid}] Sent SIGKILL to PID {pid_to_kill}.")
                except ProcessLookupError:
                    logger.info(f"[{session_type} sid:{sid}] Process {pid_to_kill} already gone (ProcessLookupError).")
                except Exception as kill_e:
                    logger.error(f"[{session_type} sid:{sid}] Error during kill process {pid_to_kill}: {kill_e}")
        elif session_to_clean: # Session was popped but FD didn't match, put it back if it wasn't ours to clean from read_loop
            active_pty_sessions[sid] = session_to_clean # Put back if not cleaned by this instance
            logger.info(f"[{session_type} sid:{sid}] FD mismatch during read_loop cleanup for FD {fd}, session for SID {sid} might be handled by disconnect.")
        else:
            logger.info(f"[{session_type} sid:{sid}] Session for SID {sid} already removed or FD mismatch for FD {fd}, no cleanup by this read_loop instance.")

def _start_pty_session(sid, exec_namespace, exec_pod_name, output_event_name, exit_event_name, session_type_val):
    logger.info(f"[{session_type_val} sid:{sid}] Attempting to start PTY session for {exec_namespace or 'N/A'}/{exec_pod_name or 'CONTROL_PLANE'}.")
    if sid in active_pty_sessions:
        logger.warning(f"[{session_type_val} sid:{sid}] Session already active. Emitting error.")
        # Emit to the specific output channel for this type of session
        socketio.emit(output_event_name, {'error': 'Session already active for this client.', 'namespace': exec_namespace, 'pod_name': exec_pod_name}, room=sid)
        return

    try:
        (child_pid, fd) = pty.fork()
        if child_pid == 0: # Child process
            env = os.environ.copy()
            env['TERM'] = 'xterm' # Common terminal type
            # For some minimal images, /bin/sh is preferred. For others, /bin/bash.
            # The `-i` flag helps ensure the shell runs in interactive mode if it supports it.
            shell_path = '/bin/sh' # Default shell
            # Could add logic here to check for /bin/bash if /bin/sh is too basic
            # cmd_list = ['kubectl', 'exec', '-i', '-t', exec_pod_name, '-n', exec_namespace, '--', shell_path, '-i']
            cmd_list = ['kubectl', 'exec', '-it', exec_pod_name, '-n', exec_namespace, '--', shell_path]

            logger.info(f"[{session_type_val} child_pid:{os.getpid()}] Executing in PTY: {' '.join(cmd_list)}")
            # Replace the current process with kubectl exec
            os.execvpe(cmd_list[0], cmd_list, env)
            # execvpe does not return if successful
            # If it returns, an error occurred before exec, so exit child
            logger.error(f"[{session_type_val} child_pid:{os.getpid()}] execvpe failed for {' '.join(cmd_list)}")
            os._exit(1) # Child exits if execvpe fails

        else: # Parent process
            active_pty_sessions[sid] = {
                'pid': child_pid, 
                'fd': fd,
                'namespace': exec_namespace, 
                'pod_name': exec_pod_name,
                'type': session_type_val
            }
            logger.info(f"[{session_type_val} sid:{sid}] PTY session created: PID={child_pid}, FD={fd}")
            
            # Set initial PTY size (optional, but can help with shell prompt rendering)
            # This should ideally get initial rows/cols from client if possible
            # set_pty_size(fd, 24, 80) 

            # Start a background task to read output from the PTY and forward it
            socketio.start_background_task(target=read_and_forward_pty_output,
                                          sid=sid, fd=fd,
                                          namespace=exec_namespace, pod_name=exec_pod_name,
                                          output_event_name=output_event_name, 
                                          exit_event_name=exit_event_name,
                                          session_type=session_type_val)
            logger.info(f"[{session_type_val} sid:{sid}] Started PTY read background task for FD {fd}.")
            
    except Exception as e:
        error_msg = f"Failed to start PTY session for {exec_namespace or 'N/A'}/{exec_pod_name or 'CONTROL_PLANE'}: {str(e)}"
        logger.error(f"[{session_type_val} sid:{sid}] {error_msg}", exc_info=True)
        socketio.emit(output_event_name, {'error': error_msg, 'namespace': exec_namespace, 'pod_name': exec_pod_name}, room=sid)
        if sid in active_pty_sessions: # Clean up if partially created
            logger.warning(f"[{session_type_val} sid:{sid}] Cleaning up partially created session due to error.")
            session_to_clean = active_pty_sessions.pop(sid, None)
            if session_to_clean and 'fd' in session_to_clean:
                try: 
                    os.close(session_to_clean['fd'])
                except OSError: 
                    pass

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

@app.route('/api/pod/details', methods=['GET'])
def api_pod_details():
    try:
        # For GET requests, parameters will be in request.args
        namespace = request.args.get('namespace')
        pod_name = request.args.get('pod_name')
        
        # The JavaScript sends namespace and pod_name as part of the URL path
        # So, we need to capture them from the route definition if we change it, or parse from referer/args
        # For now, let's assume they might be passed as query params if not in path.
        # If the JS is /api/pod/ns/name/details, we need to adjust route pattern.
        # Let's adjust the route to match the JS call pattern.
        
        # This route definition will be changed below to match the JS fetch URL.
        # The code below assumes namespace and pod_name are correctly populated.

        if not namespace or not pod_name:
             # Fallback or error if not extracted from path by updated route pattern
             # This part will be simplified once the route pattern is updated.
            if 'namespace' in request.view_args and 'pod_name' in request.view_args:
                namespace = request.view_args['namespace']
                pod_name = request.view_args['pod_name']
            else:
                 return jsonify({"error": "Missing namespace or pod_name in path or query"}), 400

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

@app.route('/api/pod/<namespace>/<pod_name>/details', methods=['GET'])
def api_get_pod_details_from_path(namespace, pod_name):
    # This new route directly uses namespace and pod_name from the path
    try:
        command = f"kubectl get pod {pod_name} -n {namespace} -o json"
        output = run_kubectl_command(command)
        
        try:
            pod_data = json.loads(output)
            # ...(same parsing logic as above)... 
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
            containers = pod_data.get('spec', {}).get('containers', [])
            total_containers = len(containers)
            container_statuses = pod_data.get('status', {}).get('containerStatuses', [])
            ready_containers = sum(1 for status in container_statuses if status.get('ready', False))
            pod_details['ready'] = f"{ready_containers}/{total_containers}"
            restart_count = sum(status.get('restartCount', 0) for status in container_statuses)
            pod_details['restarts'] = str(restart_count)
            if pod_details['creation_timestamp']:
                from datetime import datetime, timezone
                created_time = datetime.fromisoformat(pod_details['creation_timestamp'].replace('Z', '+00:00'))
                current_time = datetime.now(timezone.utc)
                delta = current_time - created_time
                if delta.days > 0: age = f"{delta.days}d"
                elif delta.seconds >= 3600: age = f"{delta.seconds // 3600}h"
                elif delta.seconds >= 60: age = f"{delta.seconds // 60}m"
                else: age = f"{delta.seconds}s"
                pod_details['age'] = age
            pod_details['containers'] = []
            for container in containers:
                pod_details['containers'].append({
                    'name': container.get('name', ''),
                    'image': container.get('image', ''),
                    'resources': container.get('resources', {})
                })
            return jsonify(pod_details)
        except json.JSONDecodeError:
            app.logger.error(f"JSONDecodeError in api_get_pod_details_from_path for {namespace}/{pod_name}. Output: {output}")
            return jsonify({"error": "Unable to parse pod details from kubectl output"}), 500
    except Exception as e:
        app.logger.error(f"Error in api_get_pod_details_from_path for {namespace}/{pod_name}: {str(e)}")
        return jsonify({"error": f"Server error fetching pod details: {str(e)}"}), 500

@app.route('/api/pod/<namespace>/<pod_name>/describe', methods=['GET'])
def api_get_pod_description_from_path(namespace, pod_name):
    try:
        if not namespace or not pod_name:
            return jsonify({"error": "Missing namespace or pod_name parameter"}), 400
            
        command = f"kubectl describe pod {pod_name} -n {namespace}"
        output = run_kubectl_command(command)
        # Assuming output of describe is typically text and not JSON from kubectl
        return jsonify({"describe_output": output}) 
    except Exception as e:
        app.logger.error(f"Error in api_get_pod_description_from_path for {namespace}/{pod_name}: {str(e)}")
        return jsonify({"error": f"Server error fetching pod description: {str(e)}"}), 500

@app.route('/api/pod/<namespace>/<pod_name>/logs', methods=['GET'])
def api_get_pod_logs_from_path(namespace, pod_name):
    try:
        if not namespace or not pod_name:
            return jsonify({"error": "Missing namespace or pod_name parameter"}), 400
        
        # Get tail_lines from query parameter, default to 100
        tail_lines = request.args.get('tail_lines', 100)
        download = request.args.get('download', 'false').lower() == 'true'

        try:
            tail_lines = int(tail_lines)
        except ValueError:
            tail_lines = 100 # Default if conversion fails

        command = f"kubectl logs {pod_name} -n {namespace} --tail={tail_lines}"
        output = run_kubectl_command(command)

        if download:
            from flask import Response
            return Response(
                output,
                mimetype="text/plain",
                headers={"Content-disposition": f"attachment; filename={pod_name}_{namespace}_logs.txt"}
            )
        else:
            # Assuming logs output is typically text
            return jsonify({"logs": output}) 
    except Exception as e:
        app.logger.error(f"Error in api_get_pod_logs_from_path for {namespace}/{pod_name}: {str(e)}")
        return jsonify({"error": f"Server error fetching pod logs: {str(e)}"}), 500

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

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    return None

@socketio.on('disconnect')
def handle_disconnect_pty(): # Renamed to avoid potential conflict if another disconnect handler exists
    sid = request.sid
    logger.info(f'Client disconnected: {sid}. Checking for active PTY session for cleanup.')
    session_to_clean = active_pty_sessions.pop(sid, None) # Atomically pop to prevent race conditions
    
    if session_to_clean:
        logger.info(f"Cleaning up PTY session for disconnected client {sid} (type: {session_to_clean.get('type')}, pod: {session_to_clean.get('namespace')}/{session_to_clean.get('pod_name')})")
        fd_to_close = session_to_clean.get('fd')
        pid_to_kill = session_to_clean.get('pid')
        session_type = session_to_clean.get('type', 'unknown_pty')

        if fd_to_close is not None:
            try:
                os.close(fd_to_close)
                logger.info(f"[{session_type} sid:{sid}] Closed PTY FD {fd_to_close} on disconnect.")
            except OSError as e:
                 logger.warning(f"[{session_type} sid:{sid}] OSError on closing PTY FD {fd_to_close} on disconnect (may already be closed): {e}")
        
        if pid_to_kill:
            logger.info(f"[{session_type} sid:{sid}] Killing PID {pid_to_kill} on disconnect.")
            try:
                 os.kill(pid_to_kill, signal.SIGTERM)
                 time.sleep(0.1) 
                 os.kill(pid_to_kill, signal.SIGKILL) 
                 logger.info(f"[{session_type} sid:{sid}] Sent SIGKILL to PID {pid_to_kill} on disconnect.")
            except ProcessLookupError:
                 logger.info(f"[{session_type} sid:{sid}] Process {pid_to_kill} already exited on disconnect (ProcessLookupError).")
            except Exception as e:
                 logger.error(f"[{session_type} sid:{sid}] Error killing process {pid_to_kill} on disconnect: {e}")
    else:
        logger.info(f"No active PTY session found for disconnected client {sid} during disconnect handling.")

@socketio.on('pod_exec_start')
def handle_pod_exec_start(data):
    sid = request.sid
    namespace = data.get('namespace')
    pod_name = data.get('pod_name')
    logger.info(f"[pod_exec sid:{sid}] Received pod_exec_start for {namespace}/{pod_name}")
    if not namespace or not pod_name:
        socketio.emit('pod_exec_output', {'error': 'Namespace and pod name are required for pod exec.', 'namespace': namespace, 'pod_name': pod_name}, room=sid)
        return
    _start_pty_session(sid, namespace, pod_name, 'pod_exec_output', 'pod_exec_exit', 'pod_exec')

@socketio.on('pod_exec_input')
def handle_pod_exec_input(data):
    sid = request.sid
    input_data = data.get('input')
    session = active_pty_sessions.get(sid)
    if session and session['type'] == 'pod_exec' and input_data is not None:
        logger.debug(f"[pod_exec sid:{sid}] Received input for {session['namespace']}/{session['pod_name']}: {len(input_data)} bytes")
        try:
            os.write(session['fd'], input_data.encode('utf-8'))
        except OSError as e:
            logger.error(f"[pod_exec sid:{sid}] OSError writing to PTY for {session['namespace']}/{session['pod_name']}: {e}")
        except Exception as e:
            logger.error(f"[pod_exec sid:{sid}] Exception writing to PTY: {e}")
    elif not session:
        logger.warning(f"[pod_exec sid:{sid}] Input received but no active session found.")
    elif session['type'] != 'pod_exec':
        logger.warning(f"[pod_exec sid:{sid}] Input received for a session of type {session['type']}, expected 'pod_exec'.")

@socketio.on('control_plane_cli_start')
def handle_control_plane_cli_start(data={}):
    sid = request.sid
    logger.info(f"[ctrl_cli sid:{sid}] Received control_plane_cli_start")
    if not APP_POD_NAME or not APP_POD_NAMESPACE:
        logger.warning(f"[ctrl_cli sid:{sid}] APP_POD_NAME or APP_POD_NAMESPACE not configured. CLI cannot start.")
        socketio.emit('control_plane_cli_output', {'error': 'Control Plane CLI target pod not configured on server.'}, room=sid)
        return
    _start_pty_session(sid, APP_POD_NAMESPACE, APP_POD_NAME, 'control_plane_cli_output', 'control_plane_cli_exit', 'ctrl_cli')

@socketio.on('control_plane_cli_input')
def handle_control_plane_cli_input(data):
    sid = request.sid
    input_data = data.get('input')
    session = active_pty_sessions.get(sid)

    if session and session['type'] == 'ctrl_cli' and input_data is not None:
        logger.debug(f"[ctrl_cli sid:{sid}] Received input: {len(input_data)} bytes")
        try:
            os.write(session['fd'], input_data.encode('utf-8'))
        except OSError as e:
            logger.error(f"[ctrl_cli sid:{sid}] OSError writing to PTY: {e}")
        except Exception as e:
            logger.error(f"[ctrl_cli sid:{sid}] Exception writing to PTY: {e}")
    elif not session:
        logger.warning(f"[ctrl_cli sid:{sid}] Input received but no active session found.")
    elif session['type'] != 'ctrl_cli':
        logger.warning(f"[ctrl_cli sid:{sid}] Input received for a session of type {session['type']}, expected 'ctrl_cli'.")

def set_pty_size(fd, rows, cols, width_px=0, height_px=0):
    logger.info(f"Setting PTY size: FD={fd}, Rows={rows}, Cols={cols}")
    try:
        winsize = struct.pack('HHHH', rows, cols, width_px, height_px)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception as e:
        logger.error(f"Error setting PTY size for FD={fd}: {e}")

@socketio.on('pty_resize') 
def handle_pty_resize(data):
    sid = request.sid
    session = active_pty_sessions.get(sid)
    if session:
        try:
            rows = int(data.get('rows'))
            cols = int(data.get('cols'))
            if rows > 0 and cols > 0 :
                 logger.info(f"[pty_resize sid:{sid}] Resizing PTY for {session.get('type')} session to {rows}x{cols}")
                 set_pty_size(session['fd'], rows, cols)
            else:
                logger.warning(f"[pty_resize sid:{sid}] Invalid rows/cols for resize: {data}")
        except Exception as e:
            logger.error(f"[pty_resize sid:{sid}] Error resizing PTY: {e}")
    else:
        logger.warning(f"[pty_resize sid:{sid}] Resize event received but no active session.")

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

@app.route('/api/refresh-database', methods=['POST'])
def refresh_database():
    """Manually refresh the database with current Kubernetes resources."""
    try:
        updater._update_resources()
        return jsonify({
            'success': True,
            'message': 'Database refreshed successfully'
        })
    except Exception as e:
        logging.error(f"Error refreshing database: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port='8080', allow_unsafe_werkzeug=True)