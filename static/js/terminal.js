// terminal.js

// Initialize the terminal using xterm.js and Socket.IO
function initializeTerminal() {
    const terminalContainer = document.getElementById('terminal');
    if (!terminalContainer) {
        // console.log('Terminal container not found, skipping initialization.');
        return;
    }

    try {
        console.log('Initializing terminal...');
        const terminal = new Terminal({
            cursorBlink: true,
            fontFamily: 'monospace',
            fontSize: 14,
            convertEol: true,
            scrollback: 1000,
            theme: { background: '#000000', foreground: '#ffffff' }
        });
        const fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);

        window.app.terminal = terminal; // General CLI terminal instance
        terminal.open(terminalContainer);
        fitAddon.fit();

        terminal.writeln('-- HPE Private Cloud AI - Control Plane CLI --');
        terminal.writeln('Type commands and press Enter to execute.');
        terminal.writeln('');
        terminal.write('$ ');

        if (!window.app.socket) {
            try {
                window.app.socket = io();
                console.log('Socket connection created for general CLI terminal.');
                window.app.socket.on('connect', () => {
                    console.log('General CLI terminal socket reconnected.');
                    terminal.writeln('\r\nReconnected to server.');
                    // Do not write $ prompt here if it might be connected to a pod
                });
                window.app.socket.on('connect_error', (error) => {
                    console.error('Terminal socket connection error:', error);
                    terminal.writeln(`\r\nConnection error: ${error}`);
                    terminal.write('$ ');
                });
            } catch (e) {
                console.error("Failed to initialize Socket.io for terminal:", e);
                terminal.writeln('\r\nError: Could not connect to server for terminal commands.');
                terminal.write('$ ');
                // Display error in terminal container if socket.io is missing
                terminalContainer.innerHTML = '<div class="alert alert-danger">Terminal requires Socket.io. Connection failed.</div>';
                return; // Stop further terminal setup
            }
        }
        
        // Listener for general command output (e.g., messages from server before connecting to pod)
        window.app.socket.off('terminal_output').on('terminal_output', function(data) {
            if (window.app.terminal && data.data) {
                window.app.terminal.write(data.data.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
            }
            if (window.app.terminal && data.complete && !window.app.cliConnectedToPod) {
                // Only show $ prompt if not connected to a pod (pod provides its own prompt)
                window.app.terminal.write('\r\n$ ');
            }
        });

        // Add listeners for pod-specific terminal events, as CLI might connect to a pod
        window.app.socket.off('pod_terminal_output').on('pod_terminal_output', (data) => {
            if (window.app.terminal) { // Check if this is the active terminal context
                if (data.output) {
                    window.app.terminal.write(data.output);
                    window.app.cliConnectedToPod = true; // Mark as connected
                }
                if (data.error) {
                    window.app.terminal.writeln(`\r\n\x1b[31mError: ${data.error}\x1b[0m`);
                }
            }
        });

        window.app.socket.off('pod_terminal_exit').on('pod_terminal_exit', (data) => {
            if (window.app.terminal) {
                window.app.terminal.writeln(`\r\n\x1b[33mSession to pod ${data.pod_name || ''} ended.\x1b[0m`);
                window.app.cliConnectedToPod = false; // Mark as disconnected
                window.app.terminal.write('\r\n$ '); // Show general prompt again
            }
        });

        // Setup command input handling
        let currentLine = '';
        let commandHistory = [];
        let historyIndex = -1;

        terminal.onKey(({ key, domEvent }) => {
            const printable = !domEvent.altKey && !domEvent.altGraphKey && !domEvent.metaKey; // Ctrl key handled separately

            if (domEvent.ctrlKey) {
                handleTerminalCtrlKeys(domEvent.keyCode, terminal);
                currentLine = ''; // Reset current line on Ctrl+C, etc.
                return;
            }

            if (domEvent.keyCode === 13) { // Enter
                if (currentLine.trim()) {
                    commandHistory.push(currentLine);
                    historyIndex = commandHistory.length;
                    // If cliConnectedToPod, the backend expects 'pod_terminal_input'
                    // Otherwise, it's a general 'terminal_command'
                    const eventToEmit = window.app.cliConnectedToPod ? 'pod_terminal_input' : 'terminal_command';
                    const dataToEmit = window.app.cliConnectedToPod 
                        ? { 
                            input: currentLine + '\r', 
                            // We need namespace/pod_name if emitting pod_terminal_input.
                            // This requires state from the backend about which pod CLI is connected to.
                            // This is a temporary simplification: backend will route based on SID if active_pty_sessions[sid] exists.
                          }
                        : { command: currentLine };
                    
                    // For now, the backend handle_terminal_command will check active_pty_sessions 
                    // and if one exists for this SID, it will forward to pod_terminal_input itself.
                    // So frontend always sends 'terminal_command' initially or 'pod_terminal_input' if it *knows* it's connected.
                    // Let's simplify: backend will handle the routing. Frontend sends general 'terminal_command'.
                    // The backend's 'terminal_command' was updated to check 'active_pty_sessions'.

                    window.app.socket.emit('terminal_command', { command: currentLine });
                    terminal.write('\r\n'); 
                    currentLine = '';
                } else {
                    if (!window.app.cliConnectedToPod) terminal.write('\r\n$ ');
                    else terminal.write('\r\n'); // Just newline if in pod
                }
            } else if (domEvent.keyCode === 8) { // Backspace
                if (currentLine.length > 0) {
                    currentLine = currentLine.slice(0, -1);
                    terminal.write('\b \b');
                }
            } else if (domEvent.keyCode === 38) { // Up arrow
                if (historyIndex > 0) {
                    historyIndex--;
                    terminal.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                    currentLine = commandHistory[historyIndex];
                    terminal.write(currentLine);
                }
            } else if (domEvent.keyCode === 40) { // Down arrow
                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    terminal.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                    currentLine = commandHistory[historyIndex];
                    terminal.write(currentLine);
                } else if (historyIndex === commandHistory.length - 1) {
                    historyIndex++;
                    terminal.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                    currentLine = '';
                }
            } else if (domEvent.keyCode === 9) { // Tab
                domEvent.preventDefault(); // Prevent focus change, placeholder for auto-complete
            } else if (printable && key) { // Regular printable characters
                currentLine += key;
                terminal.write(key);
            }
        });

        window.addEventListener('resize', () => fitAddon.fit());
        console.log('Terminal initialized successfully with WebSocket mode.');

    } catch (error) {
        console.error('Failed to initialize terminal:', error);
        terminalContainer.innerHTML = `<div class="alert alert-danger">Failed to initialize terminal: ${error.message}</div>`;
    }
}

// Handles Ctrl key combinations in the terminal
function handleTerminalCtrlKeys(keyCode, terminalInstance) {
    if (!window.app.socket) return;

    let controlChar = null;
    let signal = null;
    let displayChar = '';

    switch (keyCode) {
        case 67: // Ctrl+C
            signal = 'SIGINT';
            controlChar = '\x03'; // ETX
            displayChar = '^C';
            break;
        case 68: // Ctrl+D
            signal = 'EOF';
            controlChar = '\x04'; // EOT
            // No display char for EOF, server handles it
            break;
        case 90: // Ctrl+Z
            signal = 'SIGTSTP';
            controlChar = '\x1A'; // SUB
            displayChar = '^Z';
            break;
        case 76: // Ctrl+L
            terminalInstance.clear();
            terminalInstance.write('$ '); // Re-issue prompt
            return; // Handled client-side
        default:
            return; // Not a recognized control key combination
    }

    if (signal && controlChar) {
        window.app.socket.emit('terminal_command', { control: signal, key: controlChar });
        if (displayChar) terminalInstance.write(displayChar);
        if (signal !== 'EOF') terminalInstance.write('\r\n$ '); // New prompt, except for EOF
    }
}

// Deprecated: Kept for potential backward compatibility or reference
// Modern implementation uses WebSocket directly via terminal input handling.
function executeCliCommand(command) {
    if (!command || !window.app.socket) {
        console.warn('Cannot execute CLI command: no command or socket unavailable.');
        return;
    }
    console.log(`Executing (via deprecated function) CLI command: ${command}`);
    window.app.socket.emit('terminal_command', { command: command });
    // Output is handled by the global 'terminal_output' socket listener
} 