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
    fetchResourcesForAllTabs();
    fetchClusterCapacity(); // Add this line to fetch cluster capacity on initialization
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
    
    const { items, currentPage, pageSize, showAll } = resourceData;
    
    // Get the table body
    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (!tableBody) {
        console.error(`Table body not found for ${resourceType}`);
        return;
    }

    // Get the table container
    const tableContainer = document.getElementById(`${resourceType}TableContainer`);
    
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
    
    // Calculate how many items to show - respect showAll flag
    const itemsToShow = showAll ? items : items.slice(0, currentPage * pageSize);
    
    // Clear the table body
    tableBody.innerHTML = '';
    
    // If no items, show empty state
    if (itemsToShow.length === 0) {
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
    countInfo.innerHTML = `Showing ${itemsToShow.length} of ${items.length} ${resourceType}`;
    tableContainer.insertBefore(countInfo, tableContainer.firstChild);
    
    // Render items based on resource type
    itemsToShow.forEach(item => {
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
    if (itemsToShow.length < items.length) {
        const loadMoreContainer = document.createElement('div');
        loadMoreContainer.className = 'load-more-container text-center mt-3 mb-2';
        loadMoreContainer.innerHTML = `
            <button class="btn btn-outline-primary load-more-btn">
                <i class="fas fa-chevron-down me-1"></i> 
                Load More (showing ${itemsToShow.length} of ${items.length})
            </button>
        `;
        tableContainer.appendChild(loadMoreContainer);
        
        // Add event listener to load more button
        const loadMoreBtn = loadMoreContainer.querySelector('.load-more-btn');
        loadMoreBtn.addEventListener('click', () => {
            window.app.state.resources[resourceType].currentPage++;
            renderCurrentPage(resourceType);
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

// Resource data fetching (for individual tab clicks or refresh button)
function fetchResourceData(resourceType, namespace = 'all', criticalOnly = false) {
    console.log(`Fetching ${resourceType} data for namespace ${namespace}${criticalOnly ? ' (critical only)' : ''}`);
    
    // Show loading indicators
    showLoading(resourceType);
    
    // Check for recent cached data unless it's being forced (when returning from pod view)
    const returningFromPodView = sessionStorage.getItem('returning_from_pod_view') === 'true';
    const cacheKey = `${resourceType}-${namespace}-${criticalOnly ? 'critical' : 'full'}`;
    const lastFetch = window.app.state.lastFetch[cacheKey];
    
    if (!returningFromPodView && lastFetch && (Date.now() - lastFetch) < window.app.CACHE_TIMEOUT) {
        console.log(`Using cached data for ${resourceType} (${namespace})`);
        
        // Use the cached data
        const cachedData = window.app.state.resources[cacheKey];
        if (cachedData) {
            processResourceData(resourceType, cachedData);
            hideLoading(resourceType);
            return Promise.resolve(cachedData);
        }
    }
    
    // If we're returning from pod view, we should clear the flag after processing
    if (returningFromPodView) {
        sessionStorage.removeItem('returning_from_pod_view');
    }
    
    // No cached data or cache expired, fetch from server
    const startTime = performance.now();
    
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('resource_type', resourceType);
        formData.append('namespace', namespace);
        formData.append('critical_only', criticalOnly.toString());
        
        // Use helper function to ensure URL is relative
        const url = window.app.getRelativeUrl('/get_resources');
        
        fetch(url, {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log(`Fetched ${resourceType} data in ${Math.round(performance.now() - startTime)}ms`);
            
            // Update the last fetch time and cache the data
            window.app.state.lastFetch[cacheKey] = Date.now();
            window.app.state.resources[cacheKey] = data;
            
            // Process the data
            processResourceData(resourceType, data, startTime);
            
            // Hide loading indicators
            hideLoading(resourceType);
            
            resolve(data);
        })
        .catch(error => {
            console.error(`Error fetching ${resourceType}:`, error);
            
            // Show error message
            hideLoading(resourceType);
            const tableContainer = document.getElementById(`${resourceType}TableContainer`);
            if (tableContainer) {
                tableContainer.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Error loading ${resourceType}: ${error.message}
                        <button class="btn btn-sm btn-outline-danger ms-3" onclick="fetchResourceData('${resourceType}', '${namespace}')">
                            <i class="fas fa-sync-alt me-1"></i> Retry
                        </button>
                    </div>
                `;
            }
            
            reject(error);
        });
    });
}

// Load all service types (non-pods) at once
function loadAllServiceTypes() {
    console.log('Loading all service types...');
    
    // Define all non-pod resource types
    const serviceTypes = ['services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    // Create a loading indicator at the top of the page
    const mainContent = document.getElementById('mainContent');
    if (!mainContent) return;
    
    // Create loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'alert alert-info mb-4';
    loadingIndicator.id = 'allServicesLoadingIndicator';
    loadingIndicator.innerHTML = `
        <i class="fas fa-sync fa-spin me-2"></i>
        <span>Loading all service types...</span>
        <div class="progress mt-2">
            <div class="progress-bar" role="progressbar" style="width: 0%" id="allServicesProgressBar"></div>
        </div>
    `;
    
    // Add to the beginning of the content
    mainContent.insertBefore(loadingIndicator, mainContent.firstChild);
    
    // Function to update progress
    const updateProgress = (completed, total) => {
        const progressBar = document.getElementById('allServicesProgressBar');
        if (progressBar) {
            const percentage = Math.round((completed / total) * 100);
            progressBar.style.width = `${percentage}%`;
            progressBar.textContent = `${completed}/${total} loaded`;
            
            // Update text
            const textSpan = loadingIndicator.querySelector('span');
            if (textSpan) {
                textSpan.textContent = `Loading all service types (${completed}/${total})...`;
            }
        }
    };
    
    // Track completed fetchResourceData calls
    let completedCount = 0;
    
    // Set a flag to show all items
    window.app.showAllItems = true;
    
    // Store all promises in an array
    const fetchPromises = serviceTypes.map(type => {
        // Activate the corresponding tab first
        const tabButton = document.getElementById(`${type}-tab`);
        if (tabButton) {
            tabButton.click();
        }
        
        // Show loading indicators
        showLoading(type);
        
        // Fetch data with limit set to 0 to get all items
        return fetchResourceData(type, 'all', false)
            .then(data => {
                completedCount++;
                updateProgress(completedCount, serviceTypes.length);
                
                // Make sure page size is large enough to show all items
                if (window.app.state.resources[type]) {
                    window.app.state.resources[type].pageSize = 1000; // Show more items per page
                    window.app.state.resources[type].currentPage = 1; // Reset current page
                    window.app.state.resources[type].showAll = true; // Mark this resource type to show all items
                    renderCurrentPage(type); // Re-render with more items
                }
                
                return data;
            })
            .catch(error => {
                completedCount++;
                updateProgress(completedCount, serviceTypes.length);
                console.error(`Error loading ${type}:`, error);
                return null;
            });
    });
    
    // When all fetches complete
    Promise.all(fetchPromises)
        .then(() => {
            console.log('All service types loaded');
            
            // Remove loading indicator
            setTimeout(() => {
                loadingIndicator.remove();
                
                // Show success message
                const successMessage = document.createElement('div');
                successMessage.className = 'alert alert-success mb-4';
                successMessage.innerHTML = `
                    <i class="fas fa-check-circle me-2"></i>
                    All service types loaded successfully. Use the tabs to view each type.
                    <button class="btn btn-sm btn-outline-success ms-3" onclick="resetPagination()">
                        <i class="fas fa-undo me-1"></i> Reset Pagination
                    </button>
                `;
                mainContent.insertBefore(successMessage, mainContent.firstChild);
                
                // Auto-remove success message after 10 seconds
                setTimeout(() => {
                    if (document.contains(successMessage)) {
                        successMessage.remove();
                    }
                }, 10000);
            }, 500);
        });
}

// Reset pagination after loading all items
function resetPagination() {
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    window.app.showAllItems = false;
    
    resourceTypes.forEach(type => {
        if (window.app.state.resources[type]) {
            window.app.state.resources[type].pageSize = 10; // Reset to default page size
            window.app.state.resources[type].currentPage = 1; // Reset current page
            window.app.state.resources[type].showAll = false; // Reset show all flag
            
            // Re-render if this is the active tab
            const tabContent = document.getElementById(type);
            if (tabContent && tabContent.classList.contains('active')) {
                renderCurrentPage(type);
            }
        }
    });
    
    // Show message
    const mainContent = document.getElementById('mainContent');
    if (mainContent) {
        const resetMessage = document.createElement('div');
        resetMessage.className = 'alert alert-info mb-4';
        resetMessage.innerHTML = `
            <i class="fas fa-undo me-2"></i>
            Pagination has been reset to default.
        `;
        mainContent.insertBefore(resetMessage, mainContent.firstChild);
        
        // Auto-remove message after 3 seconds
        setTimeout(() => {
            if (document.contains(resetMessage)) {
                resetMessage.remove();
            }
        }, 3000);
    }
}

// Helper function to process resource data
function processResourceData(resourceType, data, startTime, processingStartTime = performance.now()) {
    // Store the full dataset
    window.app.state.resources[resourceType] = {
        items: data.data.items,
        currentPage: 1,
        pageSize: 10,
        sortField: 'name',
        sortDirection: 'asc'
    };

    // Always update dashboard metrics for pods, even when using cached data
    if (resourceType === 'pods') {
        console.log('Updating dashboard metrics with data from –', data.data.items.length, '– "pods"');
        updateDashboardMetrics(data.data.items);
    }
    
    // Add sort functionality to the table
    setTimeout(() => {
        addSortingToResourceTable(resourceType);
    }, 100);

    // Render the current page
    renderCurrentPage(resourceType);

    // Update loading state
    const loadingContainer = document.getElementById(`${resourceType}Loading`);
    if (loadingContainer) {
        loadingContainer.style.display = 'none';
    }
    const tableContainer = document.getElementById(`${resourceType}TableContainer`);
    if (tableContainer) {
        tableContainer.style.opacity = '1';
    }

    // Log performance info
    const endTime = performance.now();
    const fetchTime = processingStartTime - startTime;
    const processTime = endTime - processingStartTime;
    const totalTime = endTime - startTime;
    console.log(`${resourceType} loaded in ${totalTime.toFixed(0)}ms (fetch: ${fetchTime.toFixed(0)}ms, process: ${processTime.toFixed(0)}ms)`);

    return data;
}

// Show loading indicator for resource type
function showLoading(resourceType) {
    const loadingContainer = document.getElementById(`${resourceType}Loading`);
    const tableContainer = document.getElementById(`${resourceType}TableContainer`);
    const progressBar = document.getElementById(`${resourceType}ProgressBar`);
    
    if (loadingContainer) {
        loadingContainer.style.display = 'flex';
    }
    if (tableContainer) {
        tableContainer.style.opacity = '0';
    }
    if (progressBar) {
        progressBar.style.width = '5%';
        progressBar.style.background = 'linear-gradient(to right, #f5f5f5, #01a982)';
        
        // Animate progress bar
        setTimeout(() => {
            progressBar.style.width = '30%';
            setTimeout(() => {
                progressBar.style.width = '60%';
            }, 500);
        }, 200);
    }
    
    // Update loading text
    const loadingText = document.getElementById(`${resourceType}LoadingText`);
    if (loadingText) {
        loadingText.textContent = 'Loading data...';
    }
}

// Hide loading indicator for resource type
function hideLoading(resourceType) {
    const loadingContainer = document.getElementById(`${resourceType}Loading`);
    const tableContainer = document.getElementById(`${resourceType}TableContainer`);
    const progressBar = document.getElementById(`${resourceType}ProgressBar`);
    
    if (progressBar) {
        progressBar.style.width = '100%';
        setTimeout(() => {
            if (loadingContainer) {
                loadingContainer.style.display = 'none';
            }
            if (progressBar) {
                progressBar.style.width = '0%';
            }
        }, 500);
    }
    
    // Don't set table container opacity here - that's handled in renderCurrentPage
}

// Update loading step with animation
function updateLoadingStep(resourceType, stepIndex) {
    const steps = [
        { text: 'Initializing...', percentage: 5 },
        { text: 'Fetching data...', percentage: 30 },
        { text: 'Processing...', percentage: 60 },
        { text: 'Finalizing...', percentage: 90 },
        { text: 'Complete', percentage: 100 }
    ];

    const progressBar = document.getElementById(`${resourceType}ProgressBar`);
    const loadingText = document.getElementById(`${resourceType}LoadingText`);
    
    if (progressBar && stepIndex < steps.length) {
        progressBar.style.width = `${steps[stepIndex].percentage}%`;
    }
    
    if (loadingText && stepIndex < steps.length) {
        loadingText.textContent = steps[stepIndex].text;
    }
}

// Advance to next loading step manually
function advanceLoadingStep(resourceType) {
    if (!window.loadingStepIndex || window.loadingStepIndex[resourceType] === undefined) {
        return;
    }
    
    const nextStep = window.loadingStepIndex[resourceType] + 1;
    if (window.loadingSteps[resourceType] && nextStep < window.loadingSteps[resourceType].length) {
        updateLoadingStep(resourceType, nextStep);
    }
}

// UI helpers
function createActionButton(resourceType, namespace, name) {
    if (resourceType === 'pods') {
        return `
            <div class="action-dropdown dropdown text-center">
                <button class="dropdown-toggle" type="button" id="dropdown-${namespace}-${name}" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="dropdown-${namespace}-${name}">
                    <li><a class="dropdown-item explore-pod-link" href="/explore/${namespace}/${name}#details" data-namespace="${namespace}" data-pod-name="${name}">
                        <i class="fas fa-search text-primary"></i> View Details
                    </a></li>
                    <li><a class="dropdown-item" href="/explore/${namespace}/${name}#describe" data-namespace="${namespace}" data-pod-name="${name}">
                        <i class="fas fa-info-circle text-info"></i> Describe
                    </a></li>
                    <li><a class="dropdown-item" href="/explore/${namespace}/${name}#logs" data-namespace="${namespace}" data-pod-name="${name}">
                        <i class="fas fa-file-alt text-success"></i> Logs
                    </a></li>
                    <li><a class="dropdown-item" href="/explore/${namespace}/${name}#access" data-namespace="${namespace}" data-pod-name="${name}">
                        <i class="fas fa-terminal text-warning"></i> Access
                    </a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item" href="#" onclick="runAction('delete', '${resourceType}', '${namespace}', '${name}')">
                        <i class="fas fa-trash-alt text-danger"></i> Delete
                    </a></li>
                </ul>
            </div>
        `;
    }
    return `
        <div class="action-dropdown dropdown text-center">
            <button class="dropdown-toggle" type="button" id="dropdown-${namespace}-${name}" data-bs-toggle="dropdown" aria-expanded="false">
                <i class="fas fa-ellipsis-v"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="dropdown-${namespace}-${name}">
                <li><a class="dropdown-item" href="#" onclick="runAction('describe', '${resourceType}', '${namespace}', '${name}')">
                    <i class="fas fa-info-circle text-info"></i> Describe
                </a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#" onclick="runAction('delete', '${resourceType}', '${namespace}', '${name}')">
                    <i class="fas fa-trash-alt text-danger"></i> Delete
                </a></li>
            </ul>
        </div>
    `;
}

// YAML deployment
function deployYaml() {
    const fileInput = document.querySelector('.drop-zone__input');
    const file = fileInput.files[0];
    if (file) {
        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload_yaml', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            document.getElementById('yamlOutput').textContent = data.output || data.error;
        })
        .catch(error => {
            console.error('Error:', error);
            document.getElementById('yamlOutput').textContent = 'An error occurred while deploying the YAML file.';
        });
    }
}

// Drop zone setup
function setupDropZone() {
    document.querySelectorAll(".drop-zone__input").forEach((inputElement) => {
        const dropZoneElement = inputElement.closest(".drop-zone");
        if (!dropZoneElement) return;

        dropZoneElement.addEventListener("click", (e) => {
            inputElement.click();
        });

        inputElement.addEventListener("change", (e) => {
            if (inputElement.files.length) {
                updateThumbnail(dropZoneElement, inputElement.files[0]);
                const deployButton = document.getElementById('deployButton');
                if (deployButton) {
                    deployButton.style.display = 'inline-block';
                }
            }
        });

        dropZoneElement.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZoneElement.classList.add("drop-zone--over");
        });

        ["dragleave", "dragend"].forEach((type) => {
            dropZoneElement.addEventListener(type, (e) => {
                dropZoneElement.classList.remove("drop-zone--over");
            });
        });

        dropZoneElement.addEventListener("drop", (e) => {
            e.preventDefault();

            if (e.dataTransfer.files.length) {
                inputElement.files = e.dataTransfer.files;
                updateThumbnail(dropZoneElement, e.dataTransfer.files[0]);
                const deployButton = document.getElementById('deployButton');
                if (deployButton) {
                    deployButton.style.display = 'inline-block';
                }
            }

            dropZoneElement.classList.remove("drop-zone--over");
        });
    });
}

function updateThumbnail(dropZoneElement, file) {
    let thumbnailElement = dropZoneElement.querySelector(".drop-zone__thumb");

    if (dropZoneElement.querySelector(".drop-zone__prompt")) {
        dropZoneElement.querySelector(".drop-zone__prompt").remove();
    }

    if (!thumbnailElement) {
        thumbnailElement = document.createElement("div");
        thumbnailElement.classList.add("drop-zone__thumb");
        dropZoneElement.appendChild(thumbnailElement);
    }

    thumbnailElement.dataset.label = file.name;

    if (file.type.startsWith("image/")) {
        const reader = new FileReader();

        reader.readAsDataURL(file);
        reader.onload = () => {
            thumbnailElement.style.backgroundImage = `url('${reader.result}')`;
        };
    } else {
        thumbnailElement.style.backgroundImage = null;
    }
}

// Check git availability
function checkGitAvailability() {
    fetch('/git_status')
    .then(response => response.json())
    .then(data => {
        const githubSettings = document.getElementById('githubSettings');
        if (githubSettings) {
        if (!data.available) {
            githubSettings.innerHTML = `
                <div class="alert alert-warning">
                    <strong>Git functionality is not available.</strong> 
                    <p>The "Update from GitHub" feature requires git to be installed on the server. 
                    Please install git or contact your administrator if you need this feature.</p>
                </div>
            `;
            }
        }
    })
    .catch(error => {
        console.error('Error checking git status:', error);
    });
}

// Fetch namespaces for events tab
function fetchNamespaces() {
    fetch('/get_namespaces')
        .then(response => response.json())
        .then(data => {
            const namespaceSelect = document.getElementById('namespaceSelect');
            if (!namespaceSelect) return;
            
            namespaceSelect.innerHTML = '<option value="">Select a namespace</option>';
            
            if (data.namespaces) {
                data.namespaces.forEach(namespace => {
                    const option = document.createElement('option');
                    option.value = namespace;
                    option.textContent = namespace;
                    namespaceSelect.appendChild(option);
                });
            } else if (data.error) {
                console.error('Error fetching namespaces:', data.error);
            }
            
            // Set up event listener for namespace selection
            namespaceSelect.addEventListener('change', function() {
                if (this.value) {
                    fetchEvents(this.value);
                }
            });
        })
        .catch(error => {
            console.error('Error fetching namespaces:', error);
        });
}

// Fetch events for selected namespace
function fetchEvents(namespace) {
    const eventsOutput = document.getElementById('eventsOutput');
    if (!eventsOutput) return;
    
    eventsOutput.textContent = 'Loading events...';
    
    fetch('/get_events', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `namespace=${namespace}`
    })
    .then(response => response.json())
    .then(data => {
        eventsOutput.textContent = data.output;
    })
    .catch(error => {
        console.error('Error fetching events:', error);
        eventsOutput.textContent = 'An error occurred while fetching events.';
    });
}

// Application refresh function (for the refresh button)
function refreshApplication() {
    const refreshLog = document.getElementById('refreshLog');
    const statusDiv = document.getElementById('updateStatus');
    
    if (!refreshLog || !statusDiv) {
        console.error('Required elements not found');
        return;
    }
    
    // Clear the log
    refreshLog.innerHTML = '';
    
    // Add initial message
    const logEntry = document.createElement('div');
    logEntry.className = 'text-info';
    logEntry.innerHTML = `[${new Date().toLocaleTimeString()}] Starting refresh process...`;
    refreshLog.appendChild(logEntry);
    
    statusDiv.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div> Refreshing application...';
    
    fetch('/refresh_application', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            repo_url: undefined // This is a placeholder value, not used in the refresh process
        })
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            // If the request fails, it might be because the app is already restarting
            logMessage(refreshLog, 'Application restart initiated. Waiting for server to come back online...', 'info');
            statusDiv.innerHTML = 'Application is restarting. Waiting for it to come back online...';
            waitForApplicationRestart(statusDiv, refreshLog);
            throw new Error('restart_in_progress');
        }
    })
    .then(data => {
        if (data && data.status === 'success') {
            logMessage(refreshLog, 'Refresh operation successful, application restart initiated.', 'success');
            statusDiv.innerHTML = 'Application is restarting. Waiting for it to come back online...';
            waitForApplicationRestart(statusDiv, refreshLog);
        } else if (data && data.error) {
            logMessage(refreshLog, `Error: ${data.error}`, 'error');
            statusDiv.innerHTML = `<div class="alert alert-danger">Error: ${data.error}</div>`;
        }
    })
    .catch(error => {
        if (error.message !== 'restart_in_progress') {
            console.error('Error:', error);
            logMessage(refreshLog, `Error: ${error.message}`, 'error');
            statusDiv.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
        }
    });
}

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
        logEntry.className = 'text-info';
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
            // Add cache-busting to prevent cached responses
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
                
                // Refresh the page after a short delay to let the user see the success message
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
    
    // Start polling after a short delay to allow the server to begin restarting
    setTimeout(checkServer, 2000);
}

// Clear refresh log
function clearRefreshLog() {
    const refreshLog = document.getElementById('refreshLog');
    if (refreshLog) {
        refreshLog.innerHTML = '<div class="text-muted">-- Log will appear here during refresh operations --</div>';
    }
}

// Filter to show only pods with GPUs
function filterPodsWithGPUs() {
    if (!window.podsWithGPUs) return;
    
    const podRows = document.querySelectorAll('#podsTable tbody tr');
    const gpuPodNames = window.podsWithGPUs.map(pod => `${pod.namespace}/${pod.name}`);
    
    podRows.forEach(row => {
        const namespace = row.cells[0]?.textContent;
        const name = row.cells[1]?.textContent;
        
        if (gpuPodNames.includes(`${namespace}/${name}`)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    
    // Check if any rows are visible
    const anyVisible = Array.from(podRows).some(row => row.style.display !== 'none');
    if (!anyVisible) {
        showNoGPUPodsMessage();
    }
}

// Show a message when no GPU pods are found
function showNoGPUPodsMessage() {
    const tableBody = document.querySelector('#podsTable tbody');
    if (!tableBody) return;
    
    // Check if message already exists
    let noGPURow = tableBody.querySelector('.no-gpu-pods-row');
    
    if (!noGPURow) {
        noGPURow = document.createElement('tr');
        noGPURow.className = 'no-gpu-pods-row';
        noGPURow.innerHTML = `
            <td colspan="7" class="text-center">
                <div class="alert alert-info m-3">
                    <i class="fas fa-info-circle me-2"></i> No pods with GPU resources found.
                    <button class="btn btn-sm btn-outline-primary ms-3" onclick="clearGPUFilter()">
                        Clear Filter
                    </button>
                </div>
            </td>
        `;
        tableBody.appendChild(noGPURow);
    } else {
        noGPURow.style.display = '';
    }
}

// Clear GPU filter directly (for use in the "Clear Filter" button)
function clearGPUFilter() {
    const gpuCard = document.getElementById('gpuCard');
    const gpuFilterStatus = document.getElementById('gpuFilterStatus');
    
    gpuCard.classList.remove('filter-active');
    gpuFilterStatus.textContent = 'Click to filter by GPU';
    
    // Show all pod rows
    const podRows = document.querySelectorAll('#podsTable tbody tr');
    podRows.forEach(row => {
        row.style.display = '';
    });
    
    // Hide the no-gpu-pods message if it exists
    const noGPURow = document.querySelector('.no-gpu-pods-row');
    if (noGPURow) {
        noGPURow.style.display = 'none';
    }
}

// Navigation function to handle explore pod links
document.addEventListener('click', function(e) {
    // Use delegation to handle clicks on explore pod links
    const exploreLink = e.target.closest('.explore-pod-link');
    if (exploreLink) {
        e.preventDefault();
        const namespace = exploreLink.dataset.namespace;
        const podName = exploreLink.dataset.podName;
        const url = `/explore/${namespace}/${podName}`;
        
        console.log(`Navigating to pod explorer: ${url}`);
        
        // Navigate to the explore page using full page navigation
        window.location.href = url;
    }
});

// Setup tab click handlers
function setupTabClickHandlers() {
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    resourceTypes.forEach(resourceType => {
        // Add controls to each resource tab if not already added
        addResourceControls(resourceType);
        
        // Set up tab click handlers
        const tabElement = document.querySelector(`#${resourceType}-tab`);
        if (tabElement) {
            // Remove existing event listeners (to prevent duplicates)
            const newTabElement = tabElement.cloneNode(true);
            tabElement.parentNode.replaceChild(newTabElement, tabElement);
            
            // Add new click event listener
            newTabElement.addEventListener('click', () => {
                console.log(`Tab ${resourceType} clicked, loading data...`);
                
                // Get current namespace selection
                const namespaceSelector = document.getElementById(`${resourceType}Namespace`);
                const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
                
                // Show loading indicator
                showLoading(resourceType);
                
                // Fetch resource data, forcing a refresh by removing from loaded resources
                window.app.loadedResources = window.app.loadedResources || {};
                delete window.app.loadedResources[resourceType];
                
                // Clear existing cache for this resource type
                const cacheKey = `${resourceType}-${currentNamespace}-full`;
                if (window.app.state.resources && window.app.state.resources[cacheKey]) {
                    delete window.app.state.resources[cacheKey];
                }
                if (window.app.state.lastFetch && window.app.state.lastFetch[cacheKey]) {
                    delete window.app.state.lastFetch[cacheKey];
                }
                
                // Make sure the table container is visible
                const tableContainer = document.getElementById(`${resourceType}TableContainer`);
                if (tableContainer) {
                    tableContainer.style.display = 'block';
                    // Start with opacity 0, will be set to 1 after data is loaded
                    tableContainer.style.opacity = '0';
                }
                
                fetchResourceData(resourceType, currentNamespace, false);
            });
        }
    });
}

// Helper function to calculate resource usage
function getResourceUsage(item) {
    let cpu = 0;
    let gpu = 0;
    let memory = '0';
    
    // Function to convert memory to standardized format (Mi)
    function standardizeMemory(memStr) {
        if (!memStr) return '0Mi';
        
        // Remove any whitespace
        memStr = memStr.trim();
        
        // Check if memory is in Ki format
        if (memStr.endsWith('Ki')) {
            const valueInKi = parseFloat(memStr.slice(0, -2));
            return (valueInKi / 1024).toFixed(1) + 'Mi';
        }
        
        // Check if memory is in Mi format
        if (memStr.endsWith('Mi')) {
            return memStr;
        }
        
        // Check if memory is in Gi format
        if (memStr.endsWith('Gi')) {
            const valueInGi = parseFloat(memStr.slice(0, -2));
            return (valueInGi * 1024).toFixed(0) + 'Mi';
        }
        
        // Check if memory is in bytes (no unit)
        if (!isNaN(memStr)) {
            const valueInBytes = parseFloat(memStr);
            return (valueInBytes / (1024 * 1024)).toFixed(1) + 'Mi';
        }
        
        // Default case: just return the original string
        return memStr;
    }
    
    // If this is a pod, extract resource data from containers
    if (item.spec && item.spec.containers) {
        item.spec.containers.forEach(container => {
            if (container.resources && container.resources.requests) {
                // Add CPU requests if available
                if (container.resources.requests.cpu) {
                    const cpuRequest = container.resources.requests.cpu;
                    if (cpuRequest.endsWith('m')) {
                        // Convert millicpu to CPU
                        cpu += parseInt(cpuRequest.slice(0, -1)) / 1000;
                    } else {
                        // Direct CPU value
                        cpu += parseFloat(cpuRequest);
                    }
                }
                
                // Add GPU resources if available
                if (container.resources.requests['nvidia.com/gpu']) {
                    gpu += parseInt(container.resources.requests['nvidia.com/gpu']);
                } else if (container.resources.requests['gpu']) {
                    gpu += parseInt(container.resources.requests['gpu']);
                }
                
                // Add memory requests if available
                if (container.resources.requests.memory) {
                    const memRequest = standardizeMemory(container.resources.requests.memory);
                    // Extract numeric value from memory string
                    const memValue = parseFloat(memRequest);
                    memory = memValue + 'Mi';
                }
            }
        });
    }
    
    return {
        cpu: cpu.toFixed(2),
        gpu: gpu.toString(),
        memory: memory
    };
}

// Helper function to get status icon based on phase
function getStatusIcon(phase) {
    if (!phase) return '';
    
    phase = phase.toLowerCase();
    switch (phase) {
        case 'running':
        case 'true':
            return '<i class="fas fa-check-circle text-success me-1"></i>';
        case 'succeeded':
            return '<i class="fas fa-check-square text-primary me-1"></i>';
        case 'pending':
            return '<i class="fas fa-clock text-warning me-1"></i>';
        case 'failed':
        case 'false':
            return '<i class="fas fa-times-circle text-danger me-1"></i>';
        case 'unknown':
            return '<i class="fas fa-question-circle text-muted me-1"></i>';
        default:
            return '<i class="fas fa-info-circle text-info me-1"></i>';
    }
}

// Fetch cluster capacity information
function fetchClusterCapacity() {
    console.log('Fetching cluster capacity information...');
    
    // Initialize capacity object if it doesn't exist
    if (!window.clusterCapacity) {
        window.clusterCapacity = {
            cpu: 256, // Default values
            memory: 1024,
            gpu: 8
        };
    }
    
    // Update loading detail when this runs during a load process
    const podsLoadingDetails = document.getElementById('podsLoadingDetails');
    if (podsLoadingDetails && document.getElementById('podsLoading').style.display !== 'none') {
        podsLoadingDetails.textContent = 'Fetching cluster capacity information...';
    }
    
    return fetch('/get_cluster_capacity')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch cluster capacity: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Update values only if they exist in the response and are valid numbers
            if (data.cpu && !isNaN(parseFloat(data.cpu))) {
                window.clusterCapacity.cpu = parseFloat(data.cpu);
            }
            if (data.memory && !isNaN(parseFloat(data.memory))) {
                window.clusterCapacity.memory = parseFloat(data.memory);
            }
            if (data.gpu !== undefined && !isNaN(parseInt(data.gpu))) {
                window.clusterCapacity.gpu = parseInt(data.gpu);
            }
            
            console.log(`Cluster capacity loaded: ${window.clusterCapacity.cpu} CPU cores, ${window.clusterCapacity.memory} Gi memory, ${window.clusterCapacity.gpu} GPUs`);
            
            // Update capacity display in the UI
            const cpuCapacityElement = document.getElementById('totalCPUCapacity');
            if (cpuCapacityElement) {
                cpuCapacityElement.textContent = window.clusterCapacity.cpu;
            }
            
            // If we already have pod data, recalculate the metrics with the new capacity
            if (window.app.state && window.app.state.resources && window.app.state.resources.pods) {
                console.log('Recalculating metrics with updated capacity');
                updateDashboardMetrics(window.app.state.resources.pods.data.items);
            }
            
            // Update loading detail if we're in the middle of loading
            if (podsLoadingDetails && document.getElementById('podsLoading').style.display !== 'none') {
                podsLoadingDetails.textContent = 'Cluster capacity information loaded';
            }
            
            return data;
        })
        .catch(error => {
            console.warn(`Error fetching cluster capacity: ${error.message}. Using default values.`);
            
            // Make sure default values are set
            window.clusterCapacity = window.clusterCapacity || {
                cpu: 256,
                memory: 1024,
                gpu: 8
            };
            
            // Update capacity display in the UI with defaults
            const cpuCapacityElement = document.getElementById('totalCPUCapacity');
            if (cpuCapacityElement) {
                cpuCapacityElement.textContent = window.clusterCapacity.cpu;
            }
            
            // Update loading detail if we're in the middle of loading
            if (podsLoadingDetails && document.getElementById('podsLoading').style.display !== 'none') {
                podsLoadingDetails.textContent = 'Using default cluster capacity values';
            }
            
            return window.clusterCapacity;
        });
}

// Namespaces functionality
$(document).ready(function() {
    // Initialize namespaces tab
    $('a[data-bs-toggle="tab"][data-bs-target="#namespaces"]').on('shown.bs.tab', function (e) {
        loadNamespaces();
    });

    // Refresh namespaces button
    $('#refreshNamespaces').on('click', function() {
        loadNamespaces();
    });

    // Filter namespaces
    $('#namespaceSearchInput').on('keyup', function() {
        filterNamespaces();
    });

    // Sort namespaces
    $('.sort-option').on('click', function(e) {
        e.preventDefault();
        const sortBy = $(this).data('sort');
        sortNamespaces(sortBy);
    });

    // Handle namespace actions
    $(document).on('click', '.namespace-action', function() {
        const action = $(this).data('action');
        const namespace = $(this).data('namespace');
        
        if (action === 'events') {
            openNamespaceModal(namespace, 'events');
        } else if (action === 'describe') {
            openNamespaceModal(namespace, 'describe');
        } else if (action === 'edit') {
            openNamespaceModal(namespace, 'edit');
        } else if (action === 'delete') {
            openNamespaceModal(namespace, 'delete');
        }
    });

    // Save namespace changes
    $('#saveNamespaceChanges').on('click', function() {
        saveNamespaceChanges();
    });

    // Handle namespace delete confirmation input
    $('#namespaceDeleteConfirm').on('input', function() {
        const inputValue = $(this).val();
        const namespaceName = $('#currentNamespaceName').text();
        
        if (inputValue === namespaceName) {
            $('#confirmNamespaceDelete').prop('disabled', false);
        } else {
            $('#confirmNamespaceDelete').prop('disabled', true);
        }
    });
    
    // Handle namespace delete button
    $('#confirmNamespaceDelete').on('click', function() {
        deleteNamespace();
    });

    // Switch tabs in namespace modal
    $('#namespaceDetailTabs button').on('shown.bs.tab', function (e) {
        const tabId = $(e.target).attr('id');
        if (tabId === 'edit-tab') {
            $('#saveNamespaceChanges').show();
        } else {
            $('#saveNamespaceChanges').hide();
        }
    });
});

// Load namespaces data
function loadNamespaces() {
    // Show loading indicator
    $('#namespacesLoading').show();
    $('#namespacesTableCard').hide();
    $('#noNamespacesMessage').hide();

    // Fetch namespaces data
    $.ajax({
        url: '/get_namespace_details',
        type: 'GET',
        success: function(response) {
            if (response.hasOwnProperty('namespaces')) {
                // Store the namespaces data for filtering/sorting
                window.namespacesData = response.namespaces;
                
                // Render the namespaces
                renderNamespaces(window.namespacesData);
            } else {
                showNoNamespaces('Error loading namespaces');
            }
        },
        error: function() {
            showNoNamespaces('Failed to fetch namespaces data');
        },
        complete: function() {
            $('#namespacesLoading').hide();
        }
    });
}

// Render namespaces table
function renderNamespaces(namespaces) {
    const tableBody = $('#namespacesTableBody');
    tableBody.empty();

    if (namespaces.length === 0) {
        showNoNamespaces();
        return;
    }

    namespaces.forEach(function(ns) {
        const row = $('<tr>');
        
        // Name column
        row.append(`<td>
            <div class="d-flex align-items-center">
                <div class="avatar-sm rounded bg-info me-3">
                    <span class="avatar-title rounded">
                        <i class="fas fa-project-diagram text-white"></i>
                    </span>
                </div>
                <div>
                    <h6 class="mb-0">${ns.name}</h6>
                    <small class="text-muted">${getCreationTime(ns)}</small>
                </div>
            </div>
        </td>`);
        
        // Pod count column
        row.append(`<td class="text-center">
            <span class="fw-bold">${ns.podCount}</span>
        </td>`);
        
        // vCPU usage column
        row.append(`<td class="text-center resource-cell cpu-cell">
            <span class="fw-bold">${ns.resources.cpu}</span> vCPUs
        </td>`);
        
        // GPU usage column
        row.append(`<td class="text-center resource-cell gpu-cell">
            <span class="fw-bold">${ns.resources.gpu}</span> GPUs
        </td>`);
        
        // Memory usage column
        row.append(`<td class="text-center resource-cell memory-cell">
            <span class="fw-bold">${ns.resources.memory}</span> MB
        </td>`);
        
        // Status column
        const status = getNamespaceStatus(ns);
        row.append(`<td class="text-center">
            <span class="badge bg-${status.color}">${status.text}</span>
        </td>`);
        
        // Actions column
        row.append(`<td class="text-center">
            <div class="dropdown action-dropdown">
                <button class="btn dropdown-toggle" type="button" id="namespace-dropdown-${ns.name}" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="namespace-dropdown-${ns.name}">
                    <li><a class="dropdown-item namespace-action" href="#" data-action="events" data-namespace="${ns.name}">
                        <i class="fas fa-clock text-info"></i> Events
                    </a></li>
                    <li><a class="dropdown-item namespace-action" href="#" data-action="describe" data-namespace="${ns.name}">
                        <i class="fas fa-info-circle text-primary"></i> Describe
                    </a></li>
                    <li><a class="dropdown-item namespace-action" href="#" data-action="edit" data-namespace="${ns.name}">
                        <i class="fas fa-edit text-warning"></i> Edit
                    </a></li>
                    <li><hr class="dropdown-divider"></li>
                    <li><a class="dropdown-item namespace-action" href="#" data-action="delete" data-namespace="${ns.name}">
                        <i class="fas fa-trash-alt text-danger"></i> Delete
                    </a></li>
                </ul>
            </div>
        </td>`);
        
        tableBody.append(row);
    });

    $('#namespacesTableCard').show();
    
    // Reinitialize dropdowns
    setTimeout(function() {
        var dropdownElementList = [].slice.call(document.querySelectorAll('.action-dropdown .dropdown-toggle'));
        dropdownElementList.map(function(dropdownToggleEl) {
            return new bootstrap.Dropdown(dropdownToggleEl);
        });
    }, 100);
}

// Filter namespaces based on search input
function filterNamespaces() {
    const searchTerm = $('#namespaceSearchInput').val().toLowerCase();
    
    if (!window.namespacesData) return;
    
    const filteredNamespaces = window.namespacesData.filter(function(ns) {
        return ns.name.toLowerCase().includes(searchTerm);
    });
    
    renderNamespaces(filteredNamespaces);
}

// Sort namespaces based on selected option
function sortNamespaces(sortBy) {
    if (!window.namespacesData) return;
    
    const sortedNamespaces = [...window.namespacesData];
    
    switch (sortBy) {
        case 'name':
            sortedNamespaces.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'name-desc':
            sortedNamespaces.sort((a, b) => b.name.localeCompare(a.name));
            break;
        case 'pods':
            sortedNamespaces.sort((a, b) => b.podCount - a.podCount);
            break;
        case 'cpu':
            sortedNamespaces.sort((a, b) => b.resources.cpu - a.resources.cpu);
            break;
        case 'gpu':
            sortedNamespaces.sort((a, b) => b.resources.gpu - a.resources.gpu);
            break;
        case 'memory':
            sortedNamespaces.sort((a, b) => b.resources.memory - a.resources.memory);
            break;
        default:
            break;
    }
    
    renderNamespaces(sortedNamespaces);
}

// Show message when no namespaces are found
function showNoNamespaces(message = 'No namespaces found') {
    $('#namespacesTableCard').hide();
    $('#noNamespacesMessage').show();
    $('#noNamespacesMessage h5').text(message);
}

// Get namespace creation time
function getCreationTime(namespace) {
    if (namespace.metadata && namespace.metadata.creationTimestamp) {
        const date = new Date(namespace.metadata.creationTimestamp);
        return `Created ${date.toLocaleDateString()}`;
    }
    return '';
}

// Get namespace status
function getNamespaceStatus(namespace) {
    if (namespace.metadata && namespace.metadata.status && namespace.metadata.status.phase) {
        const phase = namespace.metadata.status.phase;
        switch (phase) {
            case 'Active':
                return { text: 'Active', color: 'success' };
            case 'Terminating':
                return { text: 'Terminating', color: 'warning' };
            default:
                return { text: phase, color: 'secondary' };
        }
    }
    // Default to active if status not found
    return { text: 'Active', color: 'success' };
}

// Open namespace modal with specified tab
function openNamespaceModal(namespace, initialTab = 'events') {
    // Set current namespace name
    $('#currentNamespaceName').text(namespace);
    $('#deleteNamespaceConfirmName').text(namespace);
    
    // Reset delete confirmation input
    $('#namespaceDeleteConfirm').val('');
    $('#confirmNamespaceDelete').prop('disabled', true);
    
    // Show loading indicators and hide content
    $('#namespaceEventsLoading').show();
    $('#namespaceEventsOutput').hide();
    $('#namespaceDescribeLoading').show();
    $('#namespaceDescribeOutput').hide();
    $('#namespaceEditLoading').show();
    $('#namespaceEditContent').hide();
    $('#saveNamespaceChanges').hide();
    
    // Activate the correct tab
    $(`#${initialTab}-tab`).tab('show');
    
    // Show the modal
    $('#namespaceEditModal').modal('show');
    
    // Load the data for each tab
    loadNamespaceEvents(namespace);
    loadNamespaceDescribe(namespace);
    loadNamespaceEdit(namespace);
}

// Load namespace events data
function loadNamespaceEvents(namespace) {
    $.ajax({
        url: '/api/namespace/events',
        type: 'POST',
        data: { namespace: namespace },
        success: function(response) {
            if (response.hasOwnProperty('output')) {
                $('#namespaceEventsOutput').text(response.output);
                $('#namespaceEventsOutput').show();
            } else {
                $('#namespaceEventsOutput').text('Error: ' + response.error);
                $('#namespaceEventsOutput').show();
            }
        },
        error: function() {
            $('#namespaceEventsOutput').text('Failed to fetch namespace events');
            $('#namespaceEventsOutput').show();
        },
        complete: function() {
            $('#namespaceEventsLoading').hide();
        }
    });
}

// Load namespace describe data
function loadNamespaceDescribe(namespace) {
    $.ajax({
        url: '/api/namespace/describe',
        type: 'POST',
        data: { namespace: namespace },
        success: function(response) {
            if (response.hasOwnProperty('output')) {
                $('#namespaceDescribeOutput').text(response.output);
                $('#namespaceDescribeOutput').show();
            } else {
                $('#namespaceDescribeOutput').text('Error: ' + response.error);
                $('#namespaceDescribeOutput').show();
            }
        },
        error: function() {
            $('#namespaceDescribeOutput').text('Failed to fetch namespace description');
            $('#namespaceDescribeOutput').show();
        },
        complete: function() {
            $('#namespaceDescribeLoading').hide();
        }
    });
}

// Delete namespace
function deleteNamespace() {
    const namespace = $('#currentNamespaceName').text();
    
    // Show confirmation dialog
    if (!confirm(`Are you ABSOLUTELY SURE you want to delete the namespace "${namespace}" and ALL resources within it? This action CANNOT be undone!`)) {
        return;
    }
    
    // Disable the delete button and show a loading message
    $('#confirmNamespaceDelete').prop('disabled', true);
    $('#confirmNamespaceDelete').html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Deleting...');
    
    $.ajax({
        url: '/api/namespace/delete',
        type: 'POST',
        data: { namespace: namespace },
        success: function(response) {
            if (response.hasOwnProperty('output')) {
                alert(`Namespace "${namespace}" has been deleted.`);
                // Close the modal and refresh the namespaces list
                $('#namespaceEditModal').modal('hide');
                loadNamespaces();
            } else {
                alert('Error: ' + response.error);
                // Re-enable the delete button
                $('#confirmNamespaceDelete').prop('disabled', false);
                $('#confirmNamespaceDelete').html('<i class="fas fa-trash-alt me-2"></i> Permanently Delete Namespace');
            }
        },
        error: function() {
            alert('Failed to delete namespace. Please try again.');
            // Re-enable the delete button
            $('#confirmNamespaceDelete').prop('disabled', false);
            $('#confirmNamespaceDelete').html('<i class="fas fa-trash-alt me-2"></i> Permanently Delete Namespace');
        }
    });
}

// Load namespace edit data
function loadNamespaceEdit(namespace) {
    $.ajax({
        url: '/api/namespace/edit',
        type: 'POST',
        data: { namespace: namespace },
        success: function(response) {
            if (response.hasOwnProperty('yaml')) {
                $('#namespaceYamlEditor').val(response.yaml);
                $('#namespaceEditContent').show();
            } else {
                $('#namespaceYamlEditor').val('Error: ' + response.error);
                $('#namespaceEditContent').show();
            }
        },
        error: function() {
            $('#namespaceYamlEditor').val('Failed to fetch namespace data for editing');
            $('#namespaceEditContent').show();
        },
        complete: function() {
            $('#namespaceEditLoading').hide();
        }
    });
}

// Save namespace changes
function saveNamespaceChanges() {
    const namespace = $('#currentNamespaceName').text();
    const yaml = $('#namespaceYamlEditor').val();
    
    // Show loading
    $('#namespaceEditContent').hide();
    $('#namespaceEditLoading').show();
    
    $.ajax({
        url: '/api/namespace/update',
        type: 'POST',
        data: { 
            namespace: namespace,
            yaml: yaml
        },
        success: function(response) {
            if (response.hasOwnProperty('output')) {
                // Show success message
                alert('Namespace updated successfully.');
                
                // Refresh the data
                loadNamespaceEdit(namespace);
                loadNamespaceDescribe(namespace);
                loadNamespaces();
            } else {
                alert('Error: ' + response.error);
                $('#namespaceEditContent').show();
            }
        },
        error: function() {
            alert('Failed to update namespace. Please try again.');
            $('#namespaceEditContent').show();
        },
        complete: function() {
            $('#namespaceEditLoading').hide();
        }
    });
}

// Dashboard Metrics Functions
function updateDashboardMetrics(pods) {
    console.log('Updating dashboard metrics with data from', pods.length, 'pods');
    
    // Count all pods
    const totalPods = pods.length;
    
    // Count pods by status (correctly accessing the status phase)
    const runningPods = pods.filter(pod => pod.status && pod.status.phase && pod.status.phase.toLowerCase() === 'running').length;
    const succeededPods = pods.filter(pod => pod.status && pod.status.phase && pod.status.phase.toLowerCase() === 'succeeded').length;
    const errorPods = pods.filter(pod => {
        if (!pod.status || !pod.status.phase) return false;
        const phase = pod.status.phase.toLowerCase();
        return phase === 'failed' || phase === 'error' || phase === 'unknown' || 
            // Check for container statuses with specific error conditions
            (pod.status.containerStatuses && pod.status.containerStatuses.some(status => 
                status.state && (
                    (status.state.waiting && ['crashloopbackoff', 'error', 'errimagepull', 'imagepullbackoff', 'createcontainererror'].includes(status.state.waiting.reason?.toLowerCase())) ||
                    (status.state.terminated && status.state.terminated.exitCode !== 0)
                )
            ));
    }).length;
    
    // Update the UI
    document.getElementById('totalPodsCount').textContent = totalPods;
    document.getElementById('runningPodsCount').textContent = runningPods;
    document.getElementById('succeededPodsCount').textContent = succeededPods;
    document.getElementById('errorPodsCount').textContent = errorPods;
    
    // Calculate and display CPU usage
    const totalCPURequest = pods.reduce((total, pod) => {
        // Get CPU from each container in the pod
        if (pod.spec && pod.spec.containers) {
            pod.spec.containers.forEach(container => {
                if (container.resources && container.resources.requests && container.resources.requests.cpu) {
                    const cpuRequest = container.resources.requests.cpu;
                    if (cpuRequest.endsWith('m')) {
                        // Convert millicpu to CPU
                        total += parseInt(cpuRequest.slice(0, -1)) / 1000;
                    } else {
                        // Direct CPU value
                        total += parseFloat(cpuRequest);
                    }
                }
            });
        }
        return total;
    }, 0);
    
    // For debugging
    console.log(`Total CPU request: ${totalCPURequest.toFixed(1)} cores`);
    console.log(`Cluster capacity: ${window.clusterCapacity ? window.clusterCapacity.cpu : 'unknown'} cores`);
    
    const cpuPercentage = window.clusterCapacity && window.clusterCapacity.cpu ? 
        Math.round((totalCPURequest / window.clusterCapacity.cpu) * 100) : 0;
    
    document.getElementById('totalCPUCount').textContent = totalCPURequest.toFixed(1);
    document.getElementById('totalCPUPercentage').textContent = cpuPercentage;
    
    // Update CPU progress bar
    const cpuProgressBar = document.getElementById('cpuProgressBar');
    if (cpuProgressBar) {
        cpuProgressBar.style.width = `${cpuPercentage}%`;
        
        // Update color based on usage
        if (cpuPercentage >= 90) {
            cpuProgressBar.style.background = 'linear-gradient(to right, #f5f5f5, #ff5a5a)';
        } else if (cpuPercentage >= 75) {
            cpuProgressBar.style.background = 'linear-gradient(to right, #f5f5f5, #ffb800)';
        } else {
            cpuProgressBar.style.background = 'linear-gradient(to right, #f5f5f5, #01a982)';
        }
    }
    
    // Count GPU resources
    const gpuPods = pods.filter(pod => {
        let hasGPU = false;
        if (pod.spec && pod.spec.containers) {
            pod.spec.containers.forEach(container => {
                if (container.resources && container.resources.requests) {
                    if (container.resources.requests['nvidia.com/gpu'] || container.resources.requests.gpu) {
                        hasGPU = true;
                    }
                }
            });
        }
        return hasGPU;
    });
    
    const totalGPURequest = gpuPods.reduce((total, pod) => {
        if (pod.spec && pod.spec.containers) {
            pod.spec.containers.forEach(container => {
                if (container.resources && container.resources.requests) {
                    if (container.resources.requests['nvidia.com/gpu']) {
                        total += parseInt(container.resources.requests['nvidia.com/gpu']);
                    } else if (container.resources.requests.gpu) {
                        total += parseInt(container.resources.requests.gpu);
                    }
                }
            });
        }
        return total;
    }, 0);
    
    // Set GPU count in the dashboard
    const gpuCountElement = document.getElementById('totalGPUCount');
    if (gpuCountElement) {
        gpuCountElement.textContent = totalGPURequest.toFixed(0);
    }
    
    // Store pods with GPU for filtering
    window.gpuPodNames = gpuPods.map(pod => `${pod.metadata.namespace}/${pod.metadata.name}`);
    // Also store the full pod objects for use in the filter function
    window.podsWithGPUs = gpuPods;
    
    // Reset GPU filter text based on state
    if (window.gpuFilterActive) {
        document.getElementById('gpuFilterStatus').innerHTML = `<span class="badge bg-success"><i class="fas fa-filter"></i> Filtered</span>`;
        document.getElementById('clearGPUFilter').style.display = 'inline-block';
    } else {
        document.getElementById('gpuFilterStatus').textContent = 'Click to filter';
        document.getElementById('clearGPUFilter').style.display = 'none';
    }
}

// GPU Filter Functionality
function initializeGPUFilter() {
    console.log('Initializing GPU filter');
    window.gpuFilterActive = false;
    
    // Add event listener to GPU card for filtering
    const gpuCard = document.getElementById('gpuCard');
    const clearFilter = document.getElementById('clearGPUFilter');
    
    if (gpuCard) {
        gpuCard.addEventListener('click', function(e) {
            // Don't trigger if clicking on the clear button
            if (e.target.closest('#clearGPUFilter')) {
                return;
            }
            
            window.gpuFilterActive = !window.gpuFilterActive;
            
            // Apply the filter
            applyGPUFilter();
            
            // Update UI to show filter state
            gpuCard.classList.toggle('filter-active', window.gpuFilterActive);
            
            if (window.gpuFilterActive) {
                document.getElementById('gpuFilterStatus').innerHTML = `<span class="badge bg-success"><i class="fas fa-filter"></i> Filtered</span>`;
                clearFilter.style.display = 'inline-block';
            } else {
                document.getElementById('gpuFilterStatus').textContent = 'Click to filter';
                clearFilter.style.display = 'none';
            }
        });
    }
    
    if (clearFilter) {
        clearFilter.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevent triggering the card click
            
            window.gpuFilterActive = false;
            
            // Clear the filter
            applyGPUFilter();
            
            // Update UI
            gpuCard.classList.remove('filter-active');
            document.getElementById('gpuFilterStatus').textContent = 'Click to filter';
            clearFilter.style.display = 'none';
        });
    }
}

// Fix the GPU filter functionality
function applyGPUFilter() {
    const resourceType = 'pods'; // We only filter pods for GPU
    
    // Get the current items
    const allItems = window.app.cache.resources?.[resourceType]?.data?.items || 
                   window.app.state.resources?.[resourceType]?.items || [];
    
    // Filter to only show pods with GPU requests
    const filteredItems = allItems.filter(item => {
        const resources = getResourceUsage(item);
        return resources.gpu && resources.gpu !== '0';
    });
    
    // Update state with filtered items and reset to first page
    window.app.state.resources[resourceType] = {
        items: filteredItems,
        currentPage: 1,
        pageSize: 10
    };
    
    // Render the filtered items
    renderCurrentPage(resourceType);
    
    // Add indicator that filter is active
    const tableContainer = document.getElementById(`${resourceType}TableContainer`);
    if (tableContainer) {
        // Remove existing filter indicator if any
        const existingIndicator = tableContainer.querySelector('.filter-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
        
        // Add filter indicator
        const indicator = document.createElement('div');
        indicator.className = 'filter-indicator alert alert-info d-flex align-items-center mb-3';
        indicator.innerHTML = `
            <i class="fas fa-filter me-2"></i>
            <div class="flex-grow-1">
                Showing only pods with GPU requests (${filteredItems.length} of ${allItems.length} pods)
            </div>
            <button class="btn btn-sm btn-outline-info ms-3" onclick="clearGPUFilter()">
                <i class="fas fa-times me-1"></i> Clear Filter
            </button>
        `;
        tableContainer.insertBefore(indicator, tableContainer.firstChild);
    }
    
    // Show no pods message if needed
    if (filteredItems.length === 0) {
        const tableBody = document.querySelector(`#${resourceType}Table tbody`);
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4">
                        <i class="fas fa-microchip me-2 text-muted"></i>
                        No pods with GPU requests found.
                        <button class="btn btn-sm btn-outline-secondary ms-3" onclick="clearGPUFilter()">
                            <i class="fas fa-times me-1"></i> Clear Filter
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}

// Update the clearGPUFilter function
function clearGPUFilter() {
    const resourceType = 'pods';
    
    // Restore all items from cache
    const allItems = window.app.cache.resources?.[resourceType]?.data?.items || [];
    
    // Update state
    window.app.state.resources[resourceType] = {
        items: allItems,
        currentPage: 1,
        pageSize: 10
    };
    
    // Render all items
    renderCurrentPage(resourceType);
    
    // Remove filter indicator if any
    const tableContainer = document.getElementById(`${resourceType}TableContainer`);
    if (tableContainer) {
        const indicator = tableContainer.querySelector('.filter-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
}

// Initialize namespace functionality separately to ensure it works regardless of jQuery load order
function initializeNamespaceFunctionality() {
    console.log('Initializing namespace functionality');
    // Initialize namespaces tab
    $(document).ready(function() {
        // Initialize namespaces tab
        $('a[data-bs-toggle="tab"][data-bs-target="#namespaces"]').on('shown.bs.tab', function (e) {
            loadNamespaces();
        });

        // Refresh namespaces button
        $('#refreshNamespaces').on('click', function() {
            loadNamespaces();
        });

        // Filter namespaces
        $('#namespaceSearchInput').on('keyup', function() {
            filterNamespaces();
        });

        // Sort namespaces
        $('.sort-option').on('click', function(e) {
            e.preventDefault();
            const sortOption = $(this).data('sort');
            sortNamespaces(sortOption);
        });
    });
}

// Add call to initialize namespace functionality in the main initialization
document.addEventListener('DOMContentLoaded', function() {
    // Wait a short moment to ensure jQuery is fully loaded
    setTimeout(initializeNamespaceFunctionality, 500);
});

// Load namespaces for the selector dropdown
function loadNamespacesForSelector(resourceType) {
    // Skip if namespaces are already loaded globally
    if (window.namespaces) {
        populateNamespaceSelector(resourceType, window.namespaces);
        return;
    }
    
    fetch('/get_namespaces')
        .then(response => response.json())
        .then(data => {
            if (data.namespaces) {
                // Cache namespaces globally
                window.namespaces = data.namespaces;
                populateNamespaceSelector(resourceType, data.namespaces);
                
                // Dispatch custom event when namespaces are loaded
                document.dispatchEvent(new CustomEvent('namespacesLoaded'));
            } else {
                console.error('Failed to load namespaces:', data.error);
            }
        })
        .catch(error => {
            console.error('Error loading namespaces:', error);
        });
}

// Populate namespace dropdown with options
function populateNamespaceSelector(resourceType, namespaces) {
    const selector = document.getElementById(`${resourceType}Namespace`);
    if (!selector) return;
    
    // Clear existing options, keeping only the "All Namespaces" option
    const allOption = selector.querySelector('option[value="all"]');
    selector.innerHTML = '';
    selector.appendChild(allOption);
    
    // Ensure namespaces is an array
    if (!namespaces) {
        console.warn(`No namespaces provided for ${resourceType}`);
        return;
    }
    
    // Convert to array if it's not already one
    const namespacesArray = Array.isArray(namespaces) ? namespaces : 
                           (typeof namespaces === 'object' ? Object.keys(namespaces) : []);
    
    // Add namespace options
    namespacesArray.forEach(ns => {
        const option = document.createElement('option');
        option.value = ns;
        option.textContent = ns;
        selector.appendChild(option);
    });
}

// Handle namespace selection change
function namespaceChanged(resourceType) {
    const selector = document.getElementById(`${resourceType}Namespace`);
    if (!selector) return;
    
    const selectedNamespace = selector.value;
    console.log(`Namespace changed to ${selectedNamespace} for ${resourceType}`);
    
    // Force refresh data with new namespace
    if (window.loadedResources) {
        delete window.loadedResources[resourceType];
    }
    
    fetchResourceData(resourceType, selectedNamespace);
}

function loadResourcesForTab(tabId) {
    console.log(`Loading resources for tab: ${tabId}`);

    // If we're loading for home tab, we need to figure out which resource tab is active
    if (tabId === 'home') {
        // Find the active resource tab
        const activeResourceTab = document.querySelector('#resourceTabs .nav-link.active');
        if (activeResourceTab) {
            const resourceTabId = activeResourceTab.id.replace('-tab', '');
            console.log(`Active resource tab on home: ${resourceTabId}`);
            
            // Get current namespace selection
            const namespaceSelector = document.getElementById(`${resourceTabId}Namespace`);
            const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
            
            // Check if we need to force reload (when returning from pod view)
            const returningFromPodView = sessionStorage.getItem('returning_from_pod_view') === 'true';
            if (returningFromPodView || !window.app.loadedResources || !window.app.loadedResources[resourceTabId]) {
                // Fetch resource data
                console.log(`Loading ${resourceTabId} data with namespace ${currentNamespace}`);
                fetchResourceData(resourceTabId, currentNamespace, false);
            }
        } else {
            // Default to pods if no tab is active
            console.log('No active resource tab found, defaulting to pods');
            fetchResourceData('pods', 'all', false);
        }
        
        // Also initialize GPU filter
        if (typeof initializeGPUFilter === 'function') {
            initializeGPUFilter();
        }
        
        // Also initialize other home page functionality
        setupTabClickHandlers();
    } else if (tabId === 'namespaces') {
        // Load namespaces data
        if (typeof loadNamespaces === 'function') {
            loadNamespaces();
        }
    } else if (tabId === 'cli') {
        // Make sure terminal is initialized
        if (typeof initializeTerminal === 'function') {
            initializeTerminal();
        }
    } else if (tabId === 'yaml') {
        // Setup drop zone for YAML uploads
        if (typeof setupDropZone === 'function') {
            setupDropZone();
        }
    } else if (tabId === 'settings') {
        // Check git availability for settings page
        if (typeof checkGitAvailability === 'function') {
            checkGitAvailability();
        }
    } else if (tabId === 'charts') {
        // Load charts data
        if (typeof listCharts === 'function') {
            listCharts();
        }
    }
}

// Initialize app object if not exists
window.app = window.app || {};

// Add the missing getRelativeUrl function
window.app.getRelativeUrl = function(path) {
    // Remove leading slash if present to avoid double slashes
    if (path.startsWith('/')) {
        path = path.substring(1);
    }
    
    // Get the base URL from the current location
    const baseUrl = window.location.pathname.endsWith('/') 
        ? window.location.pathname 
        : window.location.pathname + '/';
        
    // Join the base URL and the path
    return baseUrl === '/' ? '/' + path : baseUrl + path;
};

// Set up initial state for app if not initialized
if (!window.app.state) {
    window.app.state = {
        resources: {},
        lastFetch: {},
        errors: {},
        activeRequests: new Map(),
        filters: {
            gpu: false,
            namespace: 'all'
        },
        navigation: {
            isNavigating: false,
            activeTab: 'home'
        }
    };
}

// Cache timeout - 5 minutes
window.app.CACHE_TIMEOUT = window.app.CACHE_TIMEOUT || 5 * 60 * 1000;

// Add cache management at the top of the file
window.app.cache = {
    resources: {},
    timestamps: {},
    STALE_THRESHOLD: 2 * 60 * 1000 // 2 minutes in milliseconds
};

// Add refresh alert container after loading container
function addRefreshAlert(resourceType) {
    const container = document.getElementById(`${resourceType}TableContainer`);
    if (!container) return;

    // Remove existing alert if any
    const existingAlert = container.querySelector('.refresh-alert');
    if (existingAlert) {
        existingAlert.remove();
    }

    const alert = document.createElement('div');
    alert.className = 'refresh-alert alert alert-warning d-flex align-items-center mb-3';
    alert.style.display = 'none';
    alert.innerHTML = `
        <i class="fas fa-exclamation-circle me-2"></i>
        <div class="flex-grow-1">
            This data is more than 2 minutes old and may be outdated.
        </div>
        <button class="btn btn-sm btn-warning ms-3" onclick="fetchResourceData('${resourceType}', 'all', false)">
            <i class="fas fa-sync-alt me-1"></i> Refresh Now
        </button>
    `;
    container.insertBefore(alert, container.firstChild);
    return alert;
}

// Add a function to check data freshness periodically
function startDataFreshnessChecker() {
    setInterval(() => {
        const activeTab = document.querySelector('#resourceTabs .nav-link.active');
        if (activeTab) {
            const resourceType = activeTab.getAttribute('data-bs-target').replace('#', '');
            const currentNamespace = document.getElementById(`${resourceType}Namespace`)?.value || 'all';
            const cacheKey = `${resourceType}-${currentNamespace}-full`;
            const lastFetch = window.app.state.lastFetch[cacheKey];
            
            if (lastFetch) {
                const timeSinceLastFetch = Date.now() - lastFetch;
                if (timeSinceLastFetch >= window.app.cache.STALE_THRESHOLD) {
                    const alert = addRefreshAlert(resourceType);
                    if (alert) {
                        alert.style.display = 'flex';
                    }
                }
            }
        }
    }, 30000); // Check every 30 seconds
}

// Initialize the freshness checker when the document is ready
document.addEventListener('DOMContentLoaded', () => {
    startDataFreshnessChecker();
});

// Add sorting functionality to resource tables
function addSortingToResourceTable(resourceType) {
    // Get the table headers
    const tableHeaders = document.querySelectorAll(`#${resourceType}Table thead th[data-sort]`);
    
    // If no sortable headers, return early
    if (!tableHeaders || tableHeaders.length === 0) {
        return;
    }
    
    // Add click listeners to sortable headers
    tableHeaders.forEach(header => {
        // Remove existing event listeners by cloning
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
        
        // Add sort indicators if not already present
        if (!newHeader.querySelector('.sort-indicator')) {
            const sortIndicator = document.createElement('span');
            sortIndicator.className = 'sort-indicator ms-1';
            sortIndicator.innerHTML = '<i class="fas fa-sort text-muted"></i>';
            newHeader.appendChild(sortIndicator);
        }
        
        // Add click event listener
        newHeader.addEventListener('click', () => {
            // Get sort field and current direction
            const sortField = newHeader.getAttribute('data-sort');
            let sortDirection = 'asc';
            
            // Toggle sort direction if already sorted by this field
            if (window.app.state.resources[resourceType].sortField === sortField) {
                sortDirection = window.app.state.resources[resourceType].sortDirection === 'asc' ? 'desc' : 'asc';
            }
            
            // Update sort indicators for all headers
            tableHeaders.forEach(h => {
                const indicator = h.querySelector('.sort-indicator');
                if (indicator) {
                    indicator.innerHTML = '<i class="fas fa-sort text-muted"></i>';
                }
            });
            
            // Update indicator for this header
            const indicator = newHeader.querySelector('.sort-indicator');
            if (indicator) {
                indicator.innerHTML = sortDirection === 'asc' 
                    ? '<i class="fas fa-sort-up text-primary"></i>' 
                    : '<i class="fas fa-sort-down text-primary"></i>';
            }
            
            // Save sort settings
            window.app.state.resources[resourceType].sortField = sortField;
            window.app.state.resources[resourceType].sortDirection = sortDirection;
            
            // Sort the data
            sortResourceData(resourceType, sortField, sortDirection);
            
            // Re-render the current page
    renderCurrentPage(resourceType);
        });
    });
}

// Helper function to sort resource data
function sortResourceData(resourceType, sortField, sortDirection) {
    const resources = window.app.state.resources[resourceType];
    if (!resources || !resources.items || !resources.items.length) {
        return;
    }
    
    resources.items.sort((a, b) => {
        let valueA, valueB;
        
        // Extract values based on sort field
        switch(sortField) {
            case 'name':
                valueA = a.metadata?.name || '';
                valueB = b.metadata?.name || '';
                break;
            case 'namespace':
                valueA = a.metadata?.namespace || '';
                valueB = b.metadata?.namespace || '';
                break;
            case 'status':
                valueA = a.status?.phase || '';
                valueB = b.status?.phase || '';
                break;
            case 'cpu':
                valueA = parseFloat(getResourceUsage(a).cpu) || 0;
                valueB = parseFloat(getResourceUsage(b).cpu) || 0;
                break;
            case 'memory':
                // Extract numeric value from memory string
                const memA = getResourceUsage(a).memory || '0Mi';
                const memB = getResourceUsage(b).memory || '0Mi';
                valueA = parseFloat(memA.replace(/[^0-9.]/g, '')) || 0;
                valueB = parseFloat(memB.replace(/[^0-9.]/g, '')) || 0;
                break;
            case 'gpu':
                valueA = parseInt(getResourceUsage(a).gpu) || 0;
                valueB = parseInt(getResourceUsage(b).gpu) || 0;
                break;
            case 'age':
                valueA = new Date(a.metadata?.creationTimestamp || 0).getTime();
                valueB = new Date(b.metadata?.creationTimestamp || 0).getTime();
                break;
            default:
                valueA = '';
                valueB = '';
        }
        
        // Perform comparison based on type
        let result;
        if (typeof valueA === 'number' && typeof valueB === 'number') {
            // Numeric comparison
            result = valueA - valueB;
        } else {
            // String comparison
            valueA = String(valueA).toLowerCase();
            valueB = String(valueB).toLowerCase();
            result = valueA.localeCompare(valueB);
        }
        
        // Apply sort direction
        return sortDirection === 'asc' ? result : -result;
    });
}