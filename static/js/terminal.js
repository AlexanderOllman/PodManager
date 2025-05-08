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

        window.app.terminal = terminal; // Store in global state
        terminal.open(terminalContainer);
        fitAddon.fit();

        // Setup command input handling
        let currentLine = '';
        let commandHistory = [];
        let historyIndex = -1;

        terminal.writeln('-- HPE Private Cloud AI - Control Plane CLI --');
        terminal.writeln('Type commands and press Enter to execute.');
        terminal.writeln('');
        terminal.write('$ ');

        // Ensure socket is available and set up listeners
        if (!window.app.socket) {
            try {
                window.app.socket = io(); // Initialize if not done by app_init.js
                console.log('Socket connection created for terminal.');

                window.app.socket.on('connect', () => {
                    console.log('Terminal socket reconnected.');
                    terminal.writeln('\r\nReconnected to server.');
                    terminal.write('$ ');
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
        
        // This listener should be in app_init.js or a shared socket handling module
        // to avoid duplication if other parts of app use 'terminal_output' event.
        // For now, ensuring it's here if terminal.js is standalone for this part.
        // window.app.socket.on('terminal_output', function(data) { ... }); 
        // Already handled by connectSocketListeners in app_init.js

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
                    window.app.socket.emit('terminal_command', { command: currentLine });
                    terminal.write('\r\n'); // Move to next line, prompt will be added by server response or here
                    currentLine = '';
                } else {
                    terminal.write('\r\n$ '); // New prompt for empty command
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