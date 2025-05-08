// static/js/pod_explore_page.js

// Assumes global 'namespace' and 'podName' variables are defined in the HTML template.

function initializeExplorePage() {
    console.log(`Initializing explore page for pod: ${podName} in namespace: ${namespace}`);
    
    // Set up tab handlers
    const detailsTab = document.getElementById('details-tab');
    const describeTab = document.getElementById('describe-tab');
    const logsTab = document.getElementById('logs-tab');
    const accessTab = document.getElementById('access-tab');

    if (detailsTab) detailsTab.addEventListener('click', loadPodDetails);
    if (describeTab) describeTab.addEventListener('click', loadPodDescription);
    if (logsTab) logsTab.addEventListener('click', loadPodLogs);
    if (accessTab) accessTab.addEventListener('click', setupPodTerminal); // Renamed to avoid conflict with general terminal.js
    
    // Set up button handlers
    const refreshLogsBtn = document.getElementById('refreshLogs');
    const downloadLogsBtn = document.getElementById('downloadLogs');
    const backButton = document.getElementById('backButton');

    if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', loadPodLogs);
    if (downloadLogsBtn) downloadLogsBtn.addEventListener('click', downloadPodLogs);
    if (backButton) {
        backButton.addEventListener('click', function(e) {
            e.preventDefault();
            // Indicate that we are returning to the dashboard, potentially to a specific previous state
            sessionStorage.setItem('returning_from_pod_view', 'true');
            window.history.back(); // Or navigate to '/'
        });
    }
    
    // Load initial tab (details)
    loadPodDetails();

    // Activate tab based on URL hash
    const hash = window.location.hash.substring(1);
    if (hash) {
        const tabButton = document.querySelector(`#podTabs .nav-link[data-bs-target="#${hash}"]`);
        if (tabButton) {
            new bootstrap.Tab(tabButton).show();
            // Trigger load for the activated tab if needed (e.g. logs, describe)
            switch(hash) {
                case 'describe': loadPodDescription(); break;
                case 'logs': loadPodLogs(); break;
                case 'access': setupPodTerminal(); break;
                case 'details': loadPodDetails(); break; // Already called, but good for consistency
            }
        }
    }
}

function showLoadingState(tabName) {
    console.log(`Showing loading for ${tabName}`);
    const validTabs = ['details', 'describe', 'logs'];
    if (!validTabs.includes(tabName)) {
        console.error(`Invalid tabName passed to showLoadingState: ${tabName}`);
        return;
    }

    try {
        const loadingDiv = document.getElementById(`${tabName}Loading`);
        // For 'access' tab, content is managed by setupPodTerminal directly using 'terminal' ID.
        const contentDivId = tabName === 'details' ? `${tabName}Content` : (tabName === 'access' ? 'terminal' : `${tabName}Output`);
        const contentDiv = document.getElementById(contentDivId);

        if (loadingDiv) loadingDiv.style.display = 'flex';
        else console.warn(`showLoadingState: loadingDiv not found for ${tabName}Loading`);

        if (contentDiv) contentDiv.style.display = 'none';
        else console.warn(`showLoadingState: contentDiv not found for ${contentDivId}`);

    } catch (e) {
        console.error(`SyntaxError or other error in showLoadingState for ${tabName}:`, e);
    }
}

function hideLoadingState(tabName) {
    console.log(`Hiding loading for ${tabName}`);
    const validTabs = ['details', 'describe', 'logs'];
     if (!validTabs.includes(tabName)) {
        console.error(`Invalid tabName passed to hideLoadingState: ${tabName}`);
        return;
    }
    
    try {
        const loadingDiv = document.getElementById(`${tabName}Loading`);
        const contentDivId = tabName === 'details' ? `${tabName}Content` : (tabName === 'access' ? 'terminal' : `${tabName}Output`);
        const contentDiv = document.getElementById(contentDivId);

        if (loadingDiv) loadingDiv.style.display = 'none';
        else console.warn(`hideLoadingState: loadingDiv not found for ${tabName}Loading`);
        
        if (contentDiv) contentDiv.style.display = 'block';
        else console.warn(`hideLoadingState: contentDiv not found for ${contentDivId}`);

    } catch (e) {
        console.error(`SyntaxError or other error in hideLoadingState for ${tabName}:`, e);
    }
}

function loadPodDetails() {
    showLoadingState('details');
    const url = window.app.getRelativeUrl(`/api/pod/${namespace}/${podName}/details`);
    fetch(url)
        .then(response => {
            if (!response.ok) {
                return response.json().then(errData => {
                    throw new Error(errData.error || `HTTP error! status: ${response.status} - ${response.statusText}`);
                }).catch(() => {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                });
            }
            return response.json();
        })
        .then(data => {
            const detailsContentElement = document.getElementById('detailsContent');
            if (!detailsContentElement) {
                console.error("Could not find 'detailsContent' element.");
                hideLoadingState('details');
                return;
            }

            if (data.error) {
                // Clear previous content ONLY when displaying an error that replaces the whole content
                while (detailsContentElement.firstChild) {
                    detailsContentElement.removeChild(detailsContentElement.firstChild);
                }
                const alertDiv = document.createElement('div');
                alertDiv.className = 'alert alert-danger';
                alertDiv.textContent = `Error: ${String(data.error)}`;
                detailsContentElement.appendChild(alertDiv);
            } else {
                // Successful data load: directly update the content of existing elements.
                // Do NOT clear detailsContentElement here, as its children are the targets.
                const podDetailNameEl = document.getElementById('podDetailName');
                if (podDetailNameEl) podDetailNameEl.textContent = data.name;
                else console.warn("Element with ID 'podDetailName' not found");

                const podDetailNamespaceEl = document.getElementById('podDetailNamespace');
                if (podDetailNamespaceEl) podDetailNamespaceEl.textContent = data.namespace;
                else console.warn("Element with ID 'podDetailNamespace' not found");
                
                const podDetailStatusEl = document.getElementById('podDetailStatus');
                if (podDetailStatusEl) podDetailStatusEl.innerHTML = (data.status_icon || '') + (data.status_phase || ''); // status_icon might be HTML
                else console.warn("Element with ID 'podDetailStatus' not found");

                const podDetailReadyEl = document.getElementById('podDetailReady');
                if (podDetailReadyEl) podDetailReadyEl.textContent = data.ready_containers;
                else console.warn("Element with ID 'podDetailReady' not found");

                const podDetailRestartsEl = document.getElementById('podDetailRestarts');
                if (podDetailRestartsEl) podDetailRestartsEl.textContent = data.restarts;
                else console.warn("Element with ID 'podDetailRestarts' not found");

                const podDetailAgeEl = document.getElementById('podDetailAge');
                if (podDetailAgeEl) podDetailAgeEl.textContent = data.age;
                else console.warn("Element with ID 'podDetailAge' not found");

                const podDetailIPEl = document.getElementById('podDetailIP');
                if (podDetailIPEl) podDetailIPEl.textContent = data.ip;
                else console.warn("Element with ID 'podDetailIP' not found");

                const podDetailNodeEl = document.getElementById('podDetailNode');
                if (podDetailNodeEl) podDetailNodeEl.textContent = data.node_name;
                else console.warn("Element with ID 'podDetailNode' not found");

                const podDetailCreatedEl = document.getElementById('podDetailCreated');
                if (podDetailCreatedEl) podDetailCreatedEl.textContent = new Date(data.creation_timestamp).toLocaleString();
                else console.warn("Element with ID 'podDetailCreated' not found");

                // Ensure populateTable is robust and checks for tbody existence.
                const populateTable = (tbodyId, items, type) => {
                    const tbody = document.getElementById(tbodyId);
                    if (!tbody) {
                        console.warn(`populateTable: tbody with id ${tbodyId} not found.`);
                        return;
                    }
                    tbody.innerHTML = ''; // Clear previous rows before populating
                    if (!items) { // Ensure items is not null/undefined before trying to iterate
                         console.warn(`populateTable: items for ${tbodyId} is null or undefined.`);
                         return;
                    }
                    if (type === 'resources') {
                        items.forEach(item => {
                            const row = tbody.insertRow();
                            row.insertCell().textContent = item.container || '-';
                            row.insertCell().textContent = item.requests || '-';
                            row.insertCell().textContent = item.limits || '-';
                        });
                    } else if (type === 'gpu') {
                         items.forEach(item => {
                            const row = tbody.insertRow();
                            row.insertCell().textContent = item.container || '-';
                            row.insertCell().textContent = item.type || 'N/A';
                            row.insertCell().textContent = item.count || '-';
                        });
                    } else { // Labels, Annotations
                        Object.entries(items).forEach(([key, value]) => {
                            const row = tbody.insertRow();
                            row.insertCell().textContent = key;
                            row.insertCell().textContent = String(value); // Ensure value is string
                        });
                    }
                };
                populateTable('podDetailCPU', data.resources?.cpu || [], 'resources');
                populateTable('podDetailMemory', data.resources?.memory || [], 'resources');
                populateTable('podDetailGPU', data.resources?.gpu || [], 'gpu');
                populateTable('podDetailLabels', data.labels || {}, 'labels');
                populateTable('podDetailAnnotations', data.annotations || {}, 'annotations');
                
                detailsContentElement.style.display = 'block'; // Ensure it's visible
            }
            hideLoadingState('details');
        })
        .catch(error => {
            console.error('Error fetching or processing pod details:', error);
            const detailsContentElement = document.getElementById('detailsContent');
            if (detailsContentElement) {
                while (detailsContentElement.firstChild) {
                    detailsContentElement.removeChild(detailsContentElement.firstChild);
                }
                const alertDiv = document.createElement('div');
                alertDiv.className = 'alert alert-danger';
                let msg = 'Failed to load pod details: ';
                if (error && error.message) {
                    msg += String(error.message);
                } else {
                    msg += String(error);
                }
                alertDiv.textContent = msg;
                detailsContentElement.appendChild(alertDiv);
            } else {
                console.error("Could not find 'detailsContent' element to display fetch error.");
            }
            hideLoadingState('details');
        });
}

function loadPodDescription() {
    showLoadingState('describe');
    const outputElement = document.getElementById('describeOutput');
    console.log('Describe Output Element:', outputElement); // Log the element
    if (!outputElement) {
        console.error("Element with ID 'describeOutput' not found.");
        hideLoadingState('describe');
        return;
    }
    outputElement.textContent = ''; 

    const url = window.app.getRelativeUrl(`/api/pod/${namespace}/${podName}/describe`);
    fetch(url)
        .then(response => {
            if (!response.ok) {
                // Simplify error thrown on non-ok response
                throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                /* Previous more complex error handling:
                return response.json().then(errData => {
                    throw new Error(errData.error || `HTTP error! status: ${response.status} - ${response.statusText}`);
                }).catch(() => {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                });
                */
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                outputElement.textContent = `Error: ${String(data.error)}`;
                outputElement.classList.add('text-danger');
            } else {
                outputElement.textContent = data.describe_output;
                outputElement.classList.remove('text-danger');
            }
            hideLoadingState('describe');
        })
        .catch(error => {
            console.error('Error fetching or processing pod description:');
            console.log('Caught Error Object (Describe):', error); // Log the raw error object
            let msg = 'Failed to load description: ';
            if (error && error.message) msg += String(error.message);
            else msg += String(error);
            try {
                 outputElement.textContent = msg;
                 outputElement.classList.add('text-danger');
            } catch (e) {
                 console.error("Error setting textContent for describe error:", e);
                 // Fallback: Display error in console if setting textContent fails
            }
            hideLoadingState('describe');
        });
}

function loadPodLogs() {
    showLoadingState('logs');
    const outputElement = document.getElementById('logsOutput');
    console.log('Logs Output Element:', outputElement); // Log the element
    if (!outputElement) {
        console.error("Element with ID 'logsOutput' not found.");
        hideLoadingState('logs');
        return;
    }
    outputElement.textContent = '';

    const url = window.app.getRelativeUrl(`/api/pod/${namespace}/${podName}/logs`);
    fetch(url)
        .then(response => {
            if (!response.ok) {
                 // Simplify error thrown on non-ok response
                throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                /* Previous more complex error handling:
                return response.json().then(errData => {
                    throw new Error(errData.error || `HTTP error! status: ${response.status} - ${response.statusText}`);
                }).catch(() => {
                    throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
                });
                */
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                outputElement.textContent = `Error: ${String(data.error)}`;
                outputElement.classList.add('text-danger');
            } else {
                outputElement.textContent = data.logs;
                outputElement.classList.remove('text-danger');
            }
            hideLoadingState('logs');
        })
        .catch(error => {
            console.error('Error fetching or processing pod logs:');
            console.log('Caught Error Object (Logs):', error); // Log the raw error object
            let msg = 'Failed to load logs: ';
            if (error && error.message) msg += String(error.message);
            else msg += String(error);
             try {
                 outputElement.textContent = msg;
                 outputElement.classList.add('text-danger');
            } catch (e) {
                 console.error("Error setting textContent for logs error:", e);
                 // Fallback: Display error in console if setting textContent fails
            }
            hideLoadingState('logs');
        });
}

function downloadPodLogs() {
    const url = window.app.getRelativeUrl(`/api/pod/${namespace}/${podName}/logs?download=true`);
    // Create a temporary link to trigger download
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${podName}_${namespace}_logs.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Renamed to avoid conflict with general terminal.js functionality
function setupPodTerminal() {
    const terminalElement = document.getElementById('terminal');
    if (!terminalElement) {
        console.error('Terminal element not found for pod access.');
        return;
    }
    // Avoid re-initializing if already done for this container
    if (terminalElement.dataset.initialized === 'true' && window.app.podTerminal) {
        console.log('Pod terminal already initialized.');
        // Maybe re-focus or ensure connection? For now, just return.
        return;
    }
    
    terminalElement.innerHTML = ''; // Clear previous terminal instance if any

    if (window.app.podTerminal) { 
        window.app.podTerminal.dispose();
        window.app.podTerminal = null; // Clear reference
    }

    console.log(`Setting up terminal for pod: ${namespace}/${podName}`);
    try {
        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'monospace',
            fontSize: 14,
            convertEol: true,
            theme: { background: '#000000', foreground: '#ffffff' }
        });
        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalElement);
        fitAddon.fit();
        window.app.podTerminal = term; // Store specific to pod explore page
        terminalElement.dataset.initialized = 'true'; // Mark as initialized

        term.writeln(`Connecting to pod ${podName} in namespace ${namespace}...`);

        if (!window.app.socket || !window.app.socket.connected) {
            term.writeln('\x1b[31mError: Socket not connected. Cannot establish terminal session.\x1b[0m');
            console.error('Socket not connected for pod terminal.');
            return;
        }
        
        // Emit event to backend to start PTY session for this specific pod
        window.app.socket.emit('start_pod_terminal', { namespace: namespace, pod_name: podName }); // Use new event name

        // Send input data using onData and new event name
        term.onData(data => {
            window.app.socket.emit('pty_input', { input: data }); // Use generic event name
        });

        // Setup listeners for generic PTY events, checking context
        const ptyOutputListener = (data) => {
            // IMPORTANT: Check if the output is for THIS pod terminal
            if (data.namespace === namespace && data.pod_name === podName) {
                if (data.output) term.write(data.output);
                if (data.error) term.writeln(`\r\n\x1b[31mError: ${data.error}\x1b[0m`);
            }
        };
        const ptyExitListener = (data) => {
             // IMPORTANT: Check if the exit is for THIS pod terminal
             if (data.namespace === namespace && data.pod_name === podName) {
                term.writeln(`\r\n\x1b[33mTerminal session for ${podName} ended.\x1b[0m`);
                terminalElement.dataset.initialized = 'false'; // Allow re-init
             }
        };

        // Remove previous listeners scoped to this specific pod terminal instance if they exist
        // This assumes we store listeners uniquely, e.g., on the term instance or a unique key
        // For simplicity, we might just rely on socket.off with the function reference
        const socket = window.app.socket;
        if (window.app._podPtyOutputListener) socket.off('pty_output', window.app._podPtyOutputListener);
        if (window.app._podPtyExitListener) socket.off('pty_exit', window.app._podPtyExitListener);

        // Add new listeners and store references uniquely (e.g., attach to term object or use map)
        socket.on('pty_output', ptyOutputListener);
        socket.on('pty_exit', ptyExitListener);
        window.app._podPtyOutputListener = ptyOutputListener; // Store reference to remove later
        window.app._podPtyExitListener = ptyExitListener;

        // Handle resize (optional, but good practice)
        const resizeListener = () => {
             fitAddon.fit();
             socket.emit('pty_resize', { rows: term.rows, cols: term.cols });
         };
        window.addEventListener('resize', resizeListener);
        
        // Store resize listener reference to remove it later if needed
        term._resizeListener = resizeListener; 

    } catch (error) {
        console.error('Failed to initialize pod terminal:', error);
        terminalElement.innerHTML = `<div class="alert alert-danger">Failed to initialize terminal: ${error.message}</div>`;
    }
}

// Initialize the page when DOM is ready
document.addEventListener('DOMContentLoaded', initializeExplorePage); 