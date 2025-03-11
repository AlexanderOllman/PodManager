/**
 * HPE Private Cloud AI Resource Manager
 * Index Page JavaScript file
 */

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
            const activeTabId = document.querySelector('.tab-pane.active').id;
            if (activeTabId && ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(activeTabId)) {
                if (!window.loadedResources || !window.loadedResources[activeTabId]) {
                    console.log(`Active tab ${activeTabId} not loaded, fetching data...`);
                    fetchResourceData(activeTabId);
                }
            }
        }
    });
});

// Main application initialization
function initializeApp() {
    console.log('Initializing application...');
    
    // Initialize components that don't require special dependencies
    fetchResourcesForAllTabs();
    checkGitAvailability();
    fetchNamespaces();
    setupDropZone();
    
    // Initialize terminal if available
    initializeTerminal();
    
    // Connect socket event listeners
    connectSocketListeners();
    
    console.log('Application initialized');
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
            if (window.app.socket) {
                terminal.write('\r\n$ ');
                
                // Listen for terminal output from server
                window.app.socket.on('output', function(data) {
                    if (window.app.terminal) {
                        window.app.terminal.write(data.data);
                        // Write prompt after server response
                        window.app.terminal.write('\r\n$ ');
                        currentLine = '';
                    }
                });
                
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
                            
                            // Send to server
                            window.app.socket.emit('run_cli_command', { command: currentLine });
                            
                            // Visual feedback but wait for server response for prompt
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
                
                console.log('Terminal initialized successfully with interactive mode');
            } else {
                terminal.write('\r\n\x1b[31mError: Socket connection not available. Terminal functionality is limited.\x1b[0m\r\n');
                console.warn('Socket not available for terminal output');
            }
        } catch (error) {
            console.error('Failed to initialize terminal:', error);
            const terminalElement = document.getElementById('terminal');
            terminalElement.innerHTML = '<div class="alert alert-danger">Failed to initialize terminal: ' + error.message + '</div>';
        }
    }
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

// Fetch all resources for each tab
function fetchResourcesForAllTabs() {
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    // Track loaded resources to avoid unnecessary reloading
    window.loadedResources = window.loadedResources || {};
    
    // Add controls to each resource tab and set up click handlers 
    resourceTypes.forEach(resourceType => {
        // Initialize loading indicators
        showLoading(resourceType);
        
        // Add refresh button and search bar to each resource tab
        addResourceControls(resourceType);
        
        // Set up tab click handlers to load data on demand
        const tabElement = document.querySelector(`#${resourceType}-tab`);
        if (tabElement) {
            tabElement.addEventListener('click', () => {
                // Only fetch data if not already loaded
                if (!window.loadedResources[resourceType]) {
                    fetchResourceData(resourceType);
                }
            });
        }
    });
    
    // Only load the active tab initially
    const activeTabId = document.querySelector('.tab-pane.active').id;
    if (activeTabId && resourceTypes.includes(activeTabId)) {
        fetchResourceData(activeTabId);
    } else {
        // If no tab is active, load pods as default
        fetchResourceData('pods');
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
}

// Add refresh button and search bar to each resource tab
function addResourceControls(resourceType) {
    const tabPane = document.getElementById(resourceType);
    if (!tabPane) return;
    
    // Find where to insert controls (before the table)
    let tableContainer = tabPane.querySelector('.table-responsive');
    if (!tableContainer) return;
    
    // Create controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'mb-3 d-flex justify-content-between align-items-center';
    
    // Create search input
    const searchContainer = document.createElement('div');
    searchContainer.className = 'input-group w-50';
    searchContainer.innerHTML = `
        <input type="text" class="form-control" placeholder="Filter ${resourceType}..." id="${resourceType}Search">
        <button class="btn btn-outline-secondary" type="button" onclick="clearSearch('${resourceType}')">
            <i class="fas fa-times"></i>
        </button>
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
    
    // Assemble the controls
    controlsContainer.appendChild(searchContainer);
    controlsContainer.appendChild(refreshButton);
    
    // Insert the controls before the table
    tabPane.insertBefore(controlsContainer, tableContainer);
    
    // Add event listener for search functionality
    const searchInput = document.getElementById(`${resourceType}Search`);
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            filterTable(resourceType, this.value);
        });
    }
}

// Fetch resource data for a specific tab
function fetchResourceData(resourceType) {
    // Show loading indicator
    showLoading(resourceType);
    
    console.log(`Fetching data for ${resourceType}...`);
    
    // Make the API request
    fetch(`/api/${resourceType}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch ${resourceType}`);
            }
            return response.json();
        })
        .then(data => {
            // Process and render the data
            renderResourceData(resourceType, data);
            
            // Hide loading indicator
            hideLoading(resourceType);
            
            // Mark this resource as loaded
            window.loadedResources[resourceType] = true;
            
            console.log(`Successfully loaded ${resourceType} data`);
        })
        .catch(error => {
            console.error(`Error fetching ${resourceType}:`, error);
            
            // Hide loading indicator and show error
            hideLoading(resourceType);
            
            // Display error message in table
            const tableBody = document.querySelector(`#${resourceType}Table tbody`);
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="100%" class="text-center text-danger">
                            <i class="fas fa-exclamation-triangle"></i> 
                            Failed to load ${resourceType}: ${error.message}
                            <button class="btn btn-sm btn-outline-primary ml-3" onclick="fetchResourceData('${resourceType}')">
                                Retry
                            </button>
                        </td>
                    </tr>
                `;
            }
        });
}

// Helper functions for loading indicators
function showLoading(resourceType) {
    const loadingElement = document.getElementById(`${resourceType}Loading`);
    const tableElement = document.querySelector(`#${resourceType}Table`);
    
    if (loadingElement) {
        loadingElement.style.display = 'flex';
    }
    
    if (tableElement) {
        tableElement.style.display = 'none';
    }
}

function hideLoading(resourceType) {
    const loadingElement = document.getElementById(`${resourceType}Loading`);
    const tableElement = document.querySelector(`#${resourceType}Table`);
    
    if (loadingElement) {
        loadingElement.style.display = 'none';
    }
    
    if (tableElement) {
        tableElement.style.display = 'table';
    }
}

// Utility to capitalize the first letter of a string
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Filter table data based on search input
function filterTable(resourceType, searchText) {
    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (!tableBody) return;
    
    const rows = tableBody.querySelectorAll('tr');
    const searchLower = searchText.toLowerCase();
    
    rows.forEach(row => {
        let match = false;
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
            if (cell.textContent.toLowerCase().includes(searchLower)) {
                match = true;
            }
        });
        
        row.style.display = match ? '' : 'none';
    });
}

// Clear search input and reset table
function clearSearch(resourceType) {
    const searchInput = document.getElementById(`${resourceType}Search`);
    if (searchInput) {
        searchInput.value = '';
        filterTable(resourceType, '');
    }
}

// Check Git availability for settings page
function checkGitAvailability() {
    const gitStatusElement = document.getElementById('gitStatus');
    if (!gitStatusElement) return;
    
    fetch('/git_status')
        .then(response => response.json())
        .then(data => {
            if (data.available) {
                gitStatusElement.innerHTML = `
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle"></i> Git is available.
                        <strong>Current version:</strong> ${data.version}
                    </div>
                `;
                
                // Additional details if provided
                if (data.repo_status) {
                    const repoStatusElement = document.getElementById('repoStatus');
                    if (repoStatusElement) {
                        repoStatusElement.innerHTML = data.repo_status;
                    }
                }
            } else {
                gitStatusElement.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle"></i> Git is not available. Some features may be limited.
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('Error checking Git status:', error);
            gitStatusElement.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-times-circle"></i> Failed to check Git status: ${error.message}
                </div>
            `;
        });
}

// Fetch namespace data for YAML upload form
function fetchNamespaces() {
    const namespaceSelect = document.getElementById('yamlNamespace');
    if (!namespaceSelect) return;
    
    fetch('/api/namespaces')
        .then(response => response.json())
        .then(data => {
            if (data && data.length > 0) {
                // Clear previous options except for the default
                while (namespaceSelect.options.length > 1) {
                    namespaceSelect.remove(1);
                }
                
                // Add new options
                data.forEach(namespace => {
                    const option = document.createElement('option');
                    option.value = namespace;
                    option.textContent = namespace;
                    namespaceSelect.appendChild(option);
                });
            }
        })
        .catch(error => {
            console.error('Error fetching namespaces:', error);
        });
}

// Setup drag-and-drop zone for YAML upload
function setupDropZone() {
    const dropZoneElement = document.querySelector('.drop-zone');
    if (!dropZoneElement) return;
    
    const inputElement = dropZoneElement.querySelector('.drop-zone__input');
    if (!inputElement) return;
    
    // Prevent default browser behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZoneElement.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Highlight drop zone on drag over
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZoneElement.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropZoneElement.addEventListener(eventName, unhighlight, false);
    });
    
    function highlight() {
        dropZoneElement.classList.add('drop-zone--over');
    }
    
    function unhighlight() {
        dropZoneElement.classList.remove('drop-zone--over');
    }
    
    // Handle file selection
    dropZoneElement.addEventListener('drop', handleDrop, false);
    inputElement.addEventListener('change', handleFileSelect, false);
    
    function handleDrop(e) {
        const files = e.dataTransfer.files;
        if (files.length) {
            inputElement.files = files;
            handleFileSelect();
        }
    }
    
    function handleFileSelect() {
        if (inputElement.files.length) {
            updateThumbnail(dropZoneElement, inputElement.files[0]);
        }
    }
    
    // Display file thumbnail or name
    function updateThumbnail(dropZoneElement, file) {
        let thumbnailElement = dropZoneElement.querySelector('.drop-zone__thumb');
        
        // Remove previous thumbnail
        if (thumbnailElement) {
            thumbnailElement.remove();
        }
        
        // Create new thumbnail
        thumbnailElement = document.createElement('div');
        thumbnailElement.classList.add('drop-zone__thumb');
        thumbnailElement.dataset.label = file.name;
        dropZoneElement.appendChild(thumbnailElement);
        
        // If it's a text file, try to preview it
        if (file.type.match(/text.*/)) {
            const reader = new FileReader();
            reader.onload = function(e) {
                let previewText = e.target.result.substring(0, 500); // First 500 chars
                if (e.target.result.length > 500) {
                    previewText += '...';
                }
                
                // Create a preview element
                const previewElement = document.createElement('pre');
                previewElement.style.margin = '10px';
                previewElement.style.fontSize = '12px';
                previewElement.style.whiteSpace = 'pre-wrap';
                previewElement.textContent = previewText;
                
                thumbnailElement.appendChild(previewElement);
            };
            reader.readAsText(file);
        } else {
            // Show a generic icon for non-text files
            thumbnailElement.style.backgroundImage = 'url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 512 512\'%3E%3Cpath d=\'M464 64H48C21.49 64 0 85.49 0 112v288c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V112c0-26.51-21.49-48-48-48zm-96 220c0 55.23-44.77 100-100 100s-100-44.77-100-100 44.77-100 100-100 100 44.77 100 100z\'/%3E%3C/svg%3E")';
            thumbnailElement.style.backgroundSize = 'cover';
            thumbnailElement.style.backgroundPosition = 'center';
        }
    }
    
    // Submit YAML file
    const yamlForm = document.getElementById('yamlForm');
    if (yamlForm) {
        yamlForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const fileInput = document.getElementById('yamlFile');
            const namespaceSelect = document.getElementById('yamlNamespace');
            
            if (!fileInput.files.length) {
                alert('Please select a YAML file to upload');
                return;
            }
            
            const file = fileInput.files[0];
            const namespace = namespaceSelect.value;
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('namespace', namespace);
            
            // Show loading
            const yamlStatus = document.getElementById('yamlStatus');
            yamlStatus.innerHTML = `
                <div class="alert alert-info">
                    <div class="spinner-border spinner-border-sm text-primary" role="status"></div>
                    Applying YAML file to namespace: ${namespace}...
                </div>
            `;
            
            fetch('/apply_yaml', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    yamlStatus.innerHTML = `
                        <div class="alert alert-success">
                            <i class="fas fa-check-circle"></i> YAML applied successfully!
                            <pre class="mt-2">${data.message}</pre>
                        </div>
                    `;
                } else {
                    yamlStatus.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="fas fa-times-circle"></i> Failed to apply YAML.
                            <pre class="mt-2">${data.message}</pre>
                        </div>
                    `;
                }
            })
            .catch(error => {
                console.error('Error applying YAML:', error);
                yamlStatus.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="fas fa-times-circle"></i> Error: ${error.message}
                    </div>
                `;
            });
        });
    }
}

// Handle application restart
function handleApplicationRestart() {
    const MAX_ATTEMPTS = 30;
    let attempts = 0;
    
    // Create or get status display element
    const statusDiv = document.getElementById('updateStatus');
    const refreshLog = document.getElementById('refreshLog');
    
    if (statusDiv) {
        statusDiv.innerHTML = `
            <div class="alert alert-info">
                <i class="fas fa-spinner fa-spin"></i> Restarting application...
                <div class="progress mt-2">
                    <div class="progress-bar progress-bar-striped progress-bar-animated" style="width: 0%"></div>
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

// Helper function to add log messages
function logMessage(logElement, message, status) {
    if (!logElement) return;
    
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
    logElement.appendChild(logEntry);
    
    // Auto-scroll to the bottom
    logElement.scrollTop = logElement.scrollHeight;
}

// Clear refresh log
function clearRefreshLog() {
    const refreshLog = document.getElementById('refreshLog');
    if (refreshLog) {
        refreshLog.innerHTML = '<div class="text-muted">-- Log will appear here during refresh operations --</div>';
    }
}

// Render resource data in tables
function renderResourceData(resourceType, data) {
    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (!tableBody) return;
    
    // Clear existing rows
    tableBody.innerHTML = '';
    
    // Handle empty data
    if (!data || data.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="100%" class="text-center">
                    <i class="fas fa-info-circle"></i> No ${resourceType} found
                </td>
            </tr>
        `;
        return;
    }
    
    // Different rendering logic for each resource type
    switch (resourceType) {
        case 'pods':
            renderPods(data, tableBody);
            break;
        case 'services':
            renderServices(data, tableBody);
            break;
        case 'deployments':
            renderDeployments(data, tableBody);
            break;
        case 'inferenceservices':
            renderInferenceServices(data, tableBody);
            break;
        case 'configmaps':
            renderConfigMaps(data, tableBody);
            break;
        case 'secrets':
            renderSecrets(data, tableBody);
            break;
        default:
            console.warn(`No renderer defined for resource type: ${resourceType}`);
    }
}

// Component-specific renderers for each resource type
function renderPods(pods, tableBody) {
    pods.forEach(pod => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${pod.namespace}</td>
            <td>
                <a href="/explore/${pod.namespace}/${pod.name}" class="explore-pod-link" data-namespace="${pod.namespace}" data-pod-name="${pod.name}">
                    ${pod.name}
                </a>
            </td>
            <td>${pod.ready}</td>
            <td>${getStatusIcon(pod.status)} ${pod.status}</td>
            <td>${pod.restarts}</td>
            <td>${pod.age}</td>
            <td>
                <div class="btn-group">
                    <button type="button" class="btn btn-sm btn-outline-primary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
                        Actions
                    </button>
                    <ul class="dropdown-menu">
                        <li><a class="dropdown-item" href="#" onclick="runAction('describe', 'pod', '${pod.namespace}', '${pod.name}')">Describe</a></li>
                        <li><a class="dropdown-item" href="#" onclick="runAction('logs', 'pod', '${pod.namespace}', '${pod.name}')">Logs</a></li>
                        <li><a class="dropdown-item" href="#" onclick="runAction('exec', 'pod', '${pod.namespace}', '${pod.name}')">Processes</a></li>
                        <li><hr class="dropdown-divider"></li>
                        <li><a class="dropdown-item text-danger" href="#" onclick="runAction('delete', 'pod', '${pod.namespace}', '${pod.name}')">Delete</a></li>
                    </ul>
                </div>
            </td>
        `;
        tableBody.appendChild(row);
    });
}

// Add similar render functions for other resource types if needed

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