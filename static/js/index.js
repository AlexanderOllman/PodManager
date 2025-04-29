// Main initialization function that runs when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM content loaded, initializing application...');
    
    // Since scripts are loaded in head, we can initialize right away
    initializeApp();
    
    // Add page visibility change detection for better navigation handling
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            console.log('Page is now visible, checking resource loading state...');
            // Check if any tab content is visible but not loaded
            try {
                const activeTabId = document.querySelector('.tab-pane.active')?.id;
                if (activeTabId && ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(activeTabId)) {
                    if (!window.loadedResources || !window.loadedResources[activeTabId]) {
                        console.log(`Active tab ${activeTabId} not loaded, fetching data...`);
                        fetchResourceData(activeTabId);
                    }
                }
            } catch (e) {
                console.error('Error checking visible tab state:', e);
            }
        }
    });
    
    // Handle browser navigation (back/forward) events
    window.onpopstate = function(event) {
        console.log('Navigation state change detected', event.state);
        
        // If we're back on the home page
        if (window.location.pathname === '/' || window.location.pathname === '') {
            // Check event state for active tab info
            if (event.state && event.state.tabId) {
                console.log(`History state has tab: ${event.state.tabId}`);
                
                // If returning to home dashboard with an active resource tab
                if (event.state.tabId === 'home' && event.state.activeResourceTab) {
                    console.log(`History navigation to home with active resource tab: ${event.state.activeResourceTab}`);
                    
                    // Set as active resource tab in app state
                    if (!window.app.state) window.app.state = {};
                    window.app.state.activeResourceTab = event.state.activeResourceTab;
                    
                    // Ensure home tab is active
                    const homeTab = document.getElementById('home');
                    if (homeTab) {
                        homeTab.classList.add('show', 'active');
                    }
                    
                    // Clear existing active classes from resource tabs
                    ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].forEach(tab => {
                        const tabElement = document.getElementById(tab);
                        const tabButton = document.getElementById(`${tab}-tab`);
                        if (tabElement) tabElement.classList.remove('show', 'active');
                        if (tabButton) tabButton.classList.remove('active');
                    });
                    
                    // Set the active resource tab
                    const resourceTab = document.getElementById(event.state.activeResourceTab);
                    const resourceTabButton = document.getElementById(`${event.state.activeResourceTab}-tab`);
                    
                    if (resourceTab) {
                        resourceTab.classList.add('show', 'active');
                    }
                    
                    if (resourceTabButton) {
                        resourceTabButton.classList.add('active');
                    }
                    
                    // Force reload for the active resource tab
                    if (window.app.loadedResources) {
                        window.app.loadedResources[event.state.activeResourceTab] = false;
                    }
                    
                    // Load the active resource tab data
                    fetchResourceData(event.state.activeResourceTab);
                    
                    return;
                }
                
                // Otherwise check for normal resource tab
                if (['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(event.state.tabId)) {
                    console.log(`History navigation to resource tab: ${event.state.tabId}`);
                    
                    // Force reload for this tab
                    if (window.app.loadedResources) {
                        window.app.loadedResources[event.state.tabId] = false;
                    }
                    
                    // Load the active tab data
                    fetchResourceData(event.state.tabId);
                }
            } else {
                // If no state, try to find the active tab in the DOM
                const activeTabId = document.querySelector('.tab-pane.active')?.id;
                
                // Check if the active tab is a resource tab that should load data
                if (activeTabId && ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(activeTabId)) {
                    console.log(`Navigation returned to home page, loading ${activeTabId} data`);
                    
                    // Force reload for the active tab
                    if (window.app.loadedResources) {
                        window.app.loadedResources[activeTabId] = false;
                    }
                    
                    // Load the active tab data
                    fetchResourceData(activeTabId);
                }
            }
        }
        
        // Apply state if it exists
        if (event.state && event.state.content) {
            document.getElementById('main-content').innerHTML = event.state.content;
            
            // Re-initialize components if needed
            if (event.state.page === 'home') {
                if (typeof initializeHomePage === 'function') {
                    initializeHomePage();
                }
            } else if (event.state.page === 'explore' && typeof initializeExplorePage === 'function') {
                initializeExplorePage();
            }
        }
    };
});

// Main application initialization
function initializeApp() {
    console.log('Initializing application...');
    
    // Initialize Bootstrap components
    initializeBootstrapComponents();
    
    // Initialize components that don't require special dependencies
    fetchClusterCapacity();
    checkGitAvailability();
    fetchNamespaces();
    setupDropZone();
    
    // Initialize terminal if available
    initializeTerminal();
    
    // Connect socket event listeners
    connectSocketListeners();
    
    // Set up additional tab click handlers
    setupTabClickHandlers();
    
    console.log('Application initialized');
}

// Initialize Bootstrap components
function initializeBootstrapComponents() {
    console.log('Initializing Bootstrap components...');
    
    // Initialize all dropdowns on the page
    var dropdownElementList = [].slice.call(document.querySelectorAll('[data-bs-toggle="dropdown"]'));
    dropdownElementList.map(function(dropdownToggleEl) {
        return new bootstrap.Dropdown(dropdownToggleEl);
    });
    
    // Re-initialize dropdowns when namespaces are loaded
    document.addEventListener('namespacesLoaded', function() {
        setTimeout(function() {
            var dropdownElementList = [].slice.call(document.querySelectorAll('[data-bs-toggle="dropdown"]'));
            dropdownElementList.map(function(dropdownToggleEl) {
                return new bootstrap.Dropdown(dropdownToggleEl);
            });
        }, 100);
    });
}

// Initialize or reinitialize the home page
function initializeHomePage() {
    console.log('Initializing home page...');
    
    // Check if returning from pod view
    const returningFromPodView = sessionStorage.getItem('returning_from_pod_view') === 'true';
    if (returningFromPodView) {
        console.log('Detected return from pod view - forcing reload of resources');
        sessionStorage.removeItem('returning_from_pod_view');
        
        // Force reset of any cached resources
        window.app.loadedResources = {};
        window.app.state.resources = {};
        window.app.state.lastFetch = {};
    }
    
    // Reset resources if we're coming from a different page
    if (window.app.state.navigation.isNavigating || returningFromPodView) {
        window.app.loadedResources = {};
        if (window.app.state.resources) {
            window.app.state.resources = {};
        }
        window.app.state.navigation.isNavigating = false;
        
        // Ensure cluster capacity is fetched after navigation
        if (typeof fetchClusterCapacity === 'function') {
            console.log('Fetching cluster capacity after navigation');
            fetchClusterCapacity();
        }
    }
    
    // Get active tab from navigation state
    const activeTab = window.app.state.navigation.activeTab || 'home';
    console.log(`Active tab from navigation state: ${activeTab}`);
    
    // Activate the tab
    activateTab(activeTab, false); // false means don't trigger a load yet
    
    // Delay resource loading to ensure DOM is ready
    setTimeout(() => {
        // Home tab is a special case - it contains resource tabs
        if (activeTab === 'home') {
            loadResourcesForTab('home'); // This will handle finding the active resource tab
    } else {
            loadResourcesForTab(activeTab);
    }
    }, 200);
}

// Terminal initialization - already loaded in head
function initializeTerminal() {
    if (document.getElementById('terminal')) {
        try {
            console.log('Initializing terminal...');
            
            // Create terminal with FitAddon for proper sizing
            const terminal = new Terminal({
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
            
            // Create FitAddon for proper sizing
            const fitAddon = new FitAddon.FitAddon();
            terminal.loadAddon(fitAddon);
            
            // Store terminal in global state
            window.app.terminal = terminal;
            
            // Open terminal
            terminal.open(document.getElementById('terminal'));
            fitAddon.fit();
            
            // Setup command input handling
            let currentLine = '';
            let commandHistory = [];
            let historyIndex = -1;
            
            // Initial prompt
            terminal.writeln('-- HPE Private Cloud AI - Control Plane CLI --');
            terminal.writeln('Type commands directly in this window and press Enter to execute.');
            terminal.writeln('');
            terminal.write('$ ');
            
            // Ensure the socket is available
            if (!window.app.socket) {
                // Create a socket connection if needed
                window.app.socket = io();
                
                console.log('Created new socket connection for terminal');
                
                // Set up reconnection logic
                window.app.socket.on('connect', function() {
                    console.log('Socket connected');
                    terminal.writeln('\r\nReconnected to server.');
                    terminal.write('$ ');
                });
                
                window.app.socket.on('connect_error', function(error) {
                    console.error('Socket connection error:', error);
                    terminal.writeln('\r\nConnection error: ' + error);
                    terminal.write('$ ');
                });
            }
            
            // Listen for command output
            window.app.socket.on('terminal_output', function(data) {
                // Only write to terminal if there's actual data to display
                if (data.data) {
                    // Display the output
                    terminal.write(data.data);
                }
                
                // If command is complete, show a new prompt
                if (data.complete) {
                    console.log('Command execution completed');
                    terminal.write('\r\n$ ');
                }
            });
            
            // Handle user input
            terminal.onKey(({ key, domEvent }) => {
                // Handle control key combinations
                if (domEvent.ctrlKey) {
                    const keyCode = domEvent.keyCode;
                    
                    // Map common control keys to their ASCII control characters
                    if (keyCode === 67) { // Ctrl+C
                        // Send SIGINT (ASCII control character ETX, \x03)
                        window.app.socket.emit('terminal_command', { 
                            control: 'SIGINT',
                            key: '\x03'
                        });
                        terminal.write('^C\r\n$ ');
                        currentLine = '';
                        return;
                    } else if (keyCode === 68) { // Ctrl+D
                        // Send EOF (ASCII control character EOT, \x04)
                        window.app.socket.emit('terminal_command', { 
                            control: 'EOF',
                            key: '\x04'
                        });
                        return;
                    } else if (keyCode === 90) { // Ctrl+Z
                        // Send SIGTSTP (ASCII control character SUB, \x1A)
                        window.app.socket.emit('terminal_command', { 
                            control: 'SIGTSTP',
                            key: '\x1A'
                        });
                        terminal.write('^Z\r\n');
                        return;
                    } else if (keyCode === 76) { // Ctrl+L
                        // Clear screen
                        terminal.clear();
                        terminal.write('$ ' + currentLine);
                        return;
                    }
                }
                
                const printable = !domEvent.altKey && !domEvent.altGraphKey && !domEvent.ctrlKey && !domEvent.metaKey;
                
                // Handle special keys
                if (domEvent.keyCode === 13) { // Enter key
                    // Send command to server
                    if (currentLine.trim()) {
                        // Add to history
                        commandHistory.push(currentLine);
                        historyIndex = commandHistory.length;
                        
                        // Execute command via WebSocket
                        window.app.socket.emit('terminal_command', { command: currentLine });
                        
                        // Visual feedback
                        terminal.write('\r\n');
                        currentLine = '';
                    } else {
                        // Empty command, just show new prompt
                        terminal.write('\r\n$ ');
                    }
                } else if (domEvent.keyCode === 8) { // Backspace
                    if (currentLine.length > 0) {
                        currentLine = currentLine.slice(0, -1);
                        terminal.write('\b \b'); // Erase character
                    }
                } else if (domEvent.keyCode === 38) { // Up arrow - history
                    if (historyIndex > 0) {
                        historyIndex--;
                        // Clear current line
                        terminal.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                        // Display command from history
                        currentLine = commandHistory[historyIndex];
                        terminal.write(currentLine);
                    }
                } else if (domEvent.keyCode === 40) { // Down arrow - history
                    if (historyIndex < commandHistory.length - 1) {
                        historyIndex++;
                        // Clear current line
                        terminal.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                        // Display next command from history
                        currentLine = commandHistory[historyIndex];
                        terminal.write(currentLine);
                    } else if (historyIndex === commandHistory.length - 1) {
                        historyIndex = commandHistory.length;
                        // Clear current line
                        terminal.write('\r$ ' + ' '.repeat(currentLine.length) + '\r$ ');
                        currentLine = '';
                    }
                } else if (domEvent.keyCode === 9) { // Tab - auto-complete (placeholder)
                    // Prevent tab from moving focus
                    domEvent.preventDefault();
                    // Future: Could implement auto-completion here
                } else if (printable) {
                    // Regular printable character
                    currentLine += key;
                    terminal.write(key);
                }
            });
            
            // Handle window resize
            window.addEventListener('resize', () => {
                fitAddon.fit();
            });
            
            console.log('Terminal initialized successfully with WebSocket mode');
        } catch (error) {
            console.error('Failed to initialize terminal:', error);
            const terminalElement = document.getElementById('terminal');
            terminalElement.innerHTML = '<div class="alert alert-danger">Failed to initialize terminal: ' + error.message + '</div>';
        }
    }
}

// This function is now deprecated as we use WebSockets directly
// Keeping it for backward compatibility
function executeCliCommand(command) {
    if (!command) return;
    
    // Check if socket is available
    if (window.app.socket) {
        // Use WebSocket mode
        window.app.socket.emit('terminal_command', { command: command });
    } else {
        // Fallback to REST API
    fetch('/api/cli/exec', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            command: command
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.output) {
            window.app.terminal.writeln(data.output);
        } else {
            window.app.terminal.writeln('Command executed with no output.');
        }
        window.app.terminal.write('\r\n$ ');
    })
    .catch(error => {
        console.error('Error:', error);
        window.app.terminal.writeln('Error executing command.');
        window.app.terminal.write('\r\n$ ');
    });
    }
}

// Socket event listeners
function connectSocketListeners() {
    const socket = window.app.socket;
    if (!socket) {
        console.warn('Socket not available for event listeners');
        return;
    }
    
    // Terminal output listener
    socket.on('terminal_output', function(data) {
        if (window.app.terminal && data.data) {
            // Handle terminal output
            window.app.terminal.write(data.data);
            
            // If command is complete, show a new prompt
            if (data.complete) {
                window.app.terminal.write('\r\n$ ');
            }
        }
    });
    
    // Refresh log listener for the settings page
    const refreshLog = document.getElementById('refreshLog');
    if (refreshLog) {
        socket.on('refresh_log', function(data) {
            const logMessage = data.message;
            
            // Create new log entry with appropriate class based on status
            const logEntry = document.createElement('div');
            const timestamp = new Date().toLocaleTimeString();
            
            // Set class based on status
            if (data.status === 'error') {
                logEntry.className = 'text-danger';
            } else if (data.status === 'warning') {
                logEntry.className = 'text-warning';
            } else if (data.status === 'success') {
                logEntry.className = 'text-success';
            } else {
                logEntry.className = 'text-info';
            }
            
            logEntry.innerHTML = `[${timestamp}] ${logMessage}`;
            refreshLog.appendChild(logEntry);
            
            // Auto-scroll to the bottom
            refreshLog.scrollTop = refreshLog.scrollHeight;
            
            // If this is a completion message, trigger the restart
            if (logMessage.includes('Preparing to restart application')) {
                // Wait a moment to ensure the user sees the restart message
                setTimeout(() => {
                    fetch('/restart', {
                        method: 'POST'
                    })
                    .then(response => response.json())
                    .then(data => {
                        const statusDiv = document.getElementById('updateStatus');
                        if (data.status === 'success') {
                            const logEntry = document.createElement('div');
                            logEntry.className = 'text-success';
                            logEntry.innerHTML = `[${new Date().toLocaleTimeString()}] Application restarted successfully. Page will refresh shortly...`;
                            refreshLog.appendChild(logEntry);
                            
                            statusDiv.innerHTML = 'Application restarted successfully. Refreshing page...';
                            setTimeout(() => {
                                window.location.reload();
                            }, 3000);
                        }
                    });
                }, 1000);
            }
        });
    }
}

// Fetch data for all resource tabs
function fetchResourcesForAllTabs() {
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    // First load capacity information
    fetchClusterCapacity().then(() => {
        // Get the active tab
        const activeTabId = document.querySelector('.tab-pane.active')?.id;
        
        // Only load data for the active tab immediately
        if (activeTabId && resourceTypes.includes(activeTabId)) {
            console.log(`Loading active tab: ${activeTabId}`);
            fetchResourceData(activeTabId, 'all', false);
        } 
        // Or if we're on the home tab, load the default (pods)
        else if (activeTabId === 'home' || !activeTabId) {
            console.log('On home tab, loading pods data');
            fetchResourceData('pods', 'all', false);
        }
        
        // Set up lazy loading for other tabs
        resourceTypes.forEach(resourceType => {
            if (resourceType !== activeTabId) {
                const tabElement = document.querySelector(`#${resourceType}-tab`);
                if (tabElement) {
                    tabElement.addEventListener('click', () => {
                        if (!window.app.loadedResources || !window.app.loadedResources[resourceType]) {
                            console.log(`Lazy loading ${resourceType} data...`);
                            fetchResourceData(resourceType, 'all', false);
                        }
                    });
                }
            }
        });
    });
}

// Add refresh button and search bar to each resource tab
function addResourceControls(resourceType) {
    // Store a global flag to prevent multiple calls creating duplicates
    window.resourceControlsCreated = window.resourceControlsCreated || {};
    
    // Skip if already created for this resource type
    if (window.resourceControlsCreated[resourceType]) {
        console.log(`Controls already exist for ${resourceType}, skipping creation`);
        return;
    }
    
    const tabPane = document.getElementById(resourceType);
    if (!tabPane) return;
    
    // Find existing controls to avoid duplicates
    const existingControls = tabPane.querySelector('.resource-controls-container');
    if (existingControls) {
        console.log(`Controls already exist in DOM for ${resourceType}, skipping creation`);
        window.resourceControlsCreated[resourceType] = true;
        return;
    }
    
    // Find where to insert controls (before the table)
    let tableContainer = tabPane.querySelector('.table-responsive');
    if (!tableContainer) return;
    
    // Create controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'mb-3 d-flex justify-content-between align-items-center resource-controls-container';
    
    // Create search input
    const searchContainer = document.createElement('div');
    searchContainer.className = 'input-group w-25';
    searchContainer.innerHTML = `
        <input type="text" class="form-control" placeholder="Filter ${resourceType}..." id="${resourceType}Search">
        <button class="btn btn-outline-secondary" type="button" onclick="clearSearch('${resourceType}')">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Create namespace selector
    const namespaceContainer = document.createElement('div');
    namespaceContainer.className = 'namespace-selector w-25 mx-2';
    namespaceContainer.innerHTML = `
        <select class="form-select" id="${resourceType}Namespace" onchange="namespaceChanged('${resourceType}')">
            <option value="all" selected>All Namespaces</option>
            <option value="loading" disabled>Loading namespaces...</option>
        </select>
    `;
    
    // Create refresh button
    const refreshButton = document.createElement('button');
    refreshButton.className = 'btn btn-primary';
    refreshButton.innerHTML = `<i class="fas fa-sync-alt"></i> Refresh ${capitalizeFirstLetter(resourceType)}`;
    refreshButton.onclick = function() { 
        // Force refresh by clearing the cached data
        if (window.loadedResources) {
            delete window.loadedResources[resourceType];
        }
        fetchResourceData(resourceType); 
    };
    
    // Add components to the container
    controlsContainer.appendChild(searchContainer);
    controlsContainer.appendChild(namespaceContainer);
    controlsContainer.appendChild(refreshButton);
    
    // Insert controls before the table
    tableContainer.parentNode.insertBefore(controlsContainer, tableContainer);
    
    // Mark as created
    window.resourceControlsCreated[resourceType] = true;
    
    // Add event listener for search input
    const searchInput = document.getElementById(`${resourceType}Search`);
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            filterResources(resourceType, this.value);
        });
    }
    
    // Load namespaces for the selector
    loadNamespacesForSelector(resourceType);
}

// Capitalize first letter helper (for button labels)
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Clear search field and reset table
function clearSearch(resourceType) {
    const searchInput = document.getElementById(`${resourceType}Search`);
    if (searchInput) {
        searchInput.value = '';
        filterResources(resourceType, '');
    }
}

// Filter resources based on search term
function filterResources(resourceType) {
    // Find the search input - check different possible IDs
    let searchInput = document.getElementById(`${resourceType}SearchInput`);
    
    // If not found with the first ID pattern, try alternative (the search box in the screenshot)
    if (!searchInput) {
        searchInput = document.querySelector(`input[placeholder^="Filter ${resourceType}"]`);
    }
    
    // If still not found, try a more generic selector
    if (!searchInput) {
        searchInput = document.querySelector(`#${resourceType} input[type="search"], #${resourceType} input[type="text"]`);
    }
    
    // Default to empty string if we can't find the search input
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    
    // Get the full dataset - safely access the cache
    const fullDataset = window.app.cache.resources?.[resourceType]?.data?.items || 
                       window.app.state.resources?.[resourceType]?.items || [];
    
    // Filter based on search term
    const filteredItems = searchTerm 
        ? fullDataset.filter(item => {
            // Search in name and namespace
            return item.metadata.name.toLowerCase().includes(searchTerm) || 
                   item.metadata.namespace.toLowerCase().includes(searchTerm);
        })
        : fullDataset;
    
    // Update state with filtered items and reset to first page
    window.app.state.resources[resourceType] = {
        items: filteredItems,
        currentPage: 1,
        pageSize: 10
    };
    
    // Render the first page
    renderCurrentPage(resourceType);
    
    // Add no results message if needed
    if (filteredItems.length === 0 && searchTerm) {
        const tableBody = document.querySelector(`#${resourceType}Table tbody`);
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4">
                        <i class="fas fa-search me-2 text-muted"></i>
                        No resources found matching "<span class="fw-bold">${searchTerm}</span>".
                        <button class="btn btn-sm btn-outline-secondary ms-3" onclick="clearSearch('${resourceType}')">
                            <i class="fas fa-times me-1"></i> Clear Search
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}

// Helper function to render current page
function renderCurrentPage(resourceType) {
    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData || !resourceData.items) {
        console.error(`No data available for ${resourceType}`);
        return;
    }
    
    const { items, totalCount, pageSize, loadedPages } = resourceData;
    
    let tableBody;
    let tableContainer;
    
    // Determine if we're in the resource explorer or a specific tab
    if (window.app.state.navigation?.activeTab === 'resources') {
        tableBody = document.getElementById('resourcesTableBody');
        tableContainer = document.getElementById('resourcesTableContainer');
    } else {
        tableBody = document.querySelector(`#${resourceType}Table tbody`);
        tableContainer = document.getElementById(`${resourceType}TableContainer`);
    }
    
    if (!tableBody) {
        console.error(`Table body not found for ${resourceType}`);
        return;
    }

    if (!tableContainer) {
        console.error(`Table container not found for ${resourceType}`);
        return;
    }
    
    // Remove existing "Load More" button if it exists
    const existingLoadMore = tableContainer.querySelector('.load-more-container');
    if (existingLoadMore) {
        existingLoadMore.remove();
    }
    
    // Remove existing count info messages
    const existingCountInfo = tableContainer.querySelector('.count-info');
    if (existingCountInfo) {
        existingCountInfo.remove();
    }
    
    // Clear the table body
    tableBody.innerHTML = '';

    // If no items, show empty state
    if (items.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-4">
                    <i class="fas fa-info-circle me-2"></i> No ${resourceType} found
                </td>
            </tr>
        `;
        return;
    }
    
    // Add count message
    const countInfo = document.createElement('div');
    countInfo.className = 'text-muted small mb-2 count-info';
    countInfo.innerHTML = `Showing ${items.length} of ${totalCount} ${resourceType}`;
    tableContainer.insertBefore(countInfo, tableContainer.firstChild);
    
    // Render items based on resource type
    items.forEach(item => {
        const row = document.createElement('tr');
        
        switch (resourceType) {
            case 'pods':
                const podResources = getResourceUsage(item);
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${getStatusIcon(item.status.phase)}${item.status.phase}</td>
                    <td class="resource-cell cpu-cell"><i class="fas fa-microchip me-1"></i>${podResources.cpu || '0'}</td>
                    <td class="resource-cell gpu-cell"><i class="fas fa-tachometer-alt me-1"></i>${podResources.gpu || '0'}</td>
                    <td class="resource-cell memory-cell"><i class="fas fa-memory me-1"></i>${podResources.memory || '0Mi'}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
                
            case 'services':
                // Get service type and ports
                const serviceType = item.spec?.type || 'ClusterIP';
                const clusterIP = item.spec?.clusterIP || '-';
                const externalIP = item.status?.loadBalancer?.ingress?.[0]?.ip || '-';
                
                // Format ports as a string
                let ports = '';
                if (item.spec?.ports && item.spec.ports.length > 0) {
                    ports = item.spec.ports.map(port => {
                        return `${port.port}${port.targetPort ? ':'+port.targetPort : ''}/${port.protocol || 'TCP'}`;
                    }).join(', ');
                } else {
                    ports = '-';
                }
                
                // Calculate age
                const creationTime = new Date(item.metadata.creationTimestamp);
                const now = new Date();
                const ageInDays = Math.floor((now - creationTime) / (1000 * 60 * 60 * 24));
                const age = ageInDays > 0 ? `${ageInDays}d` : `${Math.floor((now - creationTime) / (1000 * 60 * 60))}h`;
                
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${serviceType}</td>
                    <td>${clusterIP}</td>
                    <td>${externalIP}</td>
                    <td>${ports}</td>
                    <td>${age}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
                
            case 'inferenceservices':
                // Handle InferenceService rendering
                const isvcStatus = item.status?.conditions?.[0]?.status === 'True' ? 'Ready' : 'Not Ready';
                const isvcStatusIcon = isvcStatus === 'Ready' ? 
                    '<i class="fas fa-check-circle text-success me-1"></i>' : 
                    '<i class="fas fa-times-circle text-danger me-1"></i>';
                
                // Try to extract URL
                let url = '-';
                if (item.status?.url) {
                    url = `<a href="${item.status.url}" target="_blank">${item.status.url}</a>`;
                }
                
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${url}</td>
                    <td>${isvcStatusIcon}${isvcStatus}</td>
                    <td>${getResourceUsage(item).cpu || '-'}</td>
                    <td>${getResourceUsage(item).gpu || '-'}</td>
                    <td>${getResourceUsage(item).memory || '-'}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
                
            case 'deployments':
                // Handle Deployment rendering
                const readyReplicas = item.status?.readyReplicas || 0;
                const totalReplicas = item.status?.replicas || 0;
                const deploymentStatus = readyReplicas === totalReplicas ? 'Available' : 'Progressing';
                const deploymentStatusIcon = deploymentStatus === 'Available' ? 
                    '<i class="fas fa-check-circle text-success me-1"></i>' : 
                    '<i class="fas fa-sync text-warning me-1"></i>';
                
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${readyReplicas}/${totalReplicas}</td>
                    <td>${deploymentStatusIcon}${deploymentStatus}</td>
                    <td>${getResourceUsage(item).cpu || '-'}</td>
                    <td>${getResourceUsage(item).memory || '-'}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
                
            case 'configmaps':
                // Handle ConfigMap rendering
                const dataCount = Object.keys(item.data || {}).length;
                
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${dataCount} items</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
                
            case 'secrets':
                // Handle Secret rendering
                const secretType = item.type || 'Opaque';
                const secretDataCount = Object.keys(item.data || {}).length;
                
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${secretType}</td>
                    <td>${secretDataCount} items</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
                
            default:
                // Generic handling for other resource types
                row.innerHTML = `
                    <td>${item.metadata.namespace || '-'}</td>
                    <td>${item.metadata.name}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
        }
        
        tableBody.appendChild(row);
    });
    
    // Check if we need to show the "Load More" button
    if (items.length < totalCount) {
        const loadMoreContainer = document.createElement('div');
        loadMoreContainer.className = 'load-more-container text-center mt-3 mb-2';
        loadMoreContainer.innerHTML = `
            <button class="btn btn-outline-primary load-more-btn">
                <i class="fas fa-chevron-down me-1"></i> 
                Load More (showing ${items.length} of ${totalCount})
            </button>
        `;
        tableContainer.appendChild(loadMoreContainer);
        
        // Add event listener to load more button
        const loadMoreBtn = loadMoreContainer.querySelector('.load-more-btn');
        loadMoreBtn.addEventListener('click', () => {
            const nextPage = Math.ceil(items.length / pageSize) + 1;
            // Show loading spinner on load more button
            loadMoreBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Loading...';
            loadMoreBtn.disabled = true;
            
            // Fetch next page
            fetchResourceData(
                resourceType, 
                document.getElementById('resourceNamespaceSelector')?.value || 'all', 
                false, 
                nextPage
            ).finally(() => {
                // Re-enable button if more data can be loaded
                const updatedResourceData = window.app.state.resources[resourceType];
                if (updatedResourceData && updatedResourceData.items.length < updatedResourceData.totalCount) {
                    loadMoreBtn.disabled = false;
                    loadMoreBtn.innerHTML = `<i class="fas fa-chevron-down me-1"></i> Load More (showing ${updatedResourceData.items.length} of ${updatedResourceData.totalCount})`;
                }
            });
        });
    }
    
    // Make table visible with transition
    setTimeout(() => {
        if (tableContainer) {
            tableContainer.style.opacity = '1';
        }
    }, 100);
    
    // Initialize all dropdowns
    setTimeout(() => {
        const dropdownElementList = [].slice.call(document.querySelectorAll('.action-dropdown .dropdown-toggle'));
        dropdownElementList.map(function(dropdownToggleEl) {
            return new bootstrap.Dropdown(dropdownToggleEl);
        });
    }, 100);
}

// --- Modified fetchResourceData --- 
// Removed page parameter, fetches all data
function fetchResourceData(resourceType, namespace = 'all', criticalOnly = false, resetData = false) {
    console.log(`Fetching all ${resourceType} data for namespace: ${namespace}`);
    const cacheKey = `${resourceType}-${namespace}-full`; // Use a key indicating full data

    // Basic caching (can be enhanced)
    const now = Date.now();
    if (!resetData && window.app.cache.resources[cacheKey] && (now - window.app.cache.lastFetch[cacheKey]) < window.app.CACHE_TIMEOUT) {
        console.log(`Using cached data for ${cacheKey}`);
        // Call the new combined processing/rendering function
        processAndRenderAllResources(resourceType, window.app.cache.resources[cacheKey]); 
        return Promise.resolve(); // Return a resolved promise
    }

    showLoading(resourceType);
    
    const formData = new FormData();
    formData.append('resource_type', resourceType);
        formData.append('namespace', namespace);
    if (criticalOnly) {
        formData.append('critical_only', 'true');
    }
    // NOTE: Removed page and page_size from formData

    // Remove any existing request for this resource type to prevent race conditions
    if (window.app.state.activeRequests.has(resourceType)) {
        window.app.state.activeRequests.get(resourceType).abort();
        console.log(`Aborted previous request for ${resourceType}`);
    }

    const controller = new AbortController();
    window.app.state.activeRequests.set(resourceType, controller);
        
        return fetch('/get_resources', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        })
        .then(response => {
        window.app.state.activeRequests.delete(resourceType); // Remove from active requests
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
            return response.json();
        })
        .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Directly process the full list (response structure changed)
        const fullResourceList = data.data; // Backend now returns list directly in 'data'
        window.app.cache.resources[cacheKey] = fullResourceList; // Store full list in cache
        window.app.cache.lastFetch[cacheKey] = Date.now();
        // Call the new combined processing/rendering function
        processAndRenderAllResources(resourceType, fullResourceList); 
        })
        .catch(error => {
            if (error.name === 'AbortError') {
            console.log(`Fetch aborted for ${resourceType}`);
        } else {
            console.error(`Error fetching ${resourceType}:`, error);
                hideLoading(resourceType);
            // Display error to user in the table area
            const tableBody = document.getElementById(`${resourceType}TableBody`);
            if (tableBody) {
                // Adjust colspan if needed based on actual headers
                const colSpan = document.getElementById(`${resourceType}Table`)?.querySelector('thead tr')?.cells.length || 7;
                tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-danger">Failed to load ${resourceType}: ${error.message}</td></tr>`;
            }
        }
        window.app.state.activeRequests.delete(resourceType); // Ensure cleanup on error too
    });
}

// --- Renamed and Modified: processAndRenderAllResources --- 
// Processes and renders the entire list of resources
function processAndRenderAllResources(resourceType, resources) {
    console.log(`Processing and rendering ${resources.length} ${resourceType}`);
    
    // Directly call the modified render function
    renderResourcePage(resourceType, resources);
    
    hideLoading(resourceType);
    
    // Update dashboard metrics if it's pods data
    if (resourceType === 'pods') {
        // Ensure the full list is passed if updateDashboardMetrics expects it
        updateDashboardMetrics(resources); 
    }
}

// --- Modified: renderResourcePage --- 
// Renders the full list of resources, removes pagination logic
function renderResourcePage(resourceType, resources) {
    const tableBody = document.getElementById(`${resourceType}TableBody`);
    // Ensure we are selecting the correct table body for the Resource Explorer
    const resourceExplorerTableBody = document.getElementById('resourcesTableBody'); 

    const targetTableBody = resourceType === window.app.currentResourceType ? resourceExplorerTableBody : tableBody;

    if (!targetTableBody) {
        console.error(`Target table body not found for rendering ${resourceType}`);
        return;
    }

    targetTableBody.innerHTML = ''; // Clear existing rows

    if (!resources || resources.length === 0) {
        // Ensure we get the correct table headers for colspan
        const tableHeaders = document.getElementById('resourcesTableHeader');
        const colSpan = tableHeaders?.cells.length || 7; // Default to 7 if headers not found
        targetTableBody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center p-4"><i class="fas fa-info-circle me-2"></i>No ${resourceType} found.</td></tr>`;
    } else {
        // Setup headers based on resource type (might already be done elsewhere)
        setupTableHeaders(resourceType); // This needs to target #resourcesTableHeader
        
        resources.forEach(item => {
            const row = targetTableBody.insertRow();
            // Add data based on resource type, targeting the correct fields from kubectl output
            const metadata = item.metadata || {};
            const spec = item.spec || {};
            const status = item.status || {};

            switch (resourceType) {
                case 'pods':
                    row.insertCell().textContent = metadata.namespace || 'N/A';
                    row.insertCell().innerHTML = `<a href="#" onclick="viewPodDetails('${metadata.namespace}', '${metadata.name}'); return false;">${metadata.name || 'N/A'}</a>`;
                    row.insertCell().innerHTML = getStatusIcon(status.phase);
                    const usage = getResourceUsage(item); // Ensure getResourceUsage handles the new structure
                    row.insertCell().textContent = usage.cpu;
                    row.insertCell().textContent = usage.gpu;
                    row.insertCell().textContent = usage.memory;
                    row.insertCell().innerHTML = createActionButton(resourceType, metadata.namespace, metadata.name);
                    break;
                case 'services':
                    row.insertCell().textContent = metadata.namespace || 'N/A';
                    row.insertCell().textContent = metadata.name || 'N/A';
                    row.insertCell().textContent = spec.type || 'N/A';
                    row.insertCell().textContent = spec.clusterIP || 'N/A';
                    row.insertCell().textContent = spec.externalIPs?.join(', ') || '-';
                    row.insertCell().textContent = spec.ports?.map(p => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol || 'TCP'}`).join(', ') || '-';
                    row.insertCell().textContent = item.age || 'N/A'; // Use pre-calculated age
                    row.insertCell().innerHTML = createActionButton(resourceType, metadata.namespace, metadata.name);
                    break;
                // Add cases for other resource types, adapting field access as needed
                // e.g., deployments: metadata.namespace, metadata.name, status.readyReplicas, status.updatedReplicas, status.availableReplicas, item.age
                default:
                    row.insertCell().textContent = metadata.namespace || 'N/A';
                    row.insertCell().textContent = metadata.name || 'N/A';
                    row.insertCell().textContent = item.age || 'N/A'; // Use pre-calculated age
                    row.insertCell().innerHTML = createActionButton(resourceType, metadata.namespace, metadata.name);
            }
        });
    }

    // Hide pagination controls permanently for the Resource Explorer
    const paginationControls = document.querySelector('#resources .pagination-container'); // More specific selector
    if (paginationControls) {
         paginationControls.style.display = 'none'; 
    }
    
    // Fade in the table container
    // Ensure we target the correct container for Resource Explorer
    const tableContainer = document.getElementById('resourcesTableContainer'); 
    if (tableContainer) {
        tableContainer.style.opacity = 1;
    }
}

// Remove fetchResourceCount function entirely if no longer needed elsewhere
/*
function fetchResourceCount(resourceType, namespace = 'all') {
    // ... implementation removed ...
}
*/

// Remove fetchResourcePage function as it's replaced by fetchResourceData logic
/*
function fetchResourcePage(resourceType, namespace = 'all', criticalOnly = false, page = 1) {
    // ... implementation removed ...
}
*/

// Remove processResourcePageData function as logic is merged or handled differently
/*
function processResourcePageData(resourceType, data, page) {
    // ... implementation removed ...
}
*/

// Remove navigateResourcePage function
/*
function navigateResourcePage(...) {...}
*/

// Remove updatePaginationUI function
/*
function updatePaginationUI(...) {...}
*/

// Remove pagination specific event listeners if any were added previously.
// Example: document.getElementById('prevPageBtn')?.removeEventListener(...);
// Example: document.getElementById('nextPageBtn')?.removeEventListener(...);

// ... rest of index.js ...

// --- Modify callers --- 

function loadResourceType(resourceType) {
    console.log(`Loading resource type: ${resourceType}`);
    window.app.currentResourceType = resourceType; // Keep track of selected type for search/filter
    
    // Update UI elements like headers for the #resourcesTable
    setupTableHeaders(resourceType); 
    
    // Fetch all data for this resource type for the Resource Explorer
    fetchResourceData(resourceType, 'all', false, true); // Pass true to reset cache/data
    
    // Hide pagination for the Resource Explorer tab
    const paginationControls = document.querySelector('#resources .pagination-container'); 
    if (paginationControls) {
         paginationControls.style.display = 'none'; 
    }
}

function refreshResourcesPage() {
    const resourceType = document.getElementById('resourceTypeSelector')?.value || 'pods';
    console.log(`Refreshing resources page for ${resourceType}`);
    
    // Clear search input specifically for the resources tab
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) searchInput.value = '';
    
    // Show loading indicator for the resources tab
    const loadingContainer = document.getElementById('resourcesLoading');
    if (loadingContainer) loadingContainer.style.display = 'flex';

    // Fetch data with reset
    fetchResourceData(resourceType, 'all', false, true);
}

function searchResources() {
    const resourceType = window.app.currentResourceType; // Use the tracked type
    const searchTerm = document.getElementById('resourceSearchInput').value.toLowerCase();
    const cacheKey = `${resourceType}-all-full`; // Fetch from the full cached data

    console.log(`Searching ${resourceType} for: ${searchTerm}`);

    const tableBody = document.getElementById('resourcesTableBody');
    if (!tableBody) {
        console.error('Resource table body not found for search');
        return;
    }
    
    if (window.app.cache.resources[cacheKey]) {
        const allResources = window.app.cache.resources[cacheKey];
        const filteredResources = allResources.filter(item => {
            const name = item.metadata?.name?.toLowerCase() || '';
            const namespace = item.metadata?.namespace?.toLowerCase() || '';
            // Add more fields to search if needed
            return name.includes(searchTerm) || namespace.includes(searchTerm);
        });
        console.log(`Found ${filteredResources.length} matching resources.`);
        // Render the filtered subset directly into the resource explorer table
        renderResourcePage(resourceType, filteredResources); 
    } else {
        // If cache is empty, fetch all and then filter 
        console.warn("Cache empty during search, fetching all first...");
        // Show loading/indicator while fetching?
        fetchResourceData(resourceType, 'all', false, true).then(() => {
            // Re-run search after data is fetched
            console.log("Data fetched, retrying search...");
            searchResources(); 
        });
    }
}

// Update getResourceUsage to handle the structure from kubectl
function getResourceUsage(item) {
    let cpu = '0';
    let memory = '0';
    let gpu = '0';

    try {
        if (item && item.spec && item.spec.containers) {
            let cpuVal = 0;
            let memVal = 0;
            let gpuVal = 0;

        item.spec.containers.forEach(container => {
                const requests = container.resources?.requests || {};
                // CPU (convert millicores)
                if (requests.cpu) {
                    if (requests.cpu.endsWith('m')) {
                        cpuVal += parseInt(requests.cpu.slice(0, -1), 10);
                    } else {
                        cpuVal += parseInt(requests.cpu, 10) * 1000; // Convert cores to millicores
                    }
                }
                // Memory (convert to Mi)
                if (requests.memory) {
                    memory = requests.memory; // Keep original string for now, or parse units
                    // Example parsing (needs robust unit handling)
                     if (requests.memory.endsWith('Ki')) {
                         memVal += parseInt(requests.memory.slice(0, -2)) / 1024;
                     } else if (requests.memory.endsWith('Mi')) {
                         memVal += parseInt(requests.memory.slice(0, -2));
                     } else if (requests.memory.endsWith('Gi')) {
                         memVal += parseInt(requests.memory.slice(0, -2)) * 1024;
                     } // Add more units if needed
                }
                // GPU
                if (requests['nvidia.com/gpu']) {
                    gpuVal += parseInt(requests['nvidia.com/gpu'], 10);
                }
            });

            cpu = `${cpuVal}m`;
            memory = memVal > 0 ? `${Math.round(memVal)}Mi` : '0';
            gpu = gpuVal.toString();
        }
    } catch (e) {
        console.error("Error calculating resource usage:", e, item);
    }

    return { cpu, memory, gpu };
}

// --- Add fetchClusterCapacity function ---
function fetchClusterCapacity() {
    console.log("Fetching cluster capacity...");
    fetch('/get_cluster_capacity')
        .then(response => {
            if (!response.ok) {
                // Try to parse error from backend if possible
                return response.json().then(errData => {
                    throw new Error(errData.error || `HTTP error! status: ${response.status}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log("Cluster capacity data received:", data);
            if (data.error) {
                 throw new Error(data.error);
            }
            // Store capacity globally for percentage calculations
            if (!window.app.state) window.app.state = {};
            window.app.state.clusterCapacity = {
                cpu: data.cpu || 0,
                memory: data.memory || 0, // Memory in Gi
                gpu: data.gpu || 0
            };

            // Update the UI elements that show TOTAL capacity
            const cpuCapacityEl = document.getElementById('totalCPUCapacity');
            if (cpuCapacityEl) {
                cpuCapacityEl.textContent = data.cpu || '?';
            }
             // Update total GPU count card (if needed - updateDashboardMetrics might handle usage count)
            const totalGpuEl = document.getElementById('totalGPUCount');
             if (totalGpuEl && totalGpuEl.textContent === '-') { // Only set if not updated by pod count yet
                 totalGpuEl.textContent = data.gpu || '0';
             }

            // Re-calculate dashboard metrics now that we have capacity
             if (window.app.cache.resources['pods-all-full']) {
                console.log("Re-updating dashboard metrics with new capacity info.");
                 updateDashboardMetrics(window.app.cache.resources['pods-all-full']);
             }

        })
        .catch(error => {
            console.error('Error fetching cluster capacity:', error);
            // Set fallback values in UI
            const cpuCapacityEl = document.getElementById('totalCPUCapacity');
             if (cpuCapacityEl) cpuCapacityEl.textContent = '?';
            const totalGpuEl = document.getElementById('totalGPUCount');
             if (totalGpuEl) totalGpuEl.textContent = '?';
             const cpuPercentageEl = document.getElementById('totalCPUPercentage');
             if (cpuPercentageEl) cpuPercentageEl.textContent = '?';
             const cpuProgressEl = document.getElementById('cpuProgressBar');
             if (cpuProgressEl) cpuProgressEl.style.width = '0%';

            // Store fallback capacity
             if (!window.app.state) window.app.state = {};
            window.app.state.clusterCapacity = { cpu: 0, memory: 0, gpu: 0 };
        });
}

// --- Modify updateDashboardMetrics to use stored capacity ---
function updateDashboardMetrics(pods) {
    console.log("Updating dashboard metrics with pod data:", pods);
    if (!pods) {
        console.warn("No pods data provided to updateDashboardMetrics");
        return;
    }

    let running = 0, succeeded = 0, error = 0;
    let totalCpuReq = 0; // in millicores
    let totalMemReq = 0; // in Mi
    let totalGpuReq = 0; // count

    pods.forEach(pod => {
        const phase = pod.status?.phase;
        if (phase === 'Running' || phase === 'Pending') { // Count Pending as needing resources
            running++;
        } else if (phase === 'Succeeded') {
            succeeded++;
        } else if (phase === 'Failed' || phase === 'Unknown') {
            error++;
        }

        // Calculate resource requests
        if (pod.spec && pod.spec.containers) {
            pod.spec.containers.forEach(container => {
                const requests = container.resources?.requests || {};
                // CPU
                if (requests.cpu) {
                     if (requests.cpu.endsWith('m')) {
                         totalCpuReq += parseInt(requests.cpu.slice(0, -1), 10);
                    } else {
                         totalCpuReq += parseInt(requests.cpu, 10) * 1000; // Convert cores to m cores
                     }
                }
                 // Memory (convert to Mi)
                if (requests.memory) {
                     if (requests.memory.endsWith('Ki')) {
                         totalMemReq += parseInt(requests.memory.slice(0, -2)) / 1024;
                     } else if (requests.memory.endsWith('Mi')) {
                         totalMemReq += parseInt(requests.memory.slice(0, -2));
                     } else if (requests.memory.endsWith('Gi')) {
                         totalMemReq += parseInt(requests.memory.slice(0, -2)) * 1024;
                     } // Add more units if needed (Ti, Pi, etc.) or handle raw bytes
                }
                // GPU
                if (requests['nvidia.com/gpu']) {
                    totalGpuReq += parseInt(requests['nvidia.com/gpu'], 10);
                }
            });
        }
    });

    // Update Pod Counts
    const totalPodsEl = document.getElementById('totalPodsCount');
    if (totalPodsEl) totalPodsEl.textContent = pods.length;
    const runningPodsEl = document.getElementById('runningPodsCount');
    if (runningPodsEl) runningPodsEl.textContent = running;
    const succeededPodsEl = document.getElementById('succeededPodsCount');
    if (succeededPodsEl) succeededPodsEl.textContent = succeeded;
    const errorPodsEl = document.getElementById('errorPodsCount');
    if (errorPodsEl) errorPodsEl.textContent = error;

    // Update CPU Usage Card (using stored total capacity)
    const totalCpuCountEl = document.getElementById('totalCPUCount');
    const cpuPercentageEl = document.getElementById('totalCPUPercentage');
    const cpuProgressEl = document.getElementById('cpuProgressBar');
    const clusterCpuCapacity = window.app.state?.clusterCapacity?.cpu || 0; // Get from stored state

    if (totalCpuCountEl) totalCpuCountEl.textContent = (totalCpuReq / 1000).toFixed(1); // Display as cores

     if (clusterCpuCapacity > 0) {
         const cpuPercentage = ((totalCpuReq / 1000) / clusterCpuCapacity * 100).toFixed(1);
         if (cpuPercentageEl) cpuPercentageEl.textContent = cpuPercentage;
         if (cpuProgressEl) cpuProgressEl.style.width = `${Math.min(cpuPercentage, 100)}%`; // Cap at 100%
    } else {
         if (cpuPercentageEl) cpuPercentageEl.textContent = '0.0';
         if (cpuProgressEl) cpuProgressEl.style.width = '0%';
         console.warn("Cluster CPU capacity is 0 or unknown, cannot calculate percentage.");
     }
    // Update total capacity display (might already be set by fetchClusterCapacity)
    const cpuCapacityEl = document.getElementById('totalCPUCapacity');
    if (cpuCapacityEl && clusterCpuCapacity > 0) {
         cpuCapacityEl.textContent = clusterCpuCapacity;
    }


    // Update GPU Resources Card (Show requested GPU count)
    const totalGpuEl = document.getElementById('totalGPUCount');
    if (totalGpuEl) totalGpuEl.textContent = totalGpuReq;

    console.log(`Dashboard updated: Pods=${pods.length}, CPU=${(totalCpuReq/1000).toFixed(1)}/${clusterCpuCapacity}, GPU=${totalGpuReq}`);
}

// Re-adding Application Refresh Functionality

// Helper to add log messages to the refresh log
function logMessage(refreshLog, message, status) {
    if (!refreshLog) return;
    
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    
    // Set class based on status
    if (status === 'error') {
        logEntry.className = 'text-danger';
    } else if (status === 'warning') {
        logEntry.className = 'text-warning';
    } else if (status === 'success') {
        logEntry.className = 'text-success';
    } else {
        logEntry.className = 'text-info'; // Default to info
    }
    
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    refreshLog.appendChild(logEntry);
    
    // Auto-scroll to the bottom
    refreshLog.scrollTop = refreshLog.scrollHeight;
}

// Function to poll and wait for application to restart
function waitForApplicationRestart(statusDiv, refreshLog = null) {
    const MAX_ATTEMPTS = 30; // Try for up to 30 seconds
    let attempts = 0;
    
    // Update UI to show we're waiting
    if (statusDiv) {
        statusDiv.innerHTML = `
            <div class="alert alert-info">
                <div class="d-flex align-items-center">
                    <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                    Waiting for application to restart...
                </div>
                <div class="progress mt-2" style="height: 5px;">
                    <div class="progress-bar progress-bar-striped progress-bar-animated" 
                         role="progressbar" style="width: 0%"></div>
                </div>
            </div>
        `;
    }
    
    if (refreshLog) {
        logMessage(refreshLog, "Application is restarting. Waiting for it to come back online...", "info");
    }
    
    // Set up polling
    const checkServer = function() {
        attempts++;
        
        // Update progress bar
        if (statusDiv) {
            const progressBar = statusDiv.querySelector('.progress-bar');
            if (progressBar) {
                progressBar.style.width = `${Math.min((attempts / MAX_ATTEMPTS) * 100, 100)}%`;
            }
        }
        
        // Try a lightweight request to check if server is back
        fetch('/health_check', { 
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        })
        .then(response => {
            if (response.ok) {
                // Server is back online!
                if (statusDiv) {
                    statusDiv.innerHTML = `
                        <div class="alert alert-success">
                            <i class="fas fa-check-circle"></i> Application restarted successfully!
                        </div>
                    `;
                }
                
                if (refreshLog) {
                    logMessage(refreshLog, "Application is back online! Refreshing page in 3 seconds...", "success");
                }
                
                // Refresh the page after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            } else {
                // Server responded but with an error
                if (attempts < MAX_ATTEMPTS) {
                    setTimeout(checkServer, 1000);
                } else {
                    handleTimeout();
                }
            }
        })
        .catch(error => {
            // Server is still down, or network error
            if (attempts < MAX_ATTEMPTS) {
                setTimeout(checkServer, 1000);
            } else {
                handleTimeout();
            }
        });
    };
    
    // Function to handle timeout case
    const handleTimeout = function() {
        if (statusDiv) {
            statusDiv.innerHTML = `
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle"></i> The application is taking longer than expected to restart.
                    <button class="btn btn-sm btn-primary mt-2" onclick="window.location.reload()">
                        Refresh Now
                    </button>
                </div>
            `;
        }
        
        if (refreshLog) {
            logMessage(refreshLog, "Application is taking longer than expected to restart. You may need to refresh manually.", "warning");
        }
    };
    
    // Start polling after a short delay
    setTimeout(checkServer, 2000);
}

// Application refresh function (for the refresh button in Settings)
function refreshApplication() {
    const refreshLog = document.getElementById('refreshLog');
    const statusDiv = document.getElementById('updateStatus');
    const logContainer = document.getElementById('refreshLogContainer');
    
    if (!refreshLog || !statusDiv || !logContainer) {
        console.error('Required elements for application refresh not found (refreshLog, updateStatus, or refreshLogContainer)');
        Swal.fire(
            'UI Error',
            'Could not find necessary elements to display refresh progress. Please check the console.',
            'error'
        );
        return;
    }
    
    // Make containers visible
    logContainer.style.display = 'block'; 
    statusDiv.style.display = 'block';

    // Clear the log
    refreshLog.innerHTML = '';
    
    // Add initial message
    logMessage(refreshLog, 'Starting refresh process...', 'info');
    
    // Show initial status
    statusDiv.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Refreshing application...</div>';
    
    fetch('/refresh_application', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            repo_url: undefined // Placeholder, backend uses default or environment var
        })
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            logMessage(refreshLog, 'Application restart initiated. Waiting for server to come back online...', 'info');
            statusDiv.innerHTML = '<div class="alert alert-info">Application is restarting. Waiting for it to come back online...</div>';
            waitForApplicationRestart(statusDiv, refreshLog);
            throw new Error('restart_in_progress');
        }
    })
    .then(data => {
        if (data && data.status === 'success') {
            logMessage(refreshLog, 'Refresh operation successful, application restart initiated.', 'success');
            statusDiv.innerHTML = '<div class="alert alert-info">Application is restarting. Waiting for it to come back online...</div>';
            waitForApplicationRestart(statusDiv, refreshLog);
        } else if (data && data.error) {
            logMessage(refreshLog, `Error: ${data.error}`, 'error');
            statusDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> Error: ${data.error}</div>`;
        }
    })
    .catch(error => {
        if (error.message !== 'restart_in_progress') {
            console.error('Error:', error);
            logMessage(refreshLog, `Error: ${error.message}`, 'error');
            statusDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> Error: ${error.message}</div>`;
        }
    });
}

// Ensure the DOMContentLoaded listener is the very last thing, 
// or make sure these function definitions are placed before they are called.