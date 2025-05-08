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
    const url = window.app.getRelativeUrl(`/api/pod/${namespace}/${podName}/describe`);
    fetch(url)
        .then(response => response.json())
        .then(data => {
            const outputElement = document.getElementById('describeOutput');
            outputElement.textContent = data.error || data.describe_output;
            hideLoadingState('describe');
        })
        .catch(error => {
            console.error('Error fetching pod description:', error);
            document.getElementById('describeOutput').textContent = `Failed to load description: ${error}`;
            hideLoadingState('describe');
        });
}

function loadPodLogs() {
    showLoadingState('logs');
    const url = window.app.getRelativeUrl(`/api/pod/${namespace}/${podName}/logs`);
    fetch(url)
        .then(response => response.json())
        .then(data => {
            const outputElement = document.getElementById('logsOutput');
            outputElement.textContent = data.error || data.logs;
            hideLoadingState('logs');
        })
        .catch(error => {
            console.error('Error fetching pod logs:', error);
            document.getElementById('logsOutput').textContent = `Failed to load logs: ${error}`;
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
    terminalElement.innerHTML = ''; // Clear previous terminal instance if any

    if (window.app.podTerminal) { // If a previous pod terminal instance exists
        window.app.podTerminal.dispose();
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

        term.writeln(`Connecting to pod ${podName} in namespace ${namespace}...`);

        // Ensure socket is connected (it should be from app_init.js)
        if (!window.app.socket || !window.app.socket.connected) {
            term.writeln('\x1b[31mError: Socket not connected. Cannot establish terminal session.\x1b[0m');
            console.error('Socket not connected for pod terminal.');
            // Optionally, try to reconnect or instruct user
            // if (window.app.socket && typeof window.app.socket.connect === 'function') {
            //     window.app.socket.connect();
            // }
            return;
        }
        
        // Emit event to backend to start PTY session for this specific pod
        window.app.socket.emit('pod_terminal_start', { namespace: namespace, pod_name: podName });

        term.onData(data => {
            window.app.socket.emit('pod_terminal_input', { namespace: namespace, pod_name: podName, input: data });
        });

        window.app.socket.off('pod_terminal_output'); // Remove previous listeners for this event
        window.app.socket.on('pod_terminal_output', (data) => {
            if (data.namespace === namespace && data.pod_name === podName) {
                if (data.output) term.write(data.output);
                if (data.error) term.writeln(`\n\x1b[31mError: ${data.error}\x1b[0m`);
            }
        });
        
        window.app.socket.off('pod_terminal_exit');
        window.app.socket.on('pod_terminal_exit', (data) => {
             if (data.namespace === namespace && data.pod_name === podName) {
                term.writeln(`\n\x1b[33mTerminal session for ${podName} ended.\x1b[0m`);
                // Optionally disable terminal or show a reconnect button
             }
        });

        window.addEventListener('resize', () => fitAddon.fit());

    } catch (error) {
        console.error('Failed to initialize pod terminal:', error);
        terminalElement.innerHTML = `<div class="alert alert-danger">Failed to initialize terminal: ${error.message}</div>`;
    }
}

// Initialize the page when DOM is ready
document.addEventListener('DOMContentLoaded', initializeExplorePage); 