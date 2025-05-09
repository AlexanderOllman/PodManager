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

    try {
        logger.info('Initializing...');
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

        const setupTerminalSession = () => {
            logger.info('Socket connected. Setting up terminal session.');
            term.writeln('Socket connected. Initializing PTY session...');
            
            logger.info('Emitting control_plane_cli_start');
            window.app.socket.emit('control_plane_cli_start', {});

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
            setupTerminalSession();
        } else {
            term.writeln('Socket not immediately connected. Waiting for connection...');
            if (!window.app.socket) {
                logger.warn('Socket object not found, attempting to create and connect.');
                // Assuming io() is available globally from Socket.IO client library
                window.app.socket = io({transports: ['websocket', 'polling']}); 
            }
            
            window.app.socket.once('connect', () => {
                logger.info('Socket connected event received.');
                setupTerminalSession();
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

            if (domEvent.ctrlKey) {
                const charCode = domEvent.keyCode;
                let PTYSignal = null;
                if(charCode === 67){ PTYSignal = '\x03'; term.write('^C');} // Ctrl+C (ETX)
                if(charCode === 68){ PTYSignal = '\x04';} // Ctrl+D (EOT)
                if(charCode === 90){ PTYSignal = '\x1A'; terminal.write('^Z');} // Ctrl+Z (SUB)
                if(charCode === 76){ term.clear(); return;} // Ctrl+L (Clear screen client side)

                if(PTYSignal){
                    logger.debug(`Sending control input: ${PTYSignal === '\x03' ? 'Ctrl+C' : PTYSignal === '\x04' ? 'Ctrl+D' : 'Ctrl+Z'}`);
                    window.app.socket.emit('control_plane_cli_input', { input: PTYSignal });
                }
                currentLine = ''; 
                return;
            }

            if (domEvent.keyCode === 13) { // Enter
                if (currentLine.trim()) {
                    logger.debug(`Sending command input: ${currentLine}`);
                    window.app.socket.emit('control_plane_cli_input', { input: currentLine + '\r' }); 
                    commandHistory.push(currentLine);
                    historyIndex = commandHistory.length;
                    currentLine = '';
                } else {
                    window.app.socket.emit('control_plane_cli_input', { input: '\r' }); 
                    terminal.write('\r\n'); 
                }
            } else if (domEvent.keyCode === 8) { // Backspace
                if (term.buffer.active.cursorX > 0) { 
                    terminal.write('\b \b');
                    if (currentLine.length > 0) {
                        currentLine = currentLine.slice(0, -1);
                    }
                }
            } else if (domEvent.keyCode === 38) { // Up arrow
                if (commandHistory.length > 0) {
                    historyIndex = Math.max(0, historyIndex - 1);
                    terminal.write('\x1b[2K\r'); 
                    // The prompt should come from the PTY, so just write the command.
                    const promptChar = '# '; // Or detect dynamically if possible
                    terminal.write(promptChar + commandHistory[historyIndex]);
                    currentLine = commandHistory[historyIndex];
                     // Move cursor to end of line
                    for(let i=0; i < (promptChar.length + currentLine.length); ++i) terminal.write('\x1b[C');
                }
            } else if (domEvent.keyCode === 40) { // Down arrow
                if (historyIndex < commandHistory.length) {
                    historyIndex++;
                    terminal.write('\x1b[2K\r'); 
                    const promptChar = '# '; // Or detect dynamically
                    if (historyIndex < commandHistory.length) {
                        terminal.write(promptChar + commandHistory[historyIndex]);
                        currentLine = commandHistory[historyIndex];
                        for(let i=0; i < (promptChar.length + currentLine.length); ++i) terminal.write('\x1b[C');
                    } else {
                        terminal.write(promptChar);
                        currentLine = '';
                        for(let i=0; i < promptChar.length; ++i) terminal.write('\x1b[C');
                    }
                }
            } else if (printable && key && key.length === 1) { 
                currentLine += key;
                terminal.write(key);
            }
        });

        const sendResize = () => {
            if (terminal.rows && terminal.cols && window.app.socket && window.app.socket.connected) {
                 logger.debug(`Sending pty_resize: rows=${terminal.rows}, cols=${terminal.cols}`);
                 window.app.socket.emit('pty_resize', { rows: terminal.rows, cols: terminal.cols });
            }
        };
        
        setTimeout(sendResize, 200); // Send initial resize after a slight delay
        terminal.onResize(sendResize);
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