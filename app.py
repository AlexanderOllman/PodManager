from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import subprocess
import json
import os
import tempfile
import threading
import git
import shutil
import sys
import logging
import eventlet

# Patch standard library for better Socket.IO performance
eventlet.monkey_patch()

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Configure logging
logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)

def run_kubectl_command(command):
    try:
        result = subprocess.run(command, shell=True, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result.stdout.decode('utf-8')
    except subprocess.CalledProcessError as e:
        app.logger.error(f"kubectl command failed: {e.stderr.decode('utf-8')}")
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

@app.route('/get_events', methods=['POST'])
def get_events():
    namespace = request.form['namespace']
    command = f"kubectl get events -n {namespace} --sort-by='.lastTimestamp'"
    output = run_kubectl_command(command)
    return jsonify(output=output)

@app.route('/update_from_github', methods=['POST'])
def update_from_github():
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
    try:
        return render_template('explore.html', namespace=namespace, pod_name=pod_name)
    except Exception as e:
        app.logger.error(f"Error in explore_pod: {str(e)}")
        return render_template('error.html', error=str(e)), 500

@app.route('/api/pod/describe', methods=['POST'])
def api_pod_describe():
    try:
        namespace = request.form['namespace']
        pod_name = request.form['pod_name']
        command = f"kubectl describe pod {pod_name} -n {namespace}"
        output = run_kubectl_command(command)
        return jsonify(output=output)
    except Exception as e:
        app.logger.error(f"Error in api_pod_describe: {str(e)}")
        return jsonify(error=str(e)), 500

@app.route('/api/pod/logs', methods=['POST'])
def api_pod_logs():
    try:
        namespace = request.form['namespace']
        pod_name = request.form['pod_name']
        tail_lines = request.form.get('tail_lines', '1000')
        command = f"kubectl logs {pod_name} -n {namespace} --tail={tail_lines}"
        output = run_kubectl_command(command)
        return jsonify(output=output)
    except Exception as e:
        app.logger.error(f"Error in api_pod_logs: {str(e)}")
        return jsonify(error=str(e)), 500

@app.route('/api/pod/exec', methods=['POST'])
def api_pod_exec():
    try:
        namespace = request.form['namespace']
        pod_name = request.form['pod_name']
        command = request.form.get('command', 'ls -la')
        kubectl_command = f"kubectl exec {pod_name} -n {namespace} -- {command}"
        output = run_kubectl_command(kubectl_command)
        return jsonify(output=output)
    except Exception as e:
        app.logger.error(f"Error in api_pod_exec: {str(e)}")
        return jsonify(error=str(e)), 500

@app.route('/health')
def health_check():
    return jsonify(status="healthy"), 200

@app.route('/readiness')
def readiness_check():
    return jsonify(status="ready"), 200

# Socket.IO event handlers
@socketio.on('connect')
def handle_connect():
    app.logger.info(f"Client connected: {request.sid}")

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f"Client disconnected: {request.sid}")

@socketio.on('pod_command')
def handle_pod_command(data):
    try:
        namespace = data.get('namespace')
        pod_name = data.get('pod_name')
        command = data.get('command')
        
        if not all([namespace, pod_name, command]):
            socketio.emit('command_output', {'error': 'Missing required parameters'}, room=request.sid)
            return
            
        kubectl_command = f"kubectl exec {pod_name} -n {namespace} -- {command}"
        result = subprocess.run(kubectl_command, shell=True, capture_output=True, text=True)
        
        if result.returncode == 0:
            socketio.emit('command_output', {'output': result.stdout}, room=request.sid)
        else:
            socketio.emit('command_output', {'error': result.stderr}, room=request.sid)
    except Exception as e:
        app.logger.error(f"Error in pod_command: {str(e)}")
        socketio.emit('command_output', {'error': str(e)}, room=request.sid)

if __name__ == '__main__':
    # Use Eventlet WSGI server instead of Flask's development server
    socketio.run(app, debug=True, host='0.0.0.0', port=8080)