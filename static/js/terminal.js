// terminal.js

// Initialize the terminal using xterm.js and Socket.IO
function initializeTerminal() {
    const terminalContainer = document.getElementById('terminal');
    if (!terminalContainer) {
        // console.log('Terminal container not found, skipping initialization.');
        return; // Only initialize if the element exists on the current page/tab
    }
    
    // Avoid re-initializing if already done for this container
    if (terminalContainer.dataset.initialized === 'true') {
        console.log('Terminal already initialized for this container.');
        return;
    }

    try {
        console.log('Initializing main CLI terminal...');
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

        // window.app.terminal = terminal; // Store differently if multiple terminals exist
        terminal.open(terminalContainer);
        fitAddon.fit();
        terminalContainer.dataset.initialized = 'true'; // Mark as initialized

        terminal.writeln('-- HPE Private Cloud AI - Control Plane CLI --');
        terminal.writeln('Initializing connection...');

        // Ensure socket is available and set up listeners
        if (!window.app.socket) {
            // Attempt to initialize socket if not done globally (should be in app_init.js)
            try {
                window.app.socket = io();
                console.log('Socket connection created for terminal.');
                 window.app.socket.on('connect', () => {
                    console.log('Terminal socket reconnected.');
                    terminal.writeln('\r\nReconnected to server. Initializing terminal...');
                    // Request backend to start PTY session for CLI pod
                    window.app.socket.emit('start_cli_terminal'); 
                });
                 window.app.socket.on('connect_error', (error) => {
                    console.error('Terminal socket connection error:', error);
                    terminal.writeln(`\r\nConnection error: ${error}`);
                });

            } catch (e) {
                console.error("Failed to initialize Socket.io for terminal:", e);
                terminal.writeln('\r\nError: Could not connect to server for terminal commands.');
                // Display error in terminal container if socket.io is missing
                terminalContainer.innerHTML = '<div class="alert alert-danger">Terminal requires Socket.io. Connection failed.</div>';
                return; // Stop further terminal setup
            }
        }
        
        // Check if socket is already connected
        if (window.app.socket.connected) {
             console.log('Socket already connected. Initializing CLI terminal session.');
             window.app.socket.emit('start_cli_terminal'); // Request backend to start PTY session
        } else {
             console.log('Socket not connected yet, waiting for connect event...');
             // The 'connect' handler above will emit 'start_cli_terminal'
        }

        // Listen for output from backend PTY session
        // Ensure we only listen once, even if initializeTerminal is called multiple times
        const socket = window.app.socket;
        const ptyOutputListener = (data) => {
            // Since this is the *only* terminal this file manages, we assume
            // all pty_output is for this terminal.
            // If multiple terminals were managed here, we'd need context (e.g., session ID).
            if (data.output) terminal.write(data.output);
            if (data.error) terminal.writeln(`\r\n\x1b[31mError: ${data.error}\x1b[0m`);
        };
        const ptyExitListener = (data) => {
            // Handle terminal exit signal from backend
            terminal.writeln(`\r\n\x1b[33mTerminal session ended.\x1b[0m`);
            // Optionally disable input or show reconnect message
        };

        // Remove previous listeners if they exist to prevent duplicates
        socket.off('pty_output', window.app._cliPtyOutputListener);
        socket.off('pty_exit', window.app._cliPtyExitListener);
        
        // Add new listeners and store references
        socket.on('pty_output', ptyOutputListener);
        socket.on('pty_exit', ptyExitListener);
        window.app._cliPtyOutputListener = ptyOutputListener; // Store listener reference
        window.app._cliPtyExitListener = ptyExitListener;
        
        // Send input data using onData
        terminal.onData(data => {
            socket.emit('pty_input', { input: data });
        });

        // Handle resize
        window.addEventListener('resize', () => {
            fitAddon.fit();
            // Optionally inform backend of new size
            // socket.emit('pty_resize', { rows: terminal.rows, cols: terminal.cols });
        });

        // Remove the old onKey handler for building command line
        /* 
        terminal.onKey(({ key, domEvent }) => {
           // ... removed logic for building currentLine and sending 'terminal_command' ...
        });
        */

    } catch (error) {
        console.error('Error initializing terminal:', error);
        terminalContainer.innerHTML = '<div class="alert alert-danger">Failed to initialize terminal.</div>';
    }
}

// Remove handleTerminalCtrlKeys as it's handled by backend PTY now
/*
function handleTerminalCtrlKeys(keyCode, terminalInstance) {
    // ... removed ...
}
*/

// Re-initialize terminal if needed when the CLI tab becomes visible
// Assumes initializeTerminal checks if already initialized
const cliTabObserver = new MutationObserver((mutationsList) => {
    for(let mutation of mutationsList) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const cliTabPane = document.getElementById('cli');
            if (cliTabPane && cliTabPane.classList.contains('active')) {
                console.log('CLI tab became active, ensuring terminal is initialized.');
                setTimeout(initializeTerminal, 50); // Slight delay to ensure DOM is ready
                // Ensure terminal fits container when tab is shown
                if (window.app.terminal && window.app.terminal.fitAddon) {
                    setTimeout(() => window.app.terminal.fitAddon.fit(), 100);
                }
            }
        }
    }
});

const mainContent = document.getElementById('mainContent');
if (mainContent) {
    cliTabObserver.observe(mainContent, { attributes: true, subtree: true, attributeFilter: ['class'] });
} else {
    console.warn('Could not find mainContent to observe tab changes for terminal init.');
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