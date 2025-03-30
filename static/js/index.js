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
        console.log('Navigation state change detected');
        
        // If we're back on the home page
        if (window.location.pathname === '/' || window.location.pathname === '') {
            const activeTabId = document.querySelector('.tab-pane.active')?.id;
            
            // Check if the active tab is a resource tab that should load data
            if (activeTabId && ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(activeTabId)) {
                console.log(`Navigation returned to home page, loading ${activeTabId} data`);
                
                // Force reload for the active tab
                if (window.loadedResources) {
                    window.loadedResources[activeTabId] = false;
                }
                
                // Load the active tab data
                fetchResourceData(activeTabId);
            }
        }
        
        // Apply state if it exists
        if (event.state) {
            document.getElementById('main-content').innerHTML = event.state.content;
            
            // Re-initialize components if needed
            if (event.state.page === 'home') {
                if (typeof initializeHomePage === 'function') {
                    initializeHomePage();
                }
                
                // Make sure the active tab data is loaded
                const activeTabId = document.querySelector('.tab-pane.active')?.id;
                if (activeTabId && ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(activeTabId)) {
                    fetchResourceData(activeTabId);
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
    // Initialize app state
    window.app = window.app || {};
    window.app.CACHE_TIMEOUT = 30000;  // 30 seconds for cache timeout
    window.app.currentTab = null;
    window.app.state = {
        resources: {},        // Cache of resource data
        errors: {},           // Tracking errors
        lastFetch: {},        // Last fetch timestamp by resource type
        activeRequests: new Map(), // Track active fetch requests
        navigation: {
            activeTab: null   // Current active tab
        }
    };
    
    // Set up navigation tracking
    const tabs = document.querySelectorAll('[data-bs-toggle="tab"]');
    tabs.forEach(tab => {
        tab.addEventListener('shown.bs.tab', function(event) {
            const targetId = event.target.getAttribute('data-bs-target').substring(1);
            window.app.state.navigation.activeTab = targetId;
            console.log(`Navigation state updated: ${targetId}`);
        });
    });
    
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

// Home page specific initialization
function initializeHomePage() {
    console.log('Initializing Home page...');
    
    // Reset filters
    document.querySelectorAll('.filter-active').forEach(el => el.classList.remove('filter-active'));
    
    // Set up Fetch button
    const fetchButton = document.getElementById('fetchResourcesButton');
    if (fetchButton) {
        fetchButton.addEventListener('click', fetchResourcesForAllTabs);
    }
    
    // Set up GPU filter
    initializeGPUFilter();
    
    // Set up tab click handlers
    setupTabClickHandlers();
    
    // Set up namespace filtering functionality
    initializeNamespaceFunctionality();
    
    // Add YAML upload functionality if on home page
    if (document.getElementById('uploadForm')) {
        setupDropZone();
    }
    
    // Load resource info for the current active resource tab
    const activeResourceTab = document.querySelector('#resourceTabs .nav-link.active');
    if (activeResourceTab) {
        const tabId = activeResourceTab.id.replace('-tab', '');
        loadResourcesForTab(tabId);
    }
    
    // Fetch cluster capacity data
    fetchClusterCapacity();
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

// Fetch all resources for each tab (line 882)
function fetchResourcesForAllTabs() {
    // Skip if already run
    if (window.resourcesTabsInitialized) {
        console.log('Resource tabs already initialized, skipping duplicate initialization');
        return;
    }
    
    console.log('Setting up resource tabs and loading initial data...');
    
    // Define supported resource types
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    // Initialize loadedResources tracking object if not already created
    window.loadedResources = window.loadedResources || {};
    
    // Setup for each resource type
    resourceTypes.forEach(resourceType => {
        showLoading(resourceType);
        
        // Add refresh button and search bar to each resource tab
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
    
    // Only load the active tab initially
    const activeTabId = document.querySelector('.tab-pane.active').id;
    if (activeTabId && resourceTypes.includes(activeTabId)) {
        // Get the namespace for this tab
        const namespaceSelector = document.getElementById(`${activeTabId}Namespace`);
        const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
        
        fetchResourceData(activeTabId, currentNamespace);
    } else {
        // If no tab is active, load pods as default
        fetchResourceData('pods', 'all');
    }
    
    // Set up a failsafe to check if the resources loaded correctly
    setTimeout(() => {
        const activeTabId = document.querySelector('.tab-pane.active').id;
        if (activeTabId && resourceTypes.includes(activeTabId)) {
            const tableBody = document.querySelector(`#${activeTabId}Table tbody`);
            if (tableBody && (tableBody.children.length === 0 || !window.loadedResources[activeTabId])) {
                console.log(`No data found in ${activeTabId} after initial load, retrying...`);
                fetchResourceData(activeTabId);
            }
        }
    }, 5000);
    
    // Mark as initialized
    window.resourcesTabsInitialized = true;
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
function filterResources(resourceType, searchTerm) {
    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (!tableBody) return;
    
    const rows = tableBody.querySelectorAll('tr');
    const searchTermLower = searchTerm.toLowerCase();
    
    // Check if GPU filter is active
    const isGPUFilterActive = document.getElementById('gpuCard')?.classList.contains('filter-active');
    // Use gpuPodNames from the window object, falling back to podsWithGPUs if needed
    const gpuPodNames = window.gpuPodNames || 
                         (window.podsWithGPUs?.map(pod => `${pod.namespace}/${pod.name}`)) || [];
    
    rows.forEach(row => {
        if (row.classList.contains('no-results-row') || row.classList.contains('no-gpu-pods-row')) {
            row.style.display = 'none';
            return;
        }
        
        const text = row.textContent.toLowerCase();
        const matchesSearch = searchTerm === '' || text.includes(searchTermLower);
        
        // If GPU filter is active, also check if this pod has GPUs
        if (isGPUFilterActive && resourceType === 'pods') {
            const namespace = row.cells[0]?.textContent;
            const name = row.cells[1]?.textContent;
            const hasGPU = gpuPodNames.includes(`${namespace}/${name}`);
            
            row.style.display = (matchesSearch && hasGPU) ? '' : 'none';
        } else {
            row.style.display = matchesSearch ? '' : 'none';
        }
    });
    
    // Show a message if no results
    let noResultsRow = tableBody.querySelector('.no-results-row');
    
    if (searchTerm !== '' && ![...rows].some(row => row.style.display !== 'none' && 
        !row.classList.contains('no-results-row') && 
        !row.classList.contains('no-gpu-pods-row'))) {
        // No visible rows and search is active
        if (!noResultsRow) {
            noResultsRow = document.createElement('tr');
            noResultsRow.className = 'no-results-row';
            const colspan = resourceType === 'pods' ? 7 : 
                           (resourceType === 'inferenceservices' ? 11 : 7);
            noResultsRow.innerHTML = `<td colspan="${colspan}" class="text-center">No ${resourceType} matching "${searchTerm}"${isGPUFilterActive ? ' with GPU resources' : ''}</td>`;
            tableBody.appendChild(noResultsRow);
        } else {
            noResultsRow.querySelector('td').textContent = `No ${resourceType} matching "${searchTerm}"${isGPUFilterActive ? ' with GPU resources' : ''}`;
            noResultsRow.style.display = '';
        }
    } else if (noResultsRow) {
        // Hide the no results message if there are visible rows or search is cleared
        noResultsRow.style.display = 'none';
    }
    
    // If GPU filter is active but no pods are found, show GPU filter message
    if (isGPUFilterActive && resourceType === 'pods' && 
        ![...rows].some(row => row.style.display !== 'none' && 
            !row.classList.contains('no-results-row') && 
            !row.classList.contains('no-gpu-pods-row'))) {
        showNoGPUPodsMessage();
    }
}

// Resource data fetching (for individual tab clicks or refresh button)
function fetchResourceData(resourceType, namespace, criticalOnly = false) {
    console.log(`Fetching ${resourceType} data (${criticalOnly ? 'critical' : 'full'})...`);
    const startTime = performance.now();
    
    // Cancel any existing request for this resource type
    if (window.app.state.activeRequests.has(resourceType)) {
        window.app.state.activeRequests.get(resourceType).abort();
        window.app.state.activeRequests.delete(resourceType);
    }
    
    // For critical-only loads, don't use cache
    if (!criticalOnly) {
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
            return response.json();
        })
        .then(data => {
            if (!data || !data.data || !data.data.items) {
                throw new Error('Invalid response format');
            }
            
            // Cache the successful response
            window.app.state.resources[resourceType] = data;
            window.app.state.lastFetch[resourceType] = Date.now();
            
            // Process the data
            processResourceData(resourceType, data, startTime, processingStartTime);
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
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    Failed to load ${resourceType} after multiple attempts. 
                    <button onclick="fetchResourceData('${resourceType}')" class="btn btn-sm btn-outline-danger ms-3">
                        <i class="fas fa-sync-alt me-1"></i> Retry
                    </button>
                </td></tr>`;
            }
            
            throw error;
        })
        .finally(() => {
            window.app.state.activeRequests.delete(resourceType);
        });
    }
    
    return fetchWithRetry();
}

// Helper function to process resource data
function processResourceData(resourceType, data, startTime, processingStartTime = performance.now()) {
    // Update progress bar to indicate processing data
    const progressBar = document.querySelector(`#${resourceType}Progress .progress-bar`);
    if (progressBar) {
        progressBar.style.width = '50%';
    }
    
    // Clear and populate the table
    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (tableBody) {
        tableBody.innerHTML = '';
        data.data.items.forEach(item => {
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
    
    // Update progress to 100%
    if (progressBar) {
        progressBar.style.width = '100%';
    }
    
    // Mark this resource type as loaded
    window.app.loadedResources[resourceType] = true;
    
    // Store pods data and update dashboard metrics if this is pods data
    if (resourceType === 'pods') {
        window.podsData = data.data.items;
        updateDashboardMetrics(data.data.items);
    }
    
    // Calculate and log performance metrics
    const endTime = performance.now();
    const totalTime = Math.round(endTime - startTime);
    const processingTime = Math.round(endTime - processingStartTime);
    console.log(`Completed loading ${resourceType}:`);
    console.log(`- API request/response time: ${Math.round(processingStartTime - startTime)}ms`);
    console.log(`- Data processing time: ${processingTime}ms`);
    console.log(`- Total time: ${totalTime}ms`);
}

// Show loading indicator
function showLoading(resourceType) {
    const loadingElement = document.getElementById(`${resourceType}Loading`);
    if (loadingElement) {
        loadingElement.style.display = 'flex';
    } else {
        // Create loading indicator if it doesn't exist
        const tableContainer = document.querySelector(`#${resourceType} .table-responsive`);
        if (tableContainer) {
            const loadingDiv = document.createElement('div');
            loadingDiv.id = `${resourceType}Loading`;
            loadingDiv.className = 'loading-container';
            loadingDiv.innerHTML = `
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <span class="loading-text ms-2">Loading ${capitalizeFirstLetter(resourceType)}...</span>
                <div class="progress mt-2 w-100">
                    <div id="${resourceType}ProgressBar" class="progress-bar" role="progressbar" 
                         style="width: 10%" aria-valuenow="10" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
                <div id="${resourceType}LoadingInfo" class="loading-info mt-1 small text-muted"></div>
            `;
            tableContainer.parentNode.insertBefore(loadingDiv, tableContainer);
        }
    }
    
    // Reset progress bar
    const progressBar = document.getElementById(`${resourceType}ProgressBar`);
    if (progressBar) {
        progressBar.style.width = '10%';
    }
    
    // Reset loading info
    const loadingInfo = document.getElementById(`${resourceType}LoadingInfo`);
    if (loadingInfo) {
        loadingInfo.textContent = 'Preparing request...';
    }
}

// Hide loading indicator
function hideLoading(resourceType) {
    const loadingElement = document.getElementById(`${resourceType}Loading`);
    if (loadingElement) {
        // Animate completion before hiding
        const progressBar = document.getElementById(`${resourceType}ProgressBar`);
        if (progressBar) {
            progressBar.style.width = '100%';
            
            // Give a slight delay to show the completed progress
            setTimeout(() => {
                loadingElement.style.display = 'none';
            }, 500);
        } else {
            loadingElement.style.display = 'none';
        }
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
    } else {
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

// Set up tab click handlers for GPU filter persistence
function setupTabClickHandlers() {
    // Handle main tabs (pods, services, deployments, etc.)
    document.querySelectorAll('#resourceTabs .nav-link').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.id.replace('-tab', '');
            loadResourcesForTab(tabId);
        });
    });
    
    // Setup tab content navigation for main content areas
    document.querySelectorAll('.nav-link[data-bs-toggle="tab"]').forEach(tab => {
        tab.addEventListener('shown.bs.tab', function(event) {
            const tabId = event.target.getAttribute('data-bs-target').substring(1);
            
            // When we switch away from home, load resources for the active tab
            if (tabId !== 'home') {
                // Find the active sub-tab within this section
                const activeTabLink = document.querySelector(`#${tabId} .nav-link.active`);
                if (activeTabLink) {
                    const activeSubTabId = activeTabLink.id.replace('-tab', '');
                    loadResourcesForTab(activeSubTabId);
                } else {
                    // If no active tab is found, try to find the default tab for this section
                    const firstTab = document.querySelector(`#${tabId} .nav-link`);
                    if (firstTab) {
                        const firstTabId = firstTab.id.replace('-tab', '');
                        loadResourcesForTab(firstTabId);
                    }
                }
            }
        });
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

// Add this new function to fetch cluster capacity
function fetchClusterCapacity() {
    console.log('Fetching cluster capacity metrics...');
    
    // Store default values in case API call fails
    window.clusterCapacity = {
        cpu: 256, // Default fallback value
        memory: 1024, // in Gi
        gpu: 0
    };
    
    fetch('/get_cluster_capacity')
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch cluster capacity: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.cpu) {
                window.clusterCapacity.cpu = data.cpu;
            }
            if (data.memory) {
                window.clusterCapacity.memory = data.memory;
            }
            if (data.gpu !== undefined) {
                window.clusterCapacity.gpu = data.gpu;
            }
            
            console.log(`Cluster capacity loaded: ${window.clusterCapacity.cpu} CPU cores, ${window.clusterCapacity.memory} Gi memory, ${window.clusterCapacity.gpu} GPUs`);
            
            // Update capacity display in the UI
            document.getElementById('totalCPUCapacity').textContent = window.clusterCapacity.cpu;
            
            // If we already have pod data, recalculate the metrics with the new capacity
            if (window.loadedResources && window.loadedResources.pods) {
                const tableBody = document.querySelector('#podsTable tbody');
                if (tableBody) {
                    const pods = window.podsData || [];
                    if (pods.length > 0) {
                        updateDashboardMetrics(pods);
                    }
                }
            }
        })
        .catch(error => {
            console.warn(`Error fetching cluster capacity: ${error.message}. Using default values.`);
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
                <button class="btn dropdown-toggle" type="button" data-bs-toggle="dropdown">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
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
        
        // Change color based on usage
        if (cpuPercentage > 90) {
            cpuProgressBar.className = 'progress-bar bg-danger';
        } else if (cpuPercentage > 75) {
            cpuProgressBar.className = 'progress-bar bg-warning';
        } else {
            cpuProgressBar.className = 'progress-bar';
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
    
    document.getElementById('totalGPUCount').textContent = totalGPURequest.toFixed(0);
    
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

function applyGPUFilter() {
    const activeTab = document.querySelector('#resourceTabs .nav-link.active');
    if (activeTab && activeTab.id === 'pods-tab') {
        filterResourceTable('pods');
    }
}

// Clear GPU filter directly (for use in the "Clear Filter" button)
function clearGPUFilter() {
    const gpuCard = document.getElementById('gpuCard');
    if (gpuCard) {
        window.gpuFilterActive = false;
        gpuCard.classList.remove('filter-active');
        
        // Update UI
        document.getElementById('gpuFilterStatus').textContent = 'Click to filter';
        document.getElementById('clearGPUFilter').style.display = 'none';
        
        // Clear filter in the table
        applyGPUFilter();
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
    window.app.currentTab = tabId;

    // Clear any existing content
    const tableBody = document.querySelector(`#${tabId}Table tbody`);
    if (tableBody) {
        tableBody.innerHTML = '';
    }

    // Show loading indicator for the tab
    const loadingElement = document.getElementById(`${tabId}Loading`);
    if (loadingElement) {
        loadingElement.style.display = 'block';
    }

    // Load resources based on tab type
    if (['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(tabId)) {
        // First load critical data (status and basic info)
        fetchResourceData(tabId, 'all', true)
            .then(() => {
                // Then load full details in background
                if (window.app.currentTab === tabId) {  // Only if still on same tab
                    return fetchResourceData(tabId, 'all', false);
                }
            })
            .catch(error => {
                console.error(`Error loading ${tabId}:`, error);
            });
    } else if (tabId === 'namespaces') {
        if (typeof loadNamespaces === 'function') {
            loadNamespaces();
        }
    } else if (tabId === 'charts') {
        if (typeof refreshCharts === 'function') {
            refreshCharts();
        }
    }
}

// Make loadResourcesForTab globally accessible
window.loadResourcesForTab = loadResourcesForTab;