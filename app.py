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
import re
from typing import Optional, Union, Dict

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

def run_kubectl_command(command: list, is_json_output: bool = True) -> Optional[Union[dict, str]]:
    """Runs a kubectl command and returns its output."""
    try:
        full_command = ['kubectl'] + command
        logging.info(f"Running kubectl command: {' '.join(full_command)}")
        process = subprocess.Popen(full_command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        stdout, stderr = process.communicate(timeout=60) # 60-second timeout

        if process.returncode != 0:
            logging.error(f"Error running kubectl command {' '.join(full_command)}: {stderr.strip()}")
            return None
        
        if is_json_output:
            return json.loads(stdout)
        return stdout.strip()
    except subprocess.TimeoutExpired:
        logging.error(f"Timeout running kubectl command: {' '.join(full_command)}")
        if process:
            process.kill()
            process.communicate()
        return None
    except json.JSONDecodeError as e:
        logging.error(f"Failed to decode JSON from kubectl command {' '.join(full_command)}: {e}")
        logging.debug(f"Non-JSON stdout from kubectl: {stdout[:500]}...") # Log first 500 chars
        return None
    except Exception as e:
        logging.error(f"An unexpected error occurred running kubectl command {' '.join(full_command)}: {str(e)}")
        return None

# --- Helper functions for metrics collection ---
def parse_cpu_to_millicores(cpu_string: str) -> int:
    """Converts a CPU string (e.g., '500m', '1', '0.5') to millicores."""
    if not cpu_string:
        return 0
    cpu_string = str(cpu_string).strip()
    if cpu_string.endswith('m'): # millicores
        return int(cpu_string[:-1])
    if cpu_string.endswith('u'): # microcores
        return int(cpu_string[:-1]) // 1000 
    if cpu_string.endswith('n'): # nanocores
        return int(cpu_string[:-1]) // 1000000
    try:
        # Assuming it's in full cores if no suffix
        return int(float(cpu_string) * 1000)
    except ValueError:
        logging.warning(f"Could not parse CPU string: {cpu_string}")
        return 0

def parse_memory_to_bytes(memory_string: str) -> int:
    """Converts a memory string (e.g., '128Mi', '1Gi', '500Ki', '1024') to bytes."""
    if not memory_string:
        return 0
    memory_string = str(memory_string).strip()
    multipliers = {
        'k': 1000, 'ki': 1024,
        'm': 1000**2, 'mi': 1024**2,
        'g': 1000**3, 'gi': 1024**3,
        't': 1000**4, 'ti': 1024**4,
        'p': 1000**5, 'pi': 1024**5,
        'e': 1000**6, 'ei': 1024**6,
    }
    # Normalize to lowercase and identify multiplier
    memory_string_lower = memory_string.lower()
    unit = None
    value_str = memory_string_lower

    for u in sorted(multipliers.keys(), key=len, reverse=True): # Check longer units first (e.g., 'ki' before 'k')
        if memory_string_lower.endswith(u):
            unit = u
            value_str = memory_string_lower[:-len(u)]
            break
    
    try:
        value = float(value_str)
        if unit:
            return int(value * multipliers[unit])
        else: # Assume bytes if no unit
            return int(value)
    except ValueError:
        logging.warning(f"Could not parse memory string: {memory_string}")
        return 0

def _extract_limits_from_describe_nodes(describe_output: str) -> Dict[str, int]:
    """Parses the 'Allocated resources' section of 'kubectl describe nodes' output."""
    limits = {'cpu_limit_percentage': 100, 'memory_limit_percentage': 100} # Default to 100% if not found
    try:
        # Regex to find the Limits percentage for CPU and Memory
        # Example line: cpu                        10m (0%)           100m (10%)
        cpu_match = re.search(r"cpu\\s+\\S+\\s+\\(\\S+?\\)\\s+\\S+\\s+\\((\\d+)%\\)", describe_output)
        memory_match = re.search(r"memory\\s+\\S+\\s+\\(\\S+?\\)\\s+\\S+\\s+\\((\\d+)%\\)", describe_output)

        if cpu_match:
            limits['cpu_limit_percentage'] = int(cpu_match.group(1))
        else:
            logging.warning("Could not find CPU limit percentage in 'kubectl describe nodes' output.")

        if memory_match:
            limits['memory_limit_percentage'] = int(memory_match.group(1))
        else:
            logging.warning("Could not find Memory limit percentage in 'kubectl describe nodes' output.")
            
    except Exception as e:
        logging.error(f"Error parsing 'kubectl describe nodes' output for limits: {e}")
    return limits

def _collect_and_store_environment_metrics():
    """Collects cluster-wide metrics and stores them in the database."""
    logging.info("Starting collection of environment metrics...")
    
    nodes_data = run_kubectl_command(["get", "nodes", "-o", "json"])
    if not nodes_data or 'items' not in nodes_data:
        logging.error("Failed to fetch node data or data format is incorrect.")
        return

    total_pod_capacity = 0
    total_allocatable_cpu_millicores = 0
    total_allocatable_memory_bytes = 0
    total_allocatable_gpus = 0

    for node in nodes_data.get('items', []):
        status = node.get('status', {})
        capacity = status.get('capacity', {})
        allocatable = status.get('allocatable', {})

        total_pod_capacity += int(capacity.get('pods', 0))
        total_allocatable_cpu_millicores += parse_cpu_to_millicores(allocatable.get('cpu', '0'))
        total_allocatable_memory_bytes += parse_memory_to_bytes(allocatable.get('memory', '0'))
        # Assuming GPU resource name is 'nvidia.com/gpu'. This might need to be configurable or detected.
        total_allocatable_gpus += int(allocatable.get('nvidia.com/gpu', 0)) 

    # Fetch overallocation limits from 'kubectl describe nodes'
    # This command output is text, not JSON, so we parse it differently
    describe_nodes_output = run_kubectl_command(["describe", "nodes"], is_json_output=False)
    overcommit_limits = {'cpu_limit_percentage': 100, 'memory_limit_percentage': 100} # Defaults
    if describe_nodes_output:
        overcommit_limits = _extract_limits_from_describe_nodes(describe_output)
    else:
        logging.warning("Failed to get 'kubectl describe nodes' output for overcommit limits. Using defaults.")

    metrics_data = {
        'total_node_pod_capacity': total_pod_capacity,
        'total_node_allocatable_cpu_millicores': total_allocatable_cpu_millicores,
        'total_node_allocatable_memory_bytes': total_allocatable_memory_bytes,
        'total_node_allocatable_gpus': total_allocatable_gpus,
        'cpu_limit_percentage': overcommit_limits['cpu_limit_percentage'],
        'memory_limit_percentage': overcommit_limits['memory_limit_percentage']
    }

    if db.update_environment_metrics(metrics_data):
        logging.info("Successfully collected and stored environment metrics.")
    else:
        logging.error("Failed to store environment metrics in the database.")
# --- End Helper functions for metrics collection ---

# Initialize the updater from background_tasks
# (updater instance is created in background_tasks.py and imported)
if updater and hasattr(updater, 'set_env_metrics_collector'):
    updater.set_env_metrics_collector(_collect_and_store_environment_metrics)
    logging.info("Environment metrics collector has been set for the background updater.")
else:
    logging.warning("Updater not available or does not have set_env_metrics_collector method.")

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

# Flask routes and other functions start here
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
            socketio.sleep(0.01)
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
        socketio.emit(output_event_name, {'error': 'Session already active for this client.', 'namespace': exec_namespace, 'pod_name': exec_pod_name}, room=sid)
        return

    try:
        (child_pid, fd) = pty.fork()
        if child_pid == 0: # Child process
            env = os.environ.copy()
            env['TERM'] = 'xterm'
            # Try /bin/bash first, as it's generally more robust for interactive sessions
            shell_path = '/bin/bash' 
            cmd_list = ['kubectl', 'exec', '-i', '-t', exec_pod_name, '-n', exec_namespace, '--', shell_path, '-i']
            
            logger.info(f"[{session_type_val} child_pid:{os.getpid()}] Attempting to execute in PTY: {' '.join(cmd_list)}")
            try:
                os.execvpe(cmd_list[0], cmd_list, env)
            except FileNotFoundError: # Specific exception for command not found
                logger.warning(f"[{session_type_val} child_pid:{os.getpid()}] {shell_path} not found, trying /bin/sh.")
                shell_path = '/bin/sh'
                cmd_list = ['kubectl', 'exec', '-i', '-t', exec_pod_name, '-n', exec_namespace, '--', shell_path, '-i']
                logger.info(f"[{session_type_val} child_pid:{os.getpid()}] Attempting to execute in PTY (fallback): {' '.join(cmd_list)}")
                os.execvpe(cmd_list[0], cmd_list, env) # If this also fails, it will raise an exception captured below
            
            # If execvpe returns, it means an error occurred (e.g. command not found, permissions)
            # This part should ideally not be reached if execvpe is successful.
            logger.error(f"[{session_type_val} child_pid:{os.getpid()}] execvpe failed for {' '.join(cmd_list)} even after potential fallback. Exiting child.")
            os._exit(1) 

        else: # Parent process
            active_pty_sessions[sid] = {
                'pid': child_pid, 
                'fd': fd,
                'namespace': exec_namespace, 
                'pod_name': exec_pod_name,
                'type': session_type_val
            }
            logger.info(f"[{session_type_val} sid:{sid}] PTY session created: PID={child_pid}, FD={fd}")
            
            try:
                set_pty_size(fd, 24, 80) # Default rows/cols
                logger.info(f"[{session_type_val} sid:{sid}] Initial PTY size set to 24x80 for FD {fd}.")
            except Exception as e_size:
                logger.warning(f"[{session_type_val} sid:{sid}] Failed to set initial PTY size for FD {fd}: {e_size}")

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
        if sid in active_pty_sessions: 
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
def handle_disconnect_pty(): 
    sid = request.sid
    logger.info(f'Client disconnected: {sid}. Checking for active PTY session for cleanup.')
    _cleanup_pty_session(sid, "disconnect") # Pass reason for logging

# New handler for explicit termination requests from the client
@socketio.on('control_plane_cli_terminate_request')
def handle_control_plane_cli_terminate_request():
    sid = request.sid
    logger.info(f'[ctrl_cli sid:{sid}] Received control_plane_cli_terminate_request.')
    _cleanup_pty_session(sid, "terminate_request", session_type_filter='ctrl_cli')

# Refactored cleanup logic into a helper function
def _cleanup_pty_session(sid, reason_str, session_type_filter=None):
    session_to_clean = active_pty_sessions.get(sid) # Check before pop

    if session_to_clean:
        # If a session_type_filter is provided, only clean if the type matches
        if session_type_filter and session_to_clean.get('type') != session_type_filter:
            logger.info(f"[{session_to_clean.get('type', 'unknown_pty')} sid:{sid}] Cleanup skipped for session type {session_to_clean.get('type')} due to filter '{session_type_filter}' during {reason_str}.")
            return
        
        active_pty_sessions.pop(sid, None) # Now pop it
        session_type = session_to_clean.get('type', 'unknown_pty')
        log_prefix = f"[{session_type} sid:{sid}]"

        logger.info(f"{log_prefix} Cleaning up PTY session for SID {sid} (reason: {reason_str}, pod: {session_to_clean.get('namespace')}/{session_to_clean.get('pod_name')})")
        fd_to_close = session_to_clean.get('fd')
        pid_to_kill = session_to_clean.get('pid')

        if fd_to_close is not None:
            try:
                os.close(fd_to_close)
                logger.info(f"{log_prefix} Closed PTY FD {fd_to_close}.")
            except OSError as e:
                 logger.warning(f"{log_prefix} OSError on closing PTY FD {fd_to_close} (may already be closed): {e}")
        
        if pid_to_kill:
            logger.info(f"{log_prefix} Attempting to terminate PID {pid_to_kill}.")
            try:
                 os.kill(pid_to_kill, signal.SIGTERM) # Politely ask
                 time.sleep(0.1) # Give it a moment
                 os.kill(pid_to_kill, signal.SIGKILL) # Ensure it's gone
                 logger.info(f"{log_prefix} Sent SIGKILL to PID {pid_to_kill}.")
            except ProcessLookupError:
                 logger.info(f"{log_prefix} Process {pid_to_kill} already gone.")
            except Exception as e:
                 logger.error(f"{log_prefix} Error killing process {pid_to_kill}: {e}")
    else:
        logger.info(f"No active PTY session found for SID {sid} during {reason_str} cleanup (filter: {session_type_filter or 'None'}).")

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
    try:  # Outer try for the whole handler logic
        if session and session['type'] == 'pod_exec' and input_data is not None:
            logger.debug(f"[pod_exec sid:{sid}] Received input for {session['namespace']}/{session['pod_name']}: {len(input_data)} bytes")
            try:  # Inner try specifically for os.write
                os.write(session['fd'], input_data.encode('utf-8'))
            except OSError as e_os: # Specific exception for os.write
                logger.error(f"[pod_exec sid:{sid}] OSError writing to PTY for {session['namespace']}/{session['pod_name']}: {e_os}")
        elif not session:
            logger.warning(f"[pod_exec sid:{sid}] Input received but no active session found.")
        elif session['type'] != 'pod_exec': # Check if type is not 'pod_exec'
             logger.warning(f"[pod_exec sid:{sid}] Input received for session type {session['type']}, expected 'pod_exec'.")
        # Add other conditions or an else if necessary based on original intent for input_data being None etc.
            
    except Exception as e: # General exception for the whole handler, now correctly placed
            logger.error(f"[pod_exec sid:{sid}] General exception processing input for PTY: {e}", exc_info=True)

# Similar explicit termination for pod_exec if needed in the future
@socketio.on('pod_exec_terminate_request')
def handle_pod_exec_terminate_request():
    sid = request.sid
    logger.info(f"[pod_exec sid:{sid}] Received pod_exec_terminate_request.")
    _cleanup_pty_session(sid, "terminate_request", session_type_filter='pod_exec')

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
    try:  # Outer try for the whole handler logic
        if session and session['type'] == 'ctrl_cli' and input_data is not None:
            logger.debug(f"[ctrl_cli sid:{sid}] Received input: {len(input_data)} bytes")
            try:  # Inner try specifically for os.write
                os.write(session['fd'], input_data.encode('utf-8'))
            except OSError as e_os: # Specific exception for os.write
                logger.error(f"[ctrl_cli sid:{sid}] OSError writing to PTY: {e_os}")
        elif not session:
            logger.warning(f"[ctrl_cli sid:{sid}] Input received but no active session found.")
        elif session['type'] != 'ctrl_cli': # Check if type is not 'ctrl_cli'
            logger.warning(f"[ctrl_cli sid:{sid}] Input received for session type {session['type']}, expected 'ctrl_cli'.")
        # Add other conditions or an else if necessary based on original intent

    except Exception as e: # General exception for the whole handler, now correctly placed
            logger.error(f"[ctrl_cli sid:{sid}] General exception processing input for PTY: {e}", exc_info=True)

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
            if rows > 0 and cols > 0: # Inner if
                 logger.info(f"[pty_resize sid:{sid}] Resizing PTY for {session.get('type')} session to {rows}x{cols}")
                 set_pty_size(session['fd'], rows, cols)
            else: # Else for the inner if, now correctly indented within the try block
                logger.warning(f"[pty_resize sid:{sid}] Invalid rows/cols for resize: {data}")
        except Exception as e: # This except is for the try block
            logger.error(f"[pty_resize sid:{sid}] Error resizing PTY: {e}", exc_info=True)
    else: # This else is for the outer 'if session:'
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
    """Manually refresh the database with current Kubernetes resources and environment metrics."""
    try:
        logging.info("Manual database refresh requested: Updating Kubernetes resources...")
        updater._update_resources() # Existing call to update standard k8s resources
        logging.info("Manual database refresh: Updating environment metrics...")
        _collect_and_store_environment_metrics() # New call for environment metrics
        return jsonify({
            'success': True,
            'message': 'Database and environment metrics refreshed successfully'
        })
    except Exception as e:
        logging.error(f"Error refreshing database and environment metrics: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/environment_metrics', methods=['GET'])
def get_environment_metrics_endpoint():
    try:
        env_metrics = db.get_latest_environment_metrics()
        if not env_metrics:
            # Fallback: try to collect them if missing, then try again.
            logging.warning("Environment metrics not found in DB, attempting to collect now.")
            _collect_and_store_environment_metrics() # Attempt to populate
            env_metrics = db.get_latest_environment_metrics() # Try fetching again
            if not env_metrics:
                logging.error("Failed to retrieve or collect environment metrics.")
                return jsonify({"error": "Environment metrics are currently unavailable."}), 503

        all_pods_data = db.get_resources('pods') # This returns a list of dicts (parsed JSON)

        current_running_pods = 0
        current_cpu_request_millicores = 0
        current_memory_request_bytes = 0
        current_gpu_request_units = 0

        for pod_resource in all_pods_data:
            # pod_resource is the full pod JSON structure stored in the 'data' column
            # Ensure it's a dict, though db.get_resources should already handle json.loads
            if not isinstance(pod_resource, dict):
                logging.warning(f"Skipping pod resource as it is not a dict: {type(pod_resource)}")
                continue

            status_phase = pod_resource.get('status', {}).get('phase', '').lower()
            if status_phase == 'running':
                current_running_pods += 1
            
            spec = pod_resource.get('spec', {})
            for container in spec.get('containers', []):
                resources = container.get('resources', {})
                requests = resources.get('requests', {})
                if requests:
                    current_cpu_request_millicores += parse_cpu_to_millicores(requests.get('cpu', '0'))
                    current_memory_request_bytes += parse_memory_to_bytes(requests.get('memory', '0'))
                    # Assuming GPU resource name is 'nvidia.com/gpu'. This should match collection logic.
                    current_gpu_request_units += int(requests.get('nvidia.com/gpu', 0))
            
            # Consider initContainers as well if their requests should be counted towards active usage
            for init_container in spec.get('initContainers', []):
                resources = init_container.get('resources', {})
                requests = resources.get('requests', {})
                if requests: # Typically init containers run to completion, but their peak could be considered
                           # For simplicity, often only running container requests are summed for 'active' usage.
                           # We will include them here as they can contribute to allocatable pressure.
                    current_cpu_request_millicores += parse_cpu_to_millicores(requests.get('cpu', '0'))
                    current_memory_request_bytes += parse_memory_to_bytes(requests.get('memory', '0'))
                    current_gpu_request_units += int(requests.get('nvidia.com/gpu', 0))


        # Prepare the response
        response_data = {
            'pods': {
                'total_capacity': env_metrics.get('total_node_pod_capacity', 0),
                'current_running': current_running_pods,
                'percentage_running': 0
            },
            'vcpu': {
                'total_allocatable_millicores': env_metrics.get('total_node_allocatable_cpu_millicores', 0),
                'current_request_millicores': current_cpu_request_millicores,
                'percentage_utilized': 0,
                'limit_percentage': env_metrics.get('cpu_limit_percentage', 100),
                'overprovision_limit_millicores': 0
            },
            'memory': {
                'total_allocatable_bytes': env_metrics.get('total_node_allocatable_memory_bytes', 0),
                'current_request_bytes': current_memory_request_bytes,
                'percentage_utilized': 0,
                'limit_percentage': env_metrics.get('memory_limit_percentage', 100),
                'overprovision_limit_bytes': 0
            },
            'gpu': {
                'total_allocatable_units': env_metrics.get('total_node_allocatable_gpus', 0),
                'current_request_units': current_gpu_request_units,
                'percentage_utilized': 0
            },
            'last_updated_timestamp': env_metrics.get('timestamp')
        }

        # Calculate percentages and overprovision limits
        if response_data['pods']['total_capacity'] > 0:
            response_data['pods']['percentage_running'] = round(
                (response_data['pods']['current_running'] / response_data['pods']['total_capacity']) * 100, 1
            )

        if response_data['vcpu']['total_allocatable_millicores'] > 0:
            response_data['vcpu']['percentage_utilized'] = round(
                (response_data['vcpu']['current_request_millicores'] / response_data['vcpu']['total_allocatable_millicores']) * 100, 1
            )
            response_data['vcpu']['overprovision_limit_millicores'] = int(
                response_data['vcpu']['total_allocatable_millicores'] * (response_data['vcpu']['limit_percentage'] / 100.0)
            )

        if response_data['memory']['total_allocatable_bytes'] > 0:
            response_data['memory']['percentage_utilized'] = round(
                (response_data['memory']['current_request_bytes'] / response_data['memory']['total_allocatable_bytes']) * 100, 1
            )
            response_data['memory']['overprovision_limit_bytes'] = int(
                response_data['memory']['total_allocatable_bytes'] * (response_data['memory']['limit_percentage'] / 100.0)
            )

        if response_data['gpu']['total_allocatable_units'] > 0:
            response_data['gpu']['percentage_utilized'] = round(
                (response_data['gpu']['current_request_units'] / response_data['gpu']['total_allocatable_units']) * 100, 1
            )
        
        return jsonify(response_data)

    except Exception as e:
        logging.error(f"Error in /api/environment_metrics endpoint: {str(e)}", exc_info=True)
        return jsonify({"error": "An error occurred while fetching environment metrics."}), 500

if __name__ == '__main__':
    # This block runs when you execute `python app.py` directly.
    # It's common to run development server here.
    # Set the collector for the updater instance when running directly
    if updater and hasattr(updater, 'set_env_metrics_collector'):
        updater.set_env_metrics_collector(_collect_and_store_environment_metrics)
    
    with app.app_context(): # Ensures logs etc. within this are tied to app context
        # Optionally, collect once on direct run startup, after updater is configured
        _collect_and_store_environment_metrics() 
    socketio.run(app, debug=True, host='0.0.0.0', port='8080', allow_unsafe_werkzeug=True)