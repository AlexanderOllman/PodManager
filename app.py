from flask import Flask, render_template, request, jsonify
import subprocess
import json

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/run', methods=['POST'])
def run_command():
    command = request.form['command']
    try:
        result = subprocess.run(command, shell=True, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output = result.stdout.decode('utf-8') + result.stderr.decode('utf-8')
    except subprocess.CalledProcessError as e:
        output = e.stdout.decode('utf-8') + e.stderr.decode('utf-8')
    
    if command.startswith('kubectl get pods -A'):
        try:
            output_json = subprocess.run(f"{command} -o json", shell=True, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            output = output_json.stdout.decode('utf-8')
            pods = json.loads(output)
            return jsonify(format='table', data=pods)
        except subprocess.CalledProcessError as e:
            output = e.stdout.decode('utf-8') + e.stderr.decode('utf-8')
    
    return jsonify(format='text', output=output)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port='8080')