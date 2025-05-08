// terminal.js

// Initialize the terminal using xterm.js and Socket.IO
function initializeTerminal() {
    const terminalContainer = document.getElementById('terminal');
    if (!terminalContainer) {
        // console.log('Terminal container not found, skipping initialization.');
        return;
    }
    
     // Check if an xterm instance is already associated and in the container
    let terminal = window.app.terminal;
    let fitAddon = window.app.terminalFitAddon;

    if (terminal && terminal.element && terminalContainer.contains(terminal.element)) {
        console.log('Terminal already initialized.');
        fitAddon.fit(); // Refit on re-initialization call
        // Connection is requested by app_init.js
        return;
    } 
    // Clear container if it has content but no recognized terminal instance
    if (terminalContainer.childElementCount > 0) {
        terminalContainer.innerHTML = ''; 
    }

    try {
        console.log('Initializing terminal display (xterm.js)...');
        terminal = new Terminal({
            cursorBlink: true,
            fontFamily: 'monospace',
            fontSize: 14,
            convertEol: true,
            scrollback: 1000,
            theme: { background: '#000000', foreground: '#ffffff' }
        });
        fitAddon = new FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);

        window.app.terminal = terminal; // Store general CLI terminal
        window.app.terminalFitAddon = fitAddon; // Store addon
        terminal.open(terminalContainer);
        fitAddon.fit();

        // --- REMOVED OLD onKey HANDLER --- 
        // Input is now handled by the PTY connection established by the backend
        // via the pod_terminal_input event, which is handled by the setupPodTerminal logic.
        // The generic terminal listeners in app_init handle displaying output.
       
        terminal.writeln('-- HPE Private Cloud AI - Control Plane CLI --');
        terminal.writeln('Attempting to connect to pod-manager pod...');
        terminal.writeln('');
        // Prompt will come from the pod's shell

        // Resize listener
        window.addEventListener('resize', () => fitAddon.fit());

    } catch (e) {
        console.error("Failed to initialize terminal:", e);
        terminalContainer.innerHTML = `<div class="alert alert-danger">Failed to initialize terminal display: ${e.message}</div>`;
    }
}

// Handles Ctrl key combinations in the terminal
// Keep this minimal for now. The pty should interpret raw ctrl chars correctly.
function handleTerminalCtrlKeys(keyCode, terminalInstance) {
    // Basic client-side handling like Ctrl+L (clear)
    if (keyCode === 76 && !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey) { // Ctrl+L
        terminalInstance.clear();
        return;
    }
    // Other Ctrl keys (like C, D, Z) will be sent as raw characters 
    // by the xterm instance's default behavior when connected to the PTY
    // via the 'pod_terminal_input' mechanism setup by handle_pod_terminal_start.
}

// Function to refresh terminal dimensions
// Renamed to avoid potential conflicts if other addons use fit()
function fitCliTerminal() { 
    if (window.app.terminalFitAddon) {
        try {
            window.app.terminalFitAddon.fit();
        } catch (e) {
            console.warn("Error fitting CLI terminal:", e);
        }
    }
}

// Ensure fit is called when resizing
window.removeEventListener('resize', fitCliTerminal); // Remove previous listener if any
window.addEventListener('resize', fitCliTerminal);

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