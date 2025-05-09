// terminal.js

// Define logger for this module, assuming a global logger might not be set up yet
const logger = {
    info: console.log.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
};

// Initialize the terminal using xterm.js and Socket.IO
function initializeTerminal() {
    const terminalContainer = document.getElementById('terminal');
    if (!terminalContainer) {
        logger.info('Control Plane CLI: Terminal container not found, skipping initialization.');
        return;
    }

    try {
        logger.info('Control Plane CLI: Initializing...');
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

        window.app.controlPlaneTerminal = terminal; // Use a distinct name
        terminal.open(terminalContainer);
        fitAddon.fit();

        terminal.writeln('-- HPE Private Cloud AI - Control Plane CLI --');
        terminal.writeln('Attempting to connect to application pod shell...');
        terminal.writeln('');

        if (!window.app.socket || !window.app.socket.connected) {
            try {
                if (!window.app.socket) window.app.socket = io(); 
                logger.info('Control Plane CLI: Socket not connected, attempting to connect...');
                window.app.socket.connect(); // Explicitly connect if not already
                // It might take a moment to connect, so subsequent emit might need a small delay or check
            } catch (e) {
                logger.error("Control Plane CLI: Failed to initialize Socket.io:", e);
                terminal.writeln('\r\nError: Could not connect to server for terminal commands.');
                return;
            }
        }

        // Wait a brief moment for socket to establish if it was just connected
        setTimeout(() => {
            if (window.app.socket && window.app.socket.connected) {
                logger.info('[CtrlCLI] Emitting control_plane_cli_start');
                window.app.socket.emit('control_plane_cli_start', {}); // No specific data needed to start
            } else {
                logger.error('[CtrlCLI] Socket still not connected after attempt. Cannot start terminal.');
                terminal.writeln('\r\nError: Failed to establish socket connection for terminal.');
            }
        }, 500); // 500ms delay
        
        let currentLine = '';
        let commandHistory = [];
        let historyIndex = -1;

        // Ensure listeners are specific and not duplicated
        window.app.socket.off('control_plane_cli_output');
        window.app.socket.on('control_plane_cli_output', function(data) {
            if (data.output) {
                logger.debug(`[CtrlCLI] Output data: ${data.output}`);
                terminal.write(data.output);
            }
            if (data.error) {
                logger.error(`[CtrlCLI] Error from backend: ${data.error}`);
                terminal.writeln(`\r\n\x1b[31mError: ${data.error}\x1b[0m`);
            }
            // The PTY session will provide its own prompt typically
            // if (data.complete && !data.error) {
            //     terminal.write('\r\n$ '); // Or whatever prompt is desired
            // }
        });

        window.app.socket.off('control_plane_cli_exit');
        window.app.socket.on('control_plane_cli_exit', function(data) {
            logger.info('[CtrlCLI] Session ended.');
            terminal.writeln('\r\n\x1b[33mControl Plane CLI session ended.\x1b[0m');
            // Optionally, disable input or show a reconnect button
        });

        terminal.onKey(({ key, domEvent }) => {
            const printable = !domEvent.altKey && !domEvent.altGraphKey && !domEvent.metaKey;

            if (domEvent.ctrlKey) {
                // Reuse existing Ctrl key handler if it can be made generic
                // For now, let's assume it sends generic input
                const charCode = domEvent.keyCode;
                let PTYSignal = null;
                if(charCode === 67){ PTYSignal = '\x03'; terminal.write('^C');} // Ctrl+C (ETX)
                if(charCode === 68){ PTYSignal = '\x04';} // Ctrl+D (EOT)
                if(charCode === 90){ PTYSignal = '\x1A'; terminal.write('^Z');} // Ctrl+Z (SUB)
                if(charCode === 76){ terminal.clear(); return;} // Ctrl+L (Clear screen client side)

                if(PTYSignal && window.app.socket && window.app.socket.connected){
                    logger.debug(`[CtrlCLI] Sending control input: ${PTYSignal === '\x03' ? 'Ctrl+C' : PTYSignal === '\x04' ? 'Ctrl+D' : 'Ctrl+Z'}`);
                    window.app.socket.emit('control_plane_cli_input', { input: PTYSignal });
                }
                currentLine = ''; 
                return;
            }

            if (domEvent.keyCode === 13) { // Enter
                if (currentLine.trim()) {
                    logger.debug(`[CtrlCLI] Sending command input: ${currentLine}`);
                    if (window.app.socket && window.app.socket.connected) {
                        window.app.socket.emit('control_plane_cli_input', { input: currentLine + '\r' }); // Send with CR
                    } else {
                        logger.warn('[CtrlCLI] Socket not connected, cannot send command.');
                        terminal.writeln('\r\n\x1b[31mError: Not connected to server.\x1b[0m');
                    }
                    commandHistory.push(currentLine);
                    historyIndex = commandHistory.length;
                    currentLine = '';
                } else {
                    if (window.app.socket && window.app.socket.connected) {
                         window.app.socket.emit('control_plane_cli_input', { input: '\r' }); // Send CR for empty line
                    }
                    terminal.write('\r\n'); // client-side newline, prompt should come from PTY
                }
            } else if (domEvent.keyCode === 8) { // Backspace
                if (terminal.buffer.active.cursorX > 0) { // Basic backspace, prompt might be > 0
                    terminal.write('\b \b');
                    if (currentLine.length > 0) {
                        currentLine = currentLine.slice(0, -1);
                    }
                }
            } else if (domEvent.keyCode === 38) { // Up arrow
                if (commandHistory.length > 0) {
                    historyIndex = Math.max(0, historyIndex - 1);
                    terminal.write('\x1b[2K\r'); // Clear current line
                     // terminal.write('$ '); // Re-issue prompt if needed
                    terminal.write(commandHistory[historyIndex]);
                    currentLine = commandHistory[historyIndex];
                }
            } else if (domEvent.keyCode === 40) { // Down arrow
                if (historyIndex < commandHistory.length) {
                    historyIndex++;
                    terminal.write('\x1b[2K\r'); // Clear current line
                    // terminal.write('$ '); // Re-issue prompt if needed
                    if (historyIndex < commandHistory.length) {
                        terminal.write(commandHistory[historyIndex]);
                        currentLine = commandHistory[historyIndex];
                    } else {
                        currentLine = '';
                    }
                }
            } else if (printable && key && key.length === 1) { // Regular printable character
                currentLine += key;
                terminal.write(key);
            }
        });

        // Generic PTY resize event
        const sendResize = () => {
            if (terminal.rows && terminal.cols) {
                 logger.debug(`[CtrlCLI] Sending pty_resize: rows=${terminal.rows}, cols=${terminal.cols}`);
                 if (window.app.socket && window.app.socket.connected) {
                     window.app.socket.emit('pty_resize', { rows: terminal.rows, cols: terminal.cols });
                 }
            }
        };
        // Send initial size & on resize
        setTimeout(sendResize, 100);
        terminal.onResize(sendResize);
        // window.addEventListener('resize', () => fitAddon.fit()); // fitAddon.fit() will trigger terminal.onResize

        logger.info('Control Plane CLI: Terminal initialized and event listeners set up.');
    } catch (error) {
        logger.error('Control Plane CLI: Failed to initialize terminal:', error);
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