/**
 * HPE Private Cloud AI Resource Manager
 * Explore Page JavaScript file
 */

// These variables will be set when the page loads
let namespace;
let podName;

function initializeExplorePage() {
    console.log(`Initializing explore page for pod: ${podName} in namespace: ${namespace}`);
    
    // Load the pod description immediately
    loadPodDescription();
    
    // Set up tab handlers
    document.getElementById('logs-tab').addEventListener('click', loadPodLogs);
    document.getElementById('access-tab').addEventListener('click', setupTerminal);
    
    // Set up button handlers
    document.getElementById('refreshLogs').addEventListener('click', loadPodLogs);
    document.getElementById('downloadLogs').addEventListener('click', downloadLogs);
    
    // Back button handler that uses SPA navigation
    document.getElementById('backButton').addEventListener('click', function(e) {
        e.preventDefault();
        console.log("Returning to home page");
        window.location.href = '/'; // Use direct navigation instead of SPA
    });
}

function loadPodDescription() {
    console.log('Loading pod description...');
    document.getElementById('describeLoading').style.display = 'flex';
    document.getElementById('describeOutput').style.display = 'none';
    
    // Use JSON content type for better error handling
    fetch('/api/pod/describe', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            namespace: namespace,
            pod_name: podName
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Pod description loaded successfully');
        document.getElementById('describeOutput').textContent = data.output;
        document.getElementById('describeLoading').style.display = 'none';
        document.getElementById('describeOutput').style.display = 'block';
    })
    .catch(error => {
        console.error('Error loading pod description:', error);
        document.getElementById('describeOutput').textContent = `Error loading pod description: ${error.message}`;
        document.getElementById('describeLoading').style.display = 'none';
        document.getElementById('describeOutput').style.display = 'block';
    });
}

function loadPodLogs() {
    console.log('Loading pod logs...');
    document.getElementById('logsLoading').style.display = 'flex';
    document.getElementById('logsOutput').style.display = 'none';
    
    // Use JSON content type for better error handling
    fetch('/api/pod/logs', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            namespace: namespace,
            pod_name: podName,
            tail_lines: 1000
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Pod logs loaded successfully');
        document.getElementById('logsOutput').textContent = data.output;
        document.getElementById('logsLoading').style.display = 'none';
        document.getElementById('logsOutput').style.display = 'block';
    })
    .catch(error => {
        console.error('Error loading pod logs:', error);
        document.getElementById('logsOutput').textContent = `Error loading pod logs: ${error.message}`;
        document.getElementById('logsLoading').style.display = 'none';
        document.getElementById('logsOutput').style.display = 'block';
    });
}

function downloadLogs() {
    const logsContent = document.getElementById('logsOutput').textContent;
    const blob = new Blob([logsContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function setupTerminal() {
    if (document.getElementById('terminal')) {
        if (!window.terminalInstance) {
            window.terminalInstance = new Terminal({
                cursorBlink: true,
                fontFamily: 'monospace',
                fontSize: 14,
                convertEol: true,
                scrollback: 1000,
                theme: {
                    background: '#000000',
                    foreground: '#ffffff'
                }
            });
            
            window.terminalInstance.open(document.getElementById('terminal'));
            
            // Setup command input handling
            let currentLine = '';
            let commandHistory = [];
            let historyIndex = -1;
            
            // Initial prompt
            window.terminalInstance.writeln('Welcome to the pod terminal.');
            window.terminalInstance.writeln('Type commands directly in this window and press Enter to execute.');
            window.terminalInstance.writeln('');
            window.terminalInstance.write('$ ');
            
            // Handle user input
            window.terminalInstance.onKey(({ key, domEvent }) => {
                const printable = !domEvent.altKey && !domEvent.altGraphKey && !domEvent.ctrlKey && !domEvent.metaKey;
                
                // Handle special keys
                if (domEvent.keyCode === 13) { // Enter key
                    // Send command to server
                    if (currentLine.trim()) {
                        // Add to history
                        commandHistory.push(currentLine);
                        historyIndex = commandHistory.length;
                        
                        // Execute in pod
                        executeCommandInPod(currentLine);
                        
                        // Visual feedback
                        window.terminalInstance.write('\r\n');
                        currentLine = '';
                    } else {
                        // Empty command, just show new prompt
                        window.terminalInstance.write('\r\n$ ');
                    }
                } else if (domEvent.keyCode === 8) { // Backspace
                    if (currentLine.length > 0) {
                        currentLine = currentLine.slice(0, -1);
                        window.terminalInstance.write('\b \b'); // Erase character
                    }
                } else if (domEvent.keyCode === 38) { // Up arrow - history
                    if (historyIndex > 0) {
                        historyIndex--;
                        // Clear current line
                        window.terminalInstance.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                        // Display command from history
                        currentLine = commandHistory[historyIndex];
                        window.terminalInstance.write(currentLine);
                    }
                } else if (domEvent.keyCode === 40) { // Down arrow - history
                    if (historyIndex < commandHistory.length - 1) {
                        historyIndex++;
                        // Clear current line
                        window.terminalInstance.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                        // Display next command from history
                        currentLine = commandHistory[historyIndex];
                        window.terminalInstance.write(currentLine);
                    } else if (historyIndex === commandHistory.length - 1) {
                        historyIndex = commandHistory.length;
                        // Clear current line
                        window.terminalInstance.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                        currentLine = '';
                    }
                } else if (printable) {
                    // Regular printable character
                    currentLine += key;
                    window.terminalInstance.write(key);
                }
            });
        } else {
            // Terminal already exists, just reset it
            window.terminalInstance.clear();
            window.terminalInstance.writeln('Welcome to the pod terminal.');
            window.terminalInstance.writeln('Type commands directly in this window and press Enter to execute.');
            window.terminalInstance.writeln('');
            window.terminalInstance.write('$ ');
        }
    }
}

function executeCommandInPod(command) {
    if (!command) return;
    
    fetch('/api/pod/exec', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            namespace: namespace,
            pod_name: podName,
            command: command
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.output) {
            window.terminalInstance.writeln(data.output);
        } else {
            window.terminalInstance.writeln('Command executed with no output.');
        }
        window.terminalInstance.write('\r\n$ ');
    })
    .catch(error => {
        console.error('Error:', error);
        window.terminalInstance.writeln('Error executing command.');
        window.terminalInstance.write('\r\n$ ');
    });
}

// Set up the namespace and podName variables when the script is loaded
document.addEventListener('DOMContentLoaded', function() {
    // These values will be populated from the template
    const namespaceElement = document.getElementById('namespace-data');
    const podNameElement = document.getElementById('pod-name-data');
    
    if (namespaceElement && podNameElement) {
        namespace = namespaceElement.dataset.namespace;
        podName = podNameElement.dataset.podName;
        
        // Initialize the page
        initializeExplorePage();
    } else {
        console.error('Unable to find namespace and pod name data elements');
    }
}); 