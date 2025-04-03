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

// Home page specific initialization
function initializeHomePage() {
    console.log('Initializing home page components...');
    
    // Initialize GPU filter card
    initializeGPUFilter();
    
    // Initialize GPU Dashboard tables
    initializeGpuDashboard();
    
    // Add controls to each resource tab
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    resourceTypes.forEach(resourceType => {
        addResourceControls(resourceType);
        
        // Set up tab click handlers to load data on demand
        const tabElement = document.querySelector(`#${resourceType}-tab`);
        if (tabElement) {
            tabElement.addEventListener('click', () => {
                // Always fetch fresh data when tab is clicked
                console.log(`Tab ${resourceType} clicked, fetching fresh data...`);
                
                // Get current namespace selection
                const namespaceSelector = document.getElementById(`${resourceType}Namespace`);
                const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
                
                // Force fetch by clearing the cached state
                if (window.loadedResources) {
                    delete window.loadedResources[resourceType];
                }
                
                fetchResourceData(resourceType, currentNamespace);
            });
        }
    });
    
    // Load the active tab content
    const activeTabId = document.querySelector('.tab-pane.active')?.id;
    if (activeTabId && resourceTypes.includes(activeTabId)) {
        // Get the namespace for this tab
        const namespaceSelector = document.getElementById(`${activeTabId}Namespace`);
        const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
        
        fetchResourceData(activeTabId, currentNamespace);
    } else {
        // If no tab is active, load pods as default
        fetchResourceData('pods', 'all');
    }
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
            
            // Store terminal in global state
            window.app.terminal = terminal;
            
            // Open terminal
            terminal.open(document.getElementById('terminal'));
            
            // Setup command input handling
            let currentLine = '';
            let commandHistory = [];
            let historyIndex = -1;
            
            // Initial prompt
            terminal.writeln('Welcome to the Kubernetes CLI.');
            terminal.writeln('Type commands directly in this window and press Enter to execute.');
            terminal.writeln('');
            terminal.write('$ ');
            
            // Handle user input
            terminal.onKey(({ key, domEvent }) => {
                const printable = !domEvent.altKey && !domEvent.altGraphKey && !domEvent.ctrlKey && !domEvent.metaKey;
                
                // Handle special keys
                if (domEvent.keyCode === 13) { // Enter key
                    // Send command to server
                    if (currentLine.trim()) {
                        // Add to history
                        commandHistory.push(currentLine);
                        historyIndex = commandHistory.length;
                        
                        // Execute command via REST API
                        executeCliCommand(currentLine);
                        
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
                } else if (printable) {
                    // Regular printable character
                    currentLine += key;
                    terminal.write(key);
                }
            });
            
            console.log('Terminal initialized successfully with REST mode');
        } catch (error) {
            console.error('Failed to initialize terminal:', error);
            const terminalElement = document.getElementById('terminal');
            terminalElement.innerHTML = '<div class="alert alert-danger">Failed to initialize terminal: ' + error.message + '</div>';
        }
    }
}

// Function to execute commands via REST API
function executeCliCommand(command) {
    if (!command) return;
    
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

// Socket event listeners
function connectSocketListeners() {
    const socket = window.app.socket;
    if (!socket) {
        console.warn('Socket not available for event listeners');
        return;
    }
    
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
    const { items, currentPage, pageSize } = window.app.state.resources[resourceType] || {};
    if (!items) return;

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageItems = items.slice(startIndex, endIndex);

    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (!tableBody) return;

    // Clear existing rows
    tableBody.innerHTML = '';

    // Update pagination info
    const totalItems = document.querySelector(`#${resourceType}TableContainer .total-items`);
    const currentPageSpan = document.querySelector(`#${resourceType}TableContainer .current-page`);
    const pageSizeSpan = document.querySelector(`#${resourceType}TableContainer .page-size`);
    const prevButton = document.querySelector(`#${resourceType}TableContainer .prev-page`);
    const nextButton = document.querySelector(`#${resourceType}TableContainer .next-page`);

    if (totalItems) totalItems.textContent = items.length;
    if (currentPageSpan) currentPageSpan.textContent = startIndex + 1;
    if (pageSizeSpan) pageSizeSpan.textContent = Math.min(endIndex, items.length);
    if (prevButton) prevButton.disabled = currentPage === 1;
    if (nextButton) nextButton.disabled = endIndex >= items.length;

    // Render current page items
    pageItems.forEach(item => {
        const row = document.createElement('tr');
        switch (resourceType) {
            case 'pods':
                const resources = getResourceUsage(item);
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${getStatusIcon(item.status.phase)}${item.status.phase}</td>
                    <td class="resource-cell cpu-cell"><i class="fas fa-microchip me-1"></i>${resources.cpu || '0'}</td>
                    <td class="resource-cell gpu-cell"><i class="fas fa-tachometer-alt me-1"></i>${resources.gpu || '0'}</td>
                    <td class="resource-cell memory-cell"><i class="fas fa-memory me-1"></i>${resources.memory || '0Mi'}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
            case 'services':
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${item.spec.type}</td>
                    <td>${item.spec.clusterIP}</td>
                    <td>${item.spec.externalIP || 'N/A'}</td>
                    <td>${item.spec.ports.map(port => `${port.port}/${port.protocol}`).join(', ')}</td>
                    <td>${new Date(item.metadata.creationTimestamp).toLocaleString()}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
            case 'inferenceservices':
                // For InferenceServices, get resources from spec.predictor
                let infResources = { cpu: '0', gpu: '0', memory: '0Mi' };
                if (item.spec && item.spec.predictor) {
                    if (item.spec.predictor.tensorflow || item.spec.predictor.triton || 
                        item.spec.predictor.pytorch || item.spec.predictor.sklearn || 
                        item.spec.predictor.xgboost || item.spec.predictor.custom) {
                        // Get the appropriate predictor implementation
                        const predictorImpl = item.spec.predictor.tensorflow || item.spec.predictor.triton || 
                                             item.spec.predictor.pytorch || item.spec.predictor.sklearn || 
                                             item.spec.predictor.xgboost || item.spec.predictor.custom;
                        
                        if (predictorImpl.resources) {
                            if (predictorImpl.resources.requests) {
                                // CPU
                                if (predictorImpl.resources.requests.cpu) {
                                    const cpuReq = predictorImpl.resources.requests.cpu;
                                    if (cpuReq.endsWith('m')) {
                                        infResources.cpu = (parseInt(cpuReq.slice(0, -1)) / 1000).toFixed(2);
        } else {
                                        infResources.cpu = parseFloat(cpuReq).toFixed(2);
                                    }
                                }
                                
                                // GPU
                                if (predictorImpl.resources.requests['nvidia.com/gpu']) {
                                    infResources.gpu = predictorImpl.resources.requests['nvidia.com/gpu'];
                                } else if (predictorImpl.resources.requests.gpu) {
                                    infResources.gpu = predictorImpl.resources.requests.gpu;
                                }
                                
                                // Memory
                                if (predictorImpl.resources.requests.memory) {
                                    infResources.memory = predictorImpl.resources.requests.memory;
                                }
                            }
                        }
                    }
                }
                
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${item.status.url || 'N/A'}</td>
                    <td>${getStatusIcon(item.status.conditions[0].status)}${item.status.conditions[0].status}</td>
                    <td class="resource-cell cpu-cell"><i class="fas fa-microchip me-1"></i>${infResources.cpu}</td>
                    <td class="resource-cell gpu-cell"><i class="fas fa-tachometer-alt me-1"></i>${infResources.gpu}</td>
                    <td class="resource-cell memory-cell"><i class="fas fa-memory me-1"></i>${infResources.memory}</td>
                    <td>${item.status.traffic ? item.status.traffic[0].percent : 'N/A'}</td>
                    <td>${item.status.traffic && item.status.traffic.length > 1 ? item.status.traffic[1].percent : 'N/A'}</td>
                    <td>${new Date(item.metadata.creationTimestamp).toLocaleString()}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
            case 'deployments':
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${item.status.readyReplicas || 0}/${item.status.replicas}</td>
                    <td>${item.status.updatedReplicas}</td>
                    <td>${item.status.availableReplicas}</td>
                    <td>${new Date(item.metadata.creationTimestamp).toLocaleString()}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
            case 'configmaps':
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${Object.keys(item.data || {}).length}</td>
                    <td>${new Date(item.metadata.creationTimestamp).toLocaleString()}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
            case 'secrets':
                row.innerHTML = `
                    <td>${item.metadata.namespace}</td>
                    <td>${item.metadata.name}</td>
                    <td>${item.type}</td>
                    <td>${Object.keys(item.data || {}).length}</td>
                    <td>${new Date(item.metadata.creationTimestamp).toLocaleString()}</td>
                    <td>${createActionButton(resourceType, item.metadata.namespace, item.metadata.name)}</td>
                `;
                break;
        }
        
        tableBody.appendChild(row);
    });
}

// Resource data fetching (for individual tab clicks or refresh button)
function fetchResourceData(resourceType, namespace, criticalOnly = false) {
    console.log(`Fetching ${resourceType} data (${criticalOnly ? 'critical' : 'full'})...`);
    const startTime = performance.now();
    
    // Cancel any existing request for this resource type
    if (window.app.state.activeRequests && window.app.state.activeRequests.has(resourceType)) {
        window.app.state.activeRequests.get(resourceType).abort();
        window.app.state.activeRequests.delete(resourceType);
    }
    
    // Initialize the activeRequests Map if it doesn't exist
    if (!window.app.state.activeRequests) {
        window.app.state.activeRequests = new Map();
    }
    
    // Initialize resources object if it doesn't exist
    if (!window.app.state.resources) {
        window.app.state.resources = {};
    }
    
    // Initialize lastFetch object if it doesn't exist
    if (!window.app.state.lastFetch) {
        window.app.state.lastFetch = {};
    }
    
    // Initialize the app's CACHE_TIMEOUT if it doesn't exist
    if (!window.app.CACHE_TIMEOUT) {
        window.app.CACHE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    }
    
    // Track when the user left the dashboard 
    const navigatingBack = window.app.state.navigation && 
                           window.app.state.navigation.isNavigating === false && 
                           window.location.pathname === '/';
    
    // Force fresh data when returning to the dashboard
    if (navigatingBack) {
        console.log("Returning to dashboard - forcing fresh data fetch");
        delete window.app.state.resources[resourceType];
        delete window.app.state.lastFetch[resourceType];
    }
    
    // For critical-only loads, don't use cache unless explicitly returning to dashboard
    if (!criticalOnly && !navigatingBack) {
        // Check cache first
        const cachedData = window.app.state.resources[resourceType];
        const lastFetch = window.app.state.lastFetch[resourceType];
        if (cachedData && lastFetch && (Date.now() - lastFetch < window.app.CACHE_TIMEOUT)) {
            console.log(`Using cached data for ${resourceType}`);
            return Promise.resolve(processResourceData(resourceType, cachedData, startTime));
        }
    }
    
    // Show loading indicator
    showLoading(resourceType);
    
    // Create new abort controller
    const controller = new AbortController();
    window.app.state.activeRequests.set(resourceType, controller);
    
    // Prepare form data
    const formData = new FormData();
    formData.append('resource_type', resourceType);
    formData.append('critical_only', criticalOnly);
    if (namespace && namespace !== 'all') {
        formData.append('namespace', namespace);
    }
    
    // Advance to connecting step
    setTimeout(() => advanceLoadingStep(resourceType), 800);
    
    // Track when we start processing the response
    let processingStartTime;
    
    function fetchWithRetry(attempt = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAY = 1000;
        
        return fetch('/get_resources', {
            method: 'POST',
            body: formData,
            signal: controller.signal
        })
        .then(response => {
            processingStartTime = performance.now();
            // Advance to processing step
            advanceLoadingStep(resourceType);
            return response.json();
        })
        .then(data => {
            if (!data || !data.data || !data.data.items) {
                throw new Error('Invalid response format');
            }
            
            // Advance to metrics calculation step
            advanceLoadingStep(resourceType);
            
            // Cache the successful response
            window.app.state.resources[resourceType] = data;
            window.app.state.lastFetch[resourceType] = Date.now();
            
            // Mark as loaded
            if (!window.app.loadedResources) {
                window.app.loadedResources = {};
            }
            window.app.loadedResources[resourceType] = true;
            
            // Advance to preparing display step
            setTimeout(() => advanceLoadingStep(resourceType), 500);
            
            // Process the data
            setTimeout(() => {
                processResourceData(resourceType, data, startTime, processingStartTime);
            }, 800);
            
            return data;
        })
        .catch(error => {
            if (error.name === 'AbortError') {
                console.log(`Request for ${resourceType} was cancelled`);
                return;
            }
            
            // Store error state
            window.app.state.errors[resourceType] = error;
            
            // Retry logic
            if (attempt < MAX_RETRIES) {
                console.log(`Retrying ${resourceType} fetch attempt ${attempt + 1}...`);
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(fetchWithRetry(attempt + 1));
                    }, RETRY_DELAY * Math.pow(2, attempt));
                });
            }
            
            // Show error in UI after all retries failed
            const tableBody = document.querySelector(`#${resourceType}Table tbody`);
            if (tableBody) {
                // Hide loading indicator with error
                hideLoading(resourceType);
                
                // Show error in table
                const tableContainer = document.getElementById(`${resourceType}TableContainer`);
                if (tableContainer) {
                    tableContainer.style.opacity = '1';
                    tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Failed to load ${resourceType} after multiple attempts. 
                        <button onclick="fetchResourceData('${resourceType}')" class="btn btn-sm btn-outline-danger ms-3">
                            <i class="fas fa-sync-alt me-1"></i> Retry
                        </button>
                    </td></tr>`;
                }
            }
            
            throw error;
        })
        .finally(() => {
            if (window.app.state.activeRequests) {
                window.app.state.activeRequests.delete(resourceType);
            }
        });
    }
    
    return fetchWithRetry();
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
    }
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
    
    if (tableContainer) {
        setTimeout(() => {
            tableContainer.style.opacity = '1';
        }, 100);
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
                    <li><a class="dropdown-item explore-pod-link" href="/explore/${namespace}/${name}" data-namespace="${namespace}" data-pod-name="${name}">
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

// CLI command execution - no longer needed as we type directly in terminal
function runCliCommand() {
    // For backward compatibility with any buttons that might still call this
    const command = document.getElementById('cliCommand');
    
    if (command && command.value) {
        const cmd = command.value.trim();
        if (cmd) {
            // Use the new function instead of socket
            executeCliCommand(cmd);
            command.value = '';
        }
    }
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

// GitHub update function
function updateFromGithub() {
    const repoUrl = document.getElementById('githubRepo').value;
    const statusDiv = document.getElementById('updateStatus');
    
    if (!statusDiv) return;
    
    statusDiv.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div> Updating from GitHub...';
    
    // First update from GitHub
    fetch('/update_from_github', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            repo_url: repoUrl
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            statusDiv.innerHTML = 'Update successful. Initiating application restart...';
            
            // Then restart the application
            fetch('/restart', {
                method: 'POST'
            })
            .then(response => {
                if (response.ok) {
                    return response.json();
                } else {
                    // If the server is already restarting, we might get an error response
                    // This is normal, so handle it gracefully
                    statusDiv.innerHTML = 'Application is restarting. Waiting for it to come back online...';
                    waitForApplicationRestart(statusDiv);
                    throw new Error('restart_in_progress');
                }
            })
            .then(data => {
                if (data.status === 'success') {
                    statusDiv.innerHTML = 'Application restart initiated. Waiting for application to come back online...';
                    waitForApplicationRestart(statusDiv);
                }
            })
            .catch(error => {
                if (error.message !== 'restart_in_progress') {
                    console.error('Error during restart:', error);
                    statusDiv.innerHTML = `<div class="alert alert-warning">Restart initiated, but couldn't confirm status. Will try to reconnect.</div>`;
                    waitForApplicationRestart(statusDiv);
                }
            });
        } else {
            statusDiv.innerHTML = `<div class="alert alert-danger">Error: ${data.message}</div>`;
            throw new Error(data.message);
        }
    })
    .catch(error => {
        if (error.message !== 'restart_in_progress') {
            console.error('Error:', error);
            if (statusDiv && !statusDiv.innerHTML.includes('alert-danger')) {
                statusDiv.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
            }
        }
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
            repo_url: document.getElementById('githubRepo').value || undefined  // Only send if user provided a value
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
    // Set up click handlers for main tabs to manage loading states
    document.querySelectorAll('a[data-bs-toggle="tab"]').forEach(tabButton => {
        tabButton.addEventListener('click', function(e) {
            const targetTabId = e.target.getAttribute('data-bs-target').substring(1);
            console.log(`Tab clicked: ${targetTabId}`);
            
            // If navigating to a tab that needs data loading
            if (targetTabId === 'home') {
                if (typeof initializeHomePage === 'function') {
                    setTimeout(() => {
                        initializeHomePage();
                    }, 100);
                }
            } else if (targetTabId === 'namespaces') {
                loadNamespaces();
            } else if (targetTabId === 'cli') {
                setTimeout(() => {
                    if (window.app.terminal) {
                        window.app.terminal.focus();
                    }
                }, 100);
            } else if (targetTabId === 'resources') {
                if (typeof initializeResourcesPage === 'function') {
                    setTimeout(() => {
                        initializeResourcesPage();
                    }, 100);
                }
            }
        });
    });
    
    // Add event listeners for tab switching on home page to update URL
    const homeTabs = document.querySelectorAll('#resourceTabs button[data-bs-toggle="tab"]');
    homeTabs.forEach(tab => {
        tab.addEventListener('shown.bs.tab', function(e) {
            const targetTabId = e.target.getAttribute('data-bs-target').substring(1);
            console.log(`Home page resource tab changed to: ${targetTabId}`);
            
            // Set global state for active resource tab
            if (!window.app.state) window.app.state = {};
            window.app.state.activeResourceTab = targetTabId;
        });
    });
    
    // Add event listeners for tab switching on resources page
    const resourcesTabs = document.querySelectorAll('#resourcesTabTabs button[data-bs-toggle="tab"]');
    resourcesTabs.forEach(tab => {
        tab.addEventListener('shown.bs.tab', function(e) {
            const targetTabId = e.target.getAttribute('data-bs-target').substring(1);
            console.log(`Resources page tab changed to: ${targetTabId}`);
            
            // Set global state for active resources tab
            if (!window.app.state) window.app.state = {};
            window.app.state.activeResourcesTab = targetTabId;
        });
    });
}

// Helper function to calculate resource usage
function getResourceUsage(item) {
    let cpu = 0;
    let gpu = 0;

// Modify the filterResources function to work with load more approach
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

// Add function to clear search
function clearSearch(resourceType) {
    const searchInput = document.getElementById(`${resourceType}SearchInput`);
    searchInput.value = '';
    filterResources(resourceType);
}

// Add sortResources function to enable sorting on the main tables
function sortResources(resourceType, sortField) {
    // Get the current items
    const items = window.app.state.resources[resourceType]?.items || [];
    
    // Check if we're reversing the current sort
    let sortDirection = 'asc';
    if (window.app.state.resources[resourceType]?.sortField === sortField) {
        sortDirection = window.app.state.resources[resourceType]?.sortDirection === 'asc' ? 'desc' : 'asc';
    }
    
    // Sort the items
    const sortedItems = [...items].sort((a, b) => {
        let valueA, valueB;
        
        // Get the values based on field
        switch (sortField) {
            case 'name':
                valueA = a.metadata.name;
                valueB = b.metadata.name;
                break;
            case 'namespace':
                valueA = a.metadata.namespace;
                valueB = b.metadata.namespace;
                break;
            case 'status':
                valueA = a.status?.phase || '';
                valueB = b.status?.phase || '';
                break;
            case 'cpu':
                const resourcesA = getResourceUsage(a);
                const resourcesB = getResourceUsage(b);
                valueA = parseFloat(resourcesA.cpu || '0');
                valueB = parseFloat(resourcesB.cpu || '0');
                break;
            case 'gpu':
                const resourcesGpuA = getResourceUsage(a);
                const resourcesGpuB = getResourceUsage(b);
                valueA = parseFloat(resourcesGpuA.gpu || '0');
                valueB = parseFloat(resourcesGpuB.gpu || '0');
                break;
            case 'memory':
                const resourcesMemA = getResourceUsage(a);
                const resourcesMemB = getResourceUsage(b);
                // Convert memory to numeric value for comparison
                valueA = parseFloat(resourcesMemA.memory?.replace(/[^0-9.]/g, '') || '0');
                valueB = parseFloat(resourcesMemB.memory?.replace(/[^0-9.]/g, '') || '0');
                
                // Adjust for units
                if (resourcesMemA.memory?.includes('Gi')) valueA *= 1024;
                if (resourcesMemB.memory?.includes('Gi')) valueB *= 1024;
                break;
            default:
                valueA = a.metadata.name;
                valueB = b.metadata.name;
        }
        
        // Compare the values
        if (typeof valueA === 'number' && typeof valueB === 'number') {
            return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
        } else {
            const strA = String(valueA).toLowerCase();
            const strB = String(valueB).toLowerCase();
            return sortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        }
    });
    
    // Update state with sorted items
    window.app.state.resources[resourceType] = {
        ...window.app.state.resources[resourceType],
        items: sortedItems,
        sortField: sortField,
        sortDirection: sortDirection,
        currentPage: 1 // Reset to first page
    };
    
    // Update sort indicators in the table headers
    updateSortIndicators(resourceType, sortField, sortDirection);
    
    // Re-render the current page
    renderCurrentPage(resourceType);
}

// Add function to update sort indicators in table headers
function updateSortIndicators(resourceType, sortField, sortDirection) {
    // Remove all existing sort indicators
    const allHeaders = document.querySelectorAll(`#${resourceType}Table th`);
    allHeaders.forEach(header => {
        const icon = header.querySelector('i.sort-icon');
        if (icon) {
            icon.remove();
        }
        header.classList.remove('sorting-asc', 'sorting-desc');
    });
    
    // Find the header for the current sort field
    const header = document.querySelector(`#${resourceType}Table th[data-sort="${sortField}"]`);
    if (header) {
        // Add the appropriate sort indicator
        const icon = document.createElement('i');
        icon.className = `fas fa-sort-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 sort-icon`;
        header.appendChild(icon);
        header.classList.add(`sorting-${sortDirection}`);
    }
}

// Function to add sort functionality to table headers
function addSortingToResourceTable(resourceType) {
    const headers = document.querySelectorAll(`#${resourceType}Table th[data-sort]`);
    headers.forEach(header => {
        header.style.cursor = 'pointer';
        
        // Add click event listener
        header.addEventListener('click', () => {
            const sortField = header.getAttribute('data-sort');
            sortResources(resourceType, sortField);
        });
        
        // Add sort icon container if not already present
        if (!header.querySelector('.sort-icon')) {
            const text = header.textContent;
            header.innerHTML = `${text} <i class="sort-icon"></i>`;
        }
    });
}

// Initialize the GPU Dashboard with high GPU utilization namespaces and pods with GPUs
function initializeGpuDashboard() {
    console.log('Initializing GPU Dashboard...');
    
    // Set up refresh button
    const refreshButton = document.getElementById('refreshGPUDashboard');
    if (refreshButton) {
        refreshButton.addEventListener('click', function() {
            refreshGpuDashboard();
        });
    }
    
    // Initial load
    loadGpuDashboardData();
}

// Load data for both GPU dashboard tables
function loadGpuDashboardData() {
    // Load high GPU namespaces
    loadHighGpuNamespaces();
    
    // Load pods with GPUs
    loadPodsWithGpus();
}

// Refresh both tables
function refreshGpuDashboard() {
    // Show loading indicators
    document.getElementById('highGpuNamespacesTableBody').innerHTML = `
        <tr>
            <td colspan="4" class="text-center py-3 text-muted">
                <div class="spinner-border spinner-border-sm me-2" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                Refreshing namespaces...
            </td>
        </tr>
    `;
    
    document.getElementById('gpuPodsTableBody').innerHTML = `
        <tr>
            <td colspan="5" class="text-center py-3 text-muted">
                <div class="spinner-border spinner-border-sm me-2" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                Refreshing pods...
            </td>
        </tr>
    `;
    
    // Reload the data
    loadGpuDashboardData();
}

// Load and display namespaces with high GPU utilization
function loadHighGpuNamespaces() {
    fetch('/get_namespace_details')
        .then(response => response.json())
        .then(data => {
            if (data.namespaces) {
                // Filter namespaces with GPU usage > 0
                const gpuNamespaces = data.namespaces.filter(ns => ns.resources.gpu > 0);
                
                // Sort by GPU usage (highest first)
                gpuNamespaces.sort((a, b) => b.resources.gpu - a.resources.gpu);
                
                // Update count badge
                document.getElementById('highGpuNamespacesCount').textContent = gpuNamespaces.length;
                
                // Render namespaces table
                renderHighGpuNamespaces(gpuNamespaces);
            }
        })
        .catch(error => {
            console.error('Error fetching namespace details:', error);
            document.getElementById('highGpuNamespacesTableBody').innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-3 text-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Error loading namespace data
                    </td>
                </tr>
            `;
        });
}

// Render the high GPU utilization namespaces table
function renderHighGpuNamespaces(namespaces) {
    const tableBody = document.getElementById('highGpuNamespacesTableBody');
    
    // Clear table
    tableBody.innerHTML = '';
    
    if (namespaces.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-3 text-muted">
                    <i class="fas fa-info-circle me-2"></i>
                    No namespaces with GPU usage found
                </td>
            </tr>
        `;
        return;
    }
    
    // Add rows for each namespace
    namespaces.forEach(ns => {
        const row = document.createElement('tr');
        
        // Namespace name
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `<span class="fw-medium">${ns.name}</span>`;
        row.appendChild(nameCell);
        
        // Pod count
        const podCountCell = document.createElement('td');
        podCountCell.className = 'text-center';
        podCountCell.innerHTML = `<span class="badge bg-secondary">${ns.podCount}</span>`;
        row.appendChild(podCountCell);
        
        // GPU usage
        const gpuCell = document.createElement('td');
        gpuCell.className = 'text-center';
        
        // Use different colors based on usage
        let badgeClass = 'bg-success';
        if (ns.resources.gpu > 4) {
            badgeClass = 'bg-danger';
        } else if (ns.resources.gpu > 2) {
            badgeClass = 'bg-warning';
        }
        
        gpuCell.innerHTML = `<span class="badge ${badgeClass}">${ns.resources.gpu}</span>`;
        row.appendChild(gpuCell);
        
        // Actions
        const actionsCell = document.createElement('td');
        actionsCell.className = 'text-center';
        actionsCell.innerHTML = `
            <div class="btn-group btn-group-sm">
                <button type="button" class="btn btn-outline-primary" onclick="openNamespaceModal('${ns.name}')">
                    <i class="fas fa-info-circle"></i>
                </button>
                <button type="button" class="btn btn-outline-secondary" onclick="applyNamespaceFilter('${ns.name}')">
                    <i class="fas fa-filter"></i>
                </button>
            </div>
        `;
        row.appendChild(actionsCell);
        
        tableBody.appendChild(row);
    });
}

// Filter by namespace - function called from the namespace GPU table
function applyNamespaceFilter(namespace) {
    // Find all namespace selectors and set them to this namespace
    const selectors = document.querySelectorAll('select[id$="Namespace"]');
    selectors.forEach(selector => {
        if (selector.querySelector(`option[value="${namespace}"]`)) {
            selector.value = namespace;
            
            // Trigger change event to reload the data
            const event = new Event('change');
            selector.dispatchEvent(event);
        }
    });
    
    // Show a toast notification
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'info',
        title: `Filtered to namespace: ${namespace}`,
        showConfirmButton: false,
        timer: 3000
    });
}

// Load and display pods with GPUs assigned
function loadPodsWithGpus() {
    fetch('/get_resources', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'resource_type=pods'
    })
        .then(response => response.json())
        .then(data => {
            if (data.data && data.data.items) {
                // Filter pods with GPU requests
                const gpuPods = [];
                
                data.data.items.forEach(pod => {
                    let gpuCount = 0;
                    
                    // Check each container for GPU resources
                    if (pod.spec && pod.spec.containers) {
                        pod.spec.containers.forEach(container => {
                            if (container.resources) {
                                // Check for nvidia.com/gpu in both requests and limits
                                if (container.resources.requests && container.resources.requests['nvidia.com/gpu']) {
                                    gpuCount += parseFloat(container.resources.requests['nvidia.com/gpu']);
                                }
                                if (container.resources.limits && container.resources.limits['nvidia.com/gpu']) {
                                    // Use the larger value between requests and limits
                                    gpuCount = Math.max(gpuCount, parseFloat(container.resources.limits['nvidia.com/gpu']));
                                }
                            }
                        });
                    }
                    
                    if (gpuCount > 0) {
                        gpuPods.push({
                            name: pod.metadata.name,
                            namespace: pod.metadata.namespace,
                            gpuCount: gpuCount,
                            status: pod.status ? pod.status.phase : 'Unknown'
                        });
                    }
                });
                
                // Sort by GPU count (highest first)
                gpuPods.sort((a, b) => b.gpuCount - a.gpuCount);
                
                // Update count badge
                document.getElementById('gpuPodsCount').textContent = gpuPods.length;
                
                // Render pods table
                renderGpuPods(gpuPods);
            }
        })
        .catch(error => {
            console.error('Error fetching pods:', error);
            document.getElementById('gpuPodsTableBody').innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-3 text-danger">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Error loading pod data
                    </td>
                </tr>
            `;
        });
}

// Render the pods with GPUs table
function renderGpuPods(pods) {
    const tableBody = document.getElementById('gpuPodsTableBody');
    
    // Clear table
    tableBody.innerHTML = '';
    
    if (pods.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-3 text-muted">
                    <i class="fas fa-info-circle me-2"></i>
                    No pods with GPU resources found
                </td>
            </tr>
        `;
        return;
    }
    
    // Add rows for each pod
    pods.forEach(pod => {
        const row = document.createElement('tr');
        
        // Pod name
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `<span class="fw-medium">${pod.name}</span>`;
        row.appendChild(nameCell);
        
        // Namespace
        const namespaceCell = document.createElement('td');
        namespaceCell.innerHTML = pod.namespace;
        row.appendChild(namespaceCell);
        
        // GPU count
        const gpuCell = document.createElement('td');
        gpuCell.className = 'text-center';
        
        // Use different colors based on usage
        let badgeClass = 'bg-success';
        if (pod.gpuCount > 4) {
            badgeClass = 'bg-danger';
        } else if (pod.gpuCount > 2) {
            badgeClass = 'bg-warning';
        }
        
        gpuCell.innerHTML = `<span class="badge ${badgeClass}">${pod.gpuCount}</span>`;
        row.appendChild(gpuCell);
        
        // Status
        const statusCell = document.createElement('td');
        statusCell.className = 'text-center';
        
        let statusIcon, statusClass;
        switch (pod.status) {
            case 'Running':
                statusIcon = 'fa-check-circle';
                statusClass = 'text-success';
                break;
            case 'Pending':
                statusIcon = 'fa-clock';
                statusClass = 'text-warning';
                break;
            case 'Succeeded':
                statusIcon = 'fa-flag-checkered';
                statusClass = 'text-info';
                break;
            case 'Failed':
                statusIcon = 'fa-times-circle';
                statusClass = 'text-danger';
                break;
            default:
                statusIcon = 'fa-question-circle';
                statusClass = 'text-secondary';
        }
        
        statusCell.innerHTML = `
            <span class="${statusClass}">
                <i class="fas ${statusIcon}" title="${pod.status}"></i>
                ${pod.status}
            </span>
        `;
        row.appendChild(statusCell);
        
        // Actions
        const actionsCell = document.createElement('td');
        actionsCell.className = 'text-center';
        actionsCell.innerHTML = createActionButton('pods', pod.namespace, pod.name);
        row.appendChild(actionsCell);
        
        tableBody.appendChild(row);
    });
}

// Resources page initialization
function initializeResourcesPage() {
    console.log('Initializing resources page...');
    
    // Add controls to each resource tab
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    resourceTypes.forEach(resourceType => {
        // Add "resources-" prefix to all IDs in the Resources page
        const resourcesId = `resources-${resourceType}`;
        addResourceControls(resourcesId);
        
        // Set up tab click handlers to load data on demand
        const tabElement = document.querySelector(`#${resourcesId}-tab`);
        if (tabElement) {
            tabElement.addEventListener('click', () => {
                console.log(`Resources tab ${resourceType} clicked, fetching fresh data...`);
                
                // Get current namespace selection (with resources- prefix)
                const namespaceSelector = document.getElementById(`${resourcesId}Namespace`);
                const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
                
                // Force fetch by clearing the cached state
                if (window.loadedResources) {
                    window.loadedResources[resourcesId] = false;
                }
                
                // Fetch data for this resource type
                fetchResourceData(resourcesId, currentNamespace);
            });
        }
    });
}