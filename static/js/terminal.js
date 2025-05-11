// terminal.js

// Define logger for this module
const logger = {
    info: (...args) => console.info('[CtrlCLI]', ...args),
    debug: (...args) => console.debug('[CtrlCLI]', ...args),
    warn: (...args) => console.warn('[CtrlCLI]', ...args),
    error: (...args) => console.error('[CtrlCLI]', ...args),
};

// Initialize the terminal using xterm.js and Socket.IO
function initializeTerminal() {
    const terminalContainer = document.getElementById('terminal');
    if (!terminalContainer) {
        logger.info('Terminal container not found, skipping initialization.');
        return;
    }

    let terminateAndDelayStart = false;

    if (window.app.controlPlaneTerminal) {
        logger.info('Disposing existing Control Plane CLI terminal instance.');
        try {
            window.app.controlPlaneTerminal.dispose();
        } catch (e) {
            logger.warn('Error disposing existing terminal:', e);
        }
        window.app.controlPlaneTerminal = null;
        
        if (window.app.socket && window.app.socket.connected) {
            logger.info('[CtrlCLI] Emitting control_plane_cli_terminate_request from initializeTerminal due to existing instance.');
            window.app.socket.emit('control_plane_cli_terminate_request');
            terminateAndDelayStart = true; // Signal that we need to delay before starting new session
        }
    }
    terminalContainer.innerHTML = '';

    try {
        logger.info('Initializing new terminal instance...');
        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'monospace',
            fontSize: 14,
            convertEol: true,
            scrollback: 1000,
            theme: { background: '#000000', foreground: '#ffffff' },
            allowProposedApi: true // Retain this for now, might be useful for other options
        });

        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        window.app.controlPlaneTerminal = term;
        terminalContainer.innerHTML = ''; // Clear any previous content
        term.open(terminalContainer);
        fitAddon.fit();

        term.writeln('-- HPE Private Cloud AI - Control Plane CLI --');
        term.writeln('Attempting to connect to application pod shell...');
        term.writeln('');

        const setupTerminalSessionWithPotentialDelay = () => {
            if (terminateAndDelayStart) {
                logger.info('[CtrlCLI] Delaying PTY session start for 500ms to allow backend termination to process.');
                setTimeout(setupTerminalSession, 500);
            } else {
                setupTerminalSession();
            }
        };

        const setupTerminalSession = () => {
            logger.info('Socket connected. Setting up terminal session.');
            term.writeln('Socket connected. Initializing PTY session...');
            
            logger.info('Emitting control_plane_cli_start');
            window.app.socket.emit('control_plane_cli_start', {});

            // Add the onData handler for pasted text and other direct terminal input
            term.onData(data => {
                logger.debug(`[CtrlCLI] Data received via onData: ${data.length} chars`);
                if (window.app.socket && window.app.socket.connected) {
                    window.app.socket.emit('control_plane_cli_input', { input: data });
                } else {
                    logger.warn('[CtrlCLI] onData: Socket not connected, cannot send input.');
                    term.writeln('\r\n\x1b[31mError: Not connected. Cannot send input.\x1b[0m');
                }
            });

            // Clear previous listeners to avoid duplication if re-initialized
            window.app.socket.off('control_plane_cli_output');
            window.app.socket.on('control_plane_cli_output', function(data) {
                if (data.output) {
                    logger.debug(`Output data: ${data.output}`);
                    term.write(data.output);
                }
                if (data.error) {
                    logger.error(`Error from backend: ${data.error}`);
                    term.writeln(`\r\n\x1b[31mError: ${data.error}\x1b[0m`);
                }
            });

            window.app.socket.off('control_plane_cli_exit');
            window.app.socket.on('control_plane_cli_exit', function(data) {
                logger.info('Session ended.');
                term.writeln(`\r\n\x1b[33mControl Plane CLI session ended: ${data.message || ''}\x1b[0m`);
            });

            // Initial resize after session start is confirmed by first output or a small delay
            // For now, resize is handled by onResize and initial explicit call later.
        };

        if (window.app.socket && window.app.socket.connected) {
            setupTerminalSessionWithPotentialDelay();
        } else {
            term.writeln('Socket not immediately connected. Waiting for connection...');
            if (!window.app.socket) {
                logger.warn('Socket object not found, attempting to create and connect.');
                // Assuming io() is available globally from Socket.IO client library
                window.app.socket = io({transports: ['websocket', 'polling']}); 
            }
            
            window.app.socket.once('connect', () => {
                logger.info('Socket connected event received.');
                setupTerminalSessionWithPotentialDelay();
            });
            window.app.socket.once('connect_error', (err) => {
                logger.error('Socket connection error:', err);
                term.writeln(`\r\n\x1b[31mError: Failed to establish socket connection: ${err.message}\x1b[0m`);
            });
            if (!window.app.socket.connected) {
                 window.app.socket.connect(); // Ensure connection attempt is made if not already connecting
            }
        }
        
        let currentLine = '';
        let commandHistory = [];
        let historyIndex = -1;

        term.onKey(({ key, domEvent }) => {
            const printable = !domEvent.altKey && !domEvent.altGraphKey && !domEvent.metaKey;

            if (!window.app.socket || !window.app.socket.connected) {
                logger.warn('Key press, but socket not connected.');
                term.writeln('\r\n\x1b[31mError: Not connected. Cannot send input.\x1b[0m');
                return;
            }

            // Handle Paste (Ctrl+V or Cmd+V)
            if ((domEvent.ctrlKey || domEvent.metaKey) && domEvent.key === 'v') {
                // Let xterm.js handle paste via its onData event by not interfering here.
                // No explicit term.paste() is needed if onData is correctly configured to send to backend.
                // We will rely on onData to catch the pasted input.
                // Ensure currentLine is not polluted by the 'v' character itself from this event.
                return; 
            }

            if (domEvent.ctrlKey || domEvent.metaKey) { // Modified to include metaKey for Cmd
                const charCode = domEvent.keyCode;
                let PTYSignal = null;

                // SIGINT (Ctrl+C or Cmd+C on Mac)
                if (charCode === 67 && (domEvent.ctrlKey || domEvent.metaKey)) { 
                    PTYSignal = '\x03'; 
                    term.write('^C');
                } 
                // SIGQUIT (Ctrl+\) - Optional, less common
                // else if (charCode === 220 && domEvent.ctrlKey) { PTYSignal = '\x1c'; term.write('^\\'); }
                // EOF (Ctrl+D)
                else if (charCode === 68 && domEvent.ctrlKey) { // Typically only Ctrl+D for EOF
                    PTYSignal = '\x04';
                    // No visual ^D usually, shell handles it
                } 
                // SUSP (Ctrl+Z)
                else if (charCode === 90 && domEvent.ctrlKey) { 
                    PTYSignal = '\x1A'; 
                    term.write('^Z');
                }

                // Clear Screen (Ctrl+L or Cmd+L - client side only for now)
                if (charCode === 76 && (domEvent.ctrlKey || domEvent.metaKey)) { 
                    term.clear(); 
                    currentLine = ''; // Clear current line buffer as well
                    // Re-draw prompt if necessary, or wait for backend to send it.
                    // For simplicity, let's assume prompt will re-appear or user types a command.
                    return; 
                }

                if(PTYSignal){
                    logger.debug(`Sending control input signal: ${PTYSignal}`);
                    window.app.socket.emit('control_plane_cli_input', { input: PTYSignal });
                    currentLine = ''; // Clear line after sending a signal
                    return; // Important: return after handling a control sequence
                }
                // If it was a Cmd key that wasn't a recognized shortcut, don't process as printable
                if (domEvent.metaKey && !PTYSignal) return;
            }

            if (domEvent.keyCode === 13) { // Enter
                if (currentLine.trim()) {
                    // Do NOT send currentLine to backend here; onData will handle all input
                    commandHistory.push(currentLine);
                    historyIndex = commandHistory.length;
                    currentLine = '';
                    // Optionally, write a newline locally, or rely on PTY echo
                    // term.write('\r\n');
                } else {
                    // Do NOT send anything to backend here; onData will handle Enter
                    // term.write('\r\n');
                }
            } else if (domEvent.keyCode === 8) { // Backspace
                if (term.buffer.active.cursorX > 0) { 
                    term.write('\b \b');
                    if (currentLine.length > 0) {
                        currentLine = currentLine.slice(0, -1);
                    }
                }
            } else if (domEvent.keyCode === 38) { // Up arrow
                if (commandHistory.length > 0) {
                    historyIndex = Math.max(0, historyIndex - 1);
                    term.write('\x1b[2K\r'); 
                    const promptChar = '# ';
                    term.write(promptChar + commandHistory[historyIndex]);
                    currentLine = commandHistory[historyIndex];
                    for(let i=0; i < (promptChar.length + currentLine.length); ++i) term.write('\x1b[C');
                }
            } else if (domEvent.keyCode === 40) { // Down arrow
                if (historyIndex < commandHistory.length) {
                    historyIndex++;
                    term.write('\x1b[2K\r'); 
                    const promptChar = '# ';
                    if (historyIndex < commandHistory.length) {
                        term.write(promptChar + commandHistory[historyIndex]);
                        currentLine = commandHistory[historyIndex];
                        for(let i=0; i < (promptChar.length + currentLine.length); ++i) term.write('\x1b[C');
                    } else {
                        term.write(promptChar);
                        currentLine = '';
                        for(let i=0; i < promptChar.length; ++i) term.write('\x1b[C');
                    }
                }
            } else if (printable && key && key.length === 1 && !domEvent.ctrlKey && !domEvent.metaKey) { // Added !ctrlKey and !metaKey here
                currentLine += key;
                // term.write(key); // REMOVE THIS LINE - Rely on PTY echo via onData
            }
        });

        const sendResize = () => {
            if (term.rows && term.cols && window.app.socket && window.app.socket.connected) {
                 logger.debug(`Sending pty_resize: rows=${term.rows}, cols=${term.cols}`);
                 window.app.socket.emit('pty_resize', { rows: term.rows, cols: term.cols });
            }
        };
        
        setTimeout(sendResize, 200);
        term.onResize(sendResize);
        // Consider window resize listener if fitAddon doesn't cover all cases.
        // window.addEventListener('resize', () => { try { fitAddon.fit(); } catch(e){ logger.warn('Error on fitAddon resize', e); } });

        logger.info('Terminal initialized and event listeners (will be) set up upon connection.');

    } catch (error) {
        logger.error('Failed to initialize terminal:', error);
        if(terminalContainer) terminalContainer.innerHTML = `<div class="alert alert-danger">Failed to initialize Control Plane CLI: ${error.message}</div>`;
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

// Ensure app_init.js or similar calls initializeTerminal() when the Control Plane tab is active.
// For example, in app_init.js, when navigating to the CLI tab:
// if (tabId === 'cli' && typeof initializeTerminal === 'function') {
//    initializeTerminal();
// } else if (tabId !== 'cli' && window.app.controlPlaneTerminal) {
     // Optional: dispose terminal when navigating away to save resources
     // logger.info('Disposing Control Plane CLI terminal.');
     // window.app.controlPlaneTerminal.dispose();
     // window.app.controlPlaneTerminal = null;
     // if (window.app.socket) {
     //     window.app.socket.emit('control_plane_cli_terminate'); // if backend supports this
     // }
// } 