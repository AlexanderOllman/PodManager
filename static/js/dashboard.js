// HPE Private Cloud AI Resource Manager - Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize dashboard metrics
    updateDashboardMetrics();
    
    // Initialize action menus
    initializeActionMenus();
    
    // Load initial data
    loadResourceData('pods');
    
    // Initialize tabs
    document.querySelectorAll('.resource-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            switchTab(tabId);
        });
    });
    
    // Initialize terminal for CLI tab if needed
    document.getElementById('cliLink')?.addEventListener('click', function() {
        // Initialize terminal if needed
        if (window.app && window.app.terminal === null && typeof Terminal !== 'undefined') {
            initializeTerminal();
        }
    });
    
    // Initialize search functionality
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            filterResourceTable(this.value);
        });
    }
    
    // Initialize refresh button
    const refreshBtn = document.getElementById('refreshTableBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            const activeTab = document.querySelector('.resource-tab.active');
            if (activeTab) {
                const resourceType = activeTab.getAttribute('data-tab');
                loadResourceData(resourceType);
            }
        });
    }
    
    // Initialize expand button
    const expandBtn = document.getElementById('expandTableBtn');
    if (expandBtn) {
        expandBtn.addEventListener('click', function() {
            expandTableToFullscreen();
        });
    }
    
    // Initialize close fullscreen button
    const closeFullscreenBtn = document.getElementById('closeFullscreenBtn');
    if (closeFullscreenBtn) {
        closeFullscreenBtn.addEventListener('click', function() {
            closeFullscreen();
        });
    }

    // Set up Socket.IO event listeners for refresh log
    if (window.app && window.app.socket) {
        window.app.socket.on('refresh_log', function(data) {
            const refreshLog = document.getElementById('refreshLog');
            if (refreshLog) {
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
                
                logEntry.innerHTML = `[${timestamp}] ${data.message}`;
                refreshLog.appendChild(logEntry);
                
                // Auto-scroll to the bottom
                refreshLog.scrollTop = refreshLog.scrollHeight;
            }
        });
    }
});

// Function to filter resource table based on search term
function filterResourceTable(searchTerm) {
    const activeTab = document.querySelector('.resource-tab.active');
    if (!activeTab) return;
    
    const resourceType = activeTab.getAttribute('data-tab');
    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (!tableBody) return;
    
    const searchTermLower = searchTerm.toLowerCase().trim();
    let hasVisibleRows = false;
    
    // Filter rows based on search term
    tableBody.querySelectorAll('tr').forEach(row => {
        if (row.classList.contains('no-results-row')) {
            row.remove(); // Remove any existing "no results" rows
            return;
        }
        
        const text = row.textContent.toLowerCase();
        const shouldShow = searchTermLower === '' || text.includes(searchTermLower);
        row.style.display = shouldShow ? '' : 'none';
        
        if (shouldShow) {
            hasVisibleRows = true;
        }
    });
    
    // If no rows are visible, add a "no results" row
    if (!hasVisibleRows && searchTermLower !== '') {
        const noResultsRow = document.createElement('tr');
        noResultsRow.className = 'no-results-row';
        noResultsRow.innerHTML = `<td colspan="7" class="text-center">No ${resourceType} matching "${searchTerm}"</td>`;
        tableBody.appendChild(noResultsRow);
    }
}

// Function to expand table to fullscreen
function expandTableToFullscreen() {
    const fullscreenMode = document.getElementById('fullscreenMode');
    const fullscreenContent = document.getElementById('fullscreenContent');
    const resourceTableContainer = document.querySelector('.resource-table-container');
    
    if (!fullscreenMode || !fullscreenContent || !resourceTableContainer) return;
    
    // Clone the resource table container
    const clonedContainer = resourceTableContainer.cloneNode(true);
    
    // Clear previous content and append the clone
    fullscreenContent.innerHTML = '';
    fullscreenContent.appendChild(clonedContainer);
    
    // Show the fullscreen mode
    fullscreenMode.style.display = 'flex';
    
    // Initialize tabs in fullscreen mode
    fullscreenContent.querySelectorAll('.resource-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            const activeTab = document.querySelector(`.resource-tab[data-tab="${tabId}"]`);
            if (activeTab) {
                activeTab.click(); // Trigger click on the original tab to keep them in sync
            }
        });
    });
    
    // Initialize search in fullscreen mode
    const searchInput = fullscreenContent.querySelector('#resourceSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            filterResourceTable(this.value);
        });
    }
    
    // Initialize refresh in fullscreen mode
    const refreshBtn = fullscreenContent.querySelector('#refreshTableBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            const activeTab = document.querySelector('.resource-tab.active');
            if (activeTab) {
                const resourceType = activeTab.getAttribute('data-tab');
                loadResourceData(resourceType);
            }
        });
    }
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
}

// Function to close fullscreen mode
function closeFullscreen() {
    const fullscreenMode = document.getElementById('fullscreenMode');
    if (fullscreenMode) {
        fullscreenMode.style.display = 'none';
    }
    
    // Re-enable body scrolling
    document.body.style.overflow = '';
}

// Function to initialize terminal
function initializeTerminal() {
    const terminalElement = document.getElementById('terminal');
    if (!terminalElement) return;
    
    try {
        // Initialize terminal
        const terminal = new Terminal({
            cursorBlink: true,
            fontFamily: 'monospace',
            fontSize: 14,
            convertEol: true
        });
        
        window.app.terminal = terminal;
        terminal.open(terminalElement);
        
        // Set up command input handling
        const commandInput = document.getElementById('commandInput');
        const runCommandBtn = document.getElementById('runCommand');
        
        if (commandInput && runCommandBtn) {
            runCommandBtn.addEventListener('click', function() {
                const command = commandInput.value;
                if (command.trim() !== '') {
                    terminal.writeln(`$ ${command}`);
                    
                    // Check if this is a special interactive command (like bash or sh)
                    const isInteractive = command.trim() === 'bash' || 
                                        command.trim() === 'sh' || 
                                        command.includes('kubectl exec -it');
                    
                    if (window.app.socket) {
                        window.app.socket.emit('run_cli_command', { 
                            command: command,
                            interactive: isInteractive
                        });
                    }
                    
                    commandInput.value = '';
                }
            });
            
            commandInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    runCommandBtn.click();
                }
            });
        }
        
        // Handle socket.io output
        if (window.app.socket) {
            window.app.socket.on('output', function(data) {
                terminal.write(data.data);
            });
            
            // Handle interactive terminal commands
            window.app.socket.on('terminal_command', function(data) {
                const command = data.command;
                
                // Create a temporary message with instructions
                terminal.writeln('\r\nStarting interactive session...');
                terminal.writeln('For security reasons, we need to open a new terminal window.');
                terminal.writeln('Please copy and paste the following command into your terminal:');
                terminal.writeln('\r\n');
                terminal.writeln(`${command}`);
                terminal.writeln('\r\n');
                terminal.writeln('Press Ctrl+C or type "exit" to end the interactive session.');
                
                // Copy command to clipboard if supported
                try {
                    navigator.clipboard.writeText(command).then(
                        function() {
                            terminal.writeln('Command copied to clipboard!');
                        },
                        function(err) {
                            console.error('Could not copy text: ', err);
                        }
                    );
                } catch (e) {
                    console.error('Clipboard API not supported:', e);
                }
            });
        }
        
        terminal.writeln('Terminal ready. Type commands below.');
        terminal.writeln('Special commands:');
        terminal.writeln('- Type "bash" or "sh" for an interactive shell');
        terminal.writeln('- Type "kubectl exec -it <pod> -n <namespace> -- bash" for pod shell');
    } catch (error) {
        console.error('Failed to initialize terminal:', error);
    }
}

// Function to update dashboard metrics
function updateDashboardMetrics() {
    // Fetch pod count
    fetch('/api/metrics/pods_count')
        .then(response => response.json())
        .then(data => {
            document.getElementById('pods-count').textContent = data.count;
        })
        .catch(error => {
            console.error('Error fetching pod count:', error);
            document.getElementById('pods-count').textContent = 'N/A';
        });
    
    // Fetch total vCPU allocated
    fetch('/api/metrics/vcpu_count')
        .then(response => response.json())
        .then(data => {
            document.getElementById('vcpu-count').textContent = data.count;
        })
        .catch(error => {
            console.error('Error fetching vCPU count:', error);
            document.getElementById('vcpu-count').textContent = 'N/A';
        });
    
    // Fetch total GPU allocated
    fetch('/api/metrics/gpu_count')
        .then(response => response.json())
        .then(data => {
            document.getElementById('gpu-count').textContent = data.count;
        })
        .catch(error => {
            console.error('Error fetching GPU count:', error);
            document.getElementById('gpu-count').textContent = 'N/A';
        });
    
    // Reserved for future metric
    document.getElementById('reserved-metric').textContent = '-';
}

// Function to load resource data
function loadResourceData(resourceType) {
    const loadingElement = document.getElementById(`${resourceType}Loading`);
    const tableElement = document.getElementById(`${resourceType}Table`);
    
    if (loadingElement) loadingElement.style.display = 'flex';
    if (tableElement) tableElement.style.display = 'none';
    
    fetch('/get_resources', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `resource_type=${resourceType}`
    })
    .then(response => response.json())
    .then(data => {
        if (data.format === 'table' && data.data && data.data.items) {
            populateResourceTable(resourceType, data.data.items);
            
            // Track that this resource is loaded
            window.loadedResources = window.loadedResources || {};
            window.loadedResources[resourceType] = true;
            
            // Apply search filter if it exists
            const searchInput = document.getElementById('resourceSearchInput');
            if (searchInput && searchInput.value.trim() !== '') {
                filterResourceTable(searchInput.value);
            }
        } else {
            console.error('Invalid data format received');
            showLoadingError(resourceType, 'Invalid data format received');
        }
        
        if (loadingElement) loadingElement.style.display = 'none';
        if (tableElement) tableElement.style.display = 'table';
    })
    .catch(error => {
        console.error(`Error loading ${resourceType}:`, error);
        if (loadingElement) loadingElement.style.display = 'none';
        showLoadingError(resourceType, error.message);
    });
}

// Function to show loading error
function showLoadingError(resourceType, errorMessage) {
    const tableElement = document.getElementById(`${resourceType}Table`);
    if (tableElement) {
        tableElement.style.display = 'table';
        const tbody = tableElement.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-danger">
                        <i class="fas fa-exclamation-triangle"></i> Error loading ${resourceType}: ${errorMessage}
                    </td>
                </tr>
            `;
        }
    }
}

// Function to populate resource table with data
function populateResourceTable(resourceType, items) {
    const tableBody = document.querySelector(`#${resourceType}Table tbody`);
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    items.forEach(item => {
        const row = document.createElement('tr');
        
        // Add common columns based on resource type
        if (resourceType === 'pods') {
            const status = item.status?.phase || 'Unknown';
            const containerStatuses = item.status?.containerStatuses || [];
            const readyContainers = containerStatuses.filter(cs => cs.ready).length;
            const totalContainers = containerStatuses.length;
            const readyStatus = `${readyContainers}/${totalContainers}`;
            const restarts = containerStatuses.reduce((sum, cs) => sum + (cs.restartCount || 0), 0);
            
            row.innerHTML = `
                <td>${item.metadata.namespace}</td>
                <td>${item.metadata.name}</td>
                <td>${readyStatus}</td>
                <td>${getStatusIcon(status)} ${status}</td>
                <td>${restarts}</td>
                <td>${getAge(item.metadata.creationTimestamp)}</td>
                <td>
                    <div class="action-menu">
                        <button class="action-button" data-resource="${resourceType}" data-name="${item.metadata.name}" data-namespace="${item.metadata.namespace}">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                </td>
            `;
        } else if (resourceType === 'services') {
            // Service-specific columns
            const ports = item.spec?.ports?.map(port => `${port.port}/${port.protocol}`).join(', ') || '';
            
            row.innerHTML = `
                <td>${item.metadata.namespace}</td>
                <td>${item.metadata.name}</td>
                <td>${item.spec?.type || ''}</td>
                <td>${item.spec?.clusterIP || ''}</td>
                <td>${item.status?.loadBalancer?.ingress?.[0]?.ip || ''}</td>
                <td>${ports}</td>
                <td>${getAge(item.metadata.creationTimestamp)}</td>
                <td>
                    <div class="action-menu">
                        <button class="action-button" data-resource="${resourceType}" data-name="${item.metadata.name}" data-namespace="${item.metadata.namespace}">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                </td>
            `;
        } else {
            // Generic handling for other resource types
            row.innerHTML = `
                <td>${item.metadata.namespace}</td>
                <td>${item.metadata.name}</td>
                <td>${getAge(item.metadata.creationTimestamp)}</td>
                <td>
                    <div class="action-menu">
                        <button class="action-button" data-resource="${resourceType}" data-name="${item.metadata.name}" data-namespace="${item.metadata.namespace}">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                    </div>
                </td>
            `;
        }
        
        tableBody.appendChild(row);
    });
    
    // Initialize action menus for new rows
    initializeActionMenus();
}

// Function to initialize action menu dropdowns
function initializeActionMenus() {
    // Remove existing event listeners
    document.querySelectorAll('.action-button').forEach(button => {
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
    });
    
    // Close any open menus when clicking elsewhere
    document.addEventListener('click', function(event) {
        if (!event.target.closest('.action-button') && !event.target.closest('.action-menu-dropdown')) {
            document.querySelectorAll('.action-menu-dropdown').forEach(dropdown => {
                dropdown.classList.remove('show');
            });
        }
    });
    
    // Toggle dropdown on button click
    document.querySelectorAll('.action-button').forEach(button => {
        button.addEventListener('click', function(event) {
            event.stopPropagation();
            
            // Close all other dropdowns
            document.querySelectorAll('.action-menu-dropdown').forEach(dropdown => {
                dropdown.classList.remove('show');
            });
            
            // Create dropdown if it doesn't exist
            let dropdown = this.nextElementSibling;
            if (!dropdown || !dropdown.classList.contains('action-menu-dropdown')) {
                dropdown = document.createElement('div');
                dropdown.className = 'action-menu-dropdown';
                
                const resourceType = this.getAttribute('data-resource');
                const name = this.getAttribute('data-name');
                const namespace = this.getAttribute('data-namespace');
                
                // Add actions based on resource type
                if (resourceType === 'pods') {
                    dropdown.innerHTML = `
                        <div class="action-menu-item" onclick="navigateToExplore('/explore/${namespace}/${name}')">
                            <i class="fas fa-search"></i> Explore
                        </div>
                        <div class="action-menu-item" onclick="runAction('logs', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-file-alt"></i> Logs
                        </div>
                        <div class="action-menu-item" onclick="runAction('delete', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-trash-alt"></i> Delete
                        </div>
                    `;
                } else {
                    dropdown.innerHTML = `
                        <div class="action-menu-item" onclick="runAction('logs', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-file-alt"></i> Logs
                        </div>
                        <div class="action-menu-item" onclick="runAction('delete', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-trash-alt"></i> Delete
                        </div>
                    `;
                }
                
                this.parentNode.appendChild(dropdown);
            }
            
            dropdown.classList.toggle('show');
        });
    });
}

// Function to switch between resource tabs
function switchTab(tabId) {
    // Update tab active states
    document.querySelectorAll('.resource-tab').forEach(tab => {
        if (tab.getAttribute('data-tab') === tabId) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // Update content visibility
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === tabId) {
            pane.classList.add('show', 'active');
        } else {
            pane.classList.remove('show', 'active');
        }
    });
    
    // Load data for the selected tab
    loadResourceData(tabId);
}

// Helper function to get status icon
function getStatusIcon(status) {
    switch (status.toLowerCase()) {
        case 'running':
            return '<i class="fas fa-check-circle status-icon status-running"></i>';
        case 'pending':
            return '<i class="fas fa-clock status-icon status-pending"></i>';
        case 'failed':
            return '<i class="fas fa-times-circle status-icon status-failed"></i>';
        default:
            return '<i class="fas fa-question-circle status-icon status-unknown"></i>';
    }
}

// Helper function to calculate age from timestamp
function getAge(timestamp) {
    if (!timestamp) return '';
    
    const created = new Date(timestamp);
    const now = new Date();
    const diffMs = now - created;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffDays > 0) {
        return `${diffDays}d`;
    } else if (diffHours > 0) {
        return `${diffHours}h`;
    } else {
        return `${diffMinutes}m`;
    }
}

// GitHub update function
function updateFromGithub() {
    const repoUrl = document.getElementById('githubRepoUrl').value;
    const resultDiv = document.getElementById('githubResult');
    
    if (!repoUrl) {
        resultDiv.innerHTML = '<div class="alert alert-warning">Please enter a GitHub repository URL</div>';
        return;
    }
    
    resultDiv.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div> Updating from GitHub...';
    
    fetch('/update_from_github', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repo_url: repoUrl })
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            resultDiv.innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Update successful! You may need to restart the application for changes to take effect.</div>';
        } else {
            resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Error: ${data.message}</div>`;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Error: ${error.message}</div>`;
    });
}

// Refresh application function
function refreshApplication() {
    const resultDiv = document.getElementById('appControlResult');
    resultDiv.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div> Refreshing application...';
    
    fetch('/refresh_application', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            resultDiv.innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Application refreshed successfully!</div>';
            // Reload the page after a brief delay
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } else {
            resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Error: ${data.message}</div>`;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Error: ${error.message}</div>`;
    });
}

// Restart application function
function restartApplication() {
    const resultDiv = document.getElementById('appControlResult');
    
    if (confirm('Are you sure you want to restart the application? This will temporarily disconnect all users.')) {
        resultDiv.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div> Restarting application...';
        
        fetch('/restart', {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                resultDiv.innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Restart initiated. The page will refresh shortly...</div>';
                // Poll for application availability
                checkApplicationStatus(resultDiv);
            } else {
                resultDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Error: ${data.message}</div>`;
            }
        })
        .catch(error => {
            // If we get an error here, it's likely because the server is already restarting
            console.log('Server restarting, waiting for it to come back online...');
            resultDiv.innerHTML = '<div class="alert alert-info"><i class="fas fa-sync-alt fa-spin"></i> Application is restarting. Waiting for it to come back online...</div>';
            // Start polling
            checkApplicationStatus(resultDiv);
        });
    }
}

// Function to poll server status during restart
function checkApplicationStatus(resultDiv) {
    const MAX_ATTEMPTS = 30; // Try for up to 30 seconds
    let attempts = 0;
    
    const checkServer = function() {
        attempts++;
        
        fetch('/health_check', { 
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        })
        .then(response => {
            if (response.ok) {
                // Server is back online!
                resultDiv.innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Application restarted successfully! Refreshing page...</div>';
                
                // Refresh the page after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                // Server responded but with an error
                if (attempts < MAX_ATTEMPTS) {
                    setTimeout(checkServer, 1000);
                } else {
                    handleTimeout(resultDiv);
                }
            }
        })
        .catch(error => {
            // Server is still down, or network error
            if (attempts < MAX_ATTEMPTS) {
                setTimeout(checkServer, 1000);
            } else {
                handleTimeout(resultDiv);
            }
        });
    };
    
    // Function to handle timeout case
    const handleTimeout = function(resultDiv) {
        resultDiv.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i> The application is taking longer than expected to restart.
                <button class="btn btn-sm btn-primary mt-2" onclick="window.location.reload()">
                    Refresh Now
                </button>
            </div>
        `;
    };
    
    // Start polling after a short delay
    setTimeout(checkServer, 2000);
}

// Function to clear the refresh log
function clearRefreshLog() {
    const refreshLog = document.getElementById('refreshLog');
    if (refreshLog) {
        refreshLog.innerHTML = '<div class="text-muted">-- Log will appear here during refresh/restart operations --</div>';
    }
}

// Initialize drop zone for YAML upload
function setupDropZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('yamlFileInput');
    const uploadButton = document.getElementById('uploadYaml');
    
    if (!dropZone || !fileInput) return;
    
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            updateDropZoneThumbnail(dropZone, fileInput.files[0]);
            if (uploadButton) uploadButton.disabled = false;
        }
    });
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-zone-dragover');
    });
    
    ['dragleave', 'dragend'].forEach(type => {
        dropZone.addEventListener(type, () => {
            dropZone.classList.remove('drop-zone-dragover');
        });
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            updateDropZoneThumbnail(dropZone, e.dataTransfer.files[0]);
            if (uploadButton) uploadButton.disabled = false;
        }
        
        dropZone.classList.remove('drop-zone-dragover');
    });
    
    // Add YAML upload functionality
    if (uploadButton) {
        uploadButton.addEventListener('click', function() {
            const file = fileInput.files[0];
            if (file) {
                const formData = new FormData();
                formData.append('file', file);
                
                const resultDiv = document.getElementById('yamlResult');
                if (resultDiv) resultDiv.innerHTML = '<div class="spinner-border text-primary" role="status"></div> Applying YAML...';
                
                fetch('/upload_yaml', {
                    method: 'POST',
                    body: formData
                })
                .then(response => response.json())
                .then(data => {
                    if (resultDiv) {
                        if (data.error) {
                            resultDiv.innerHTML = `<div class="alert alert-danger">${data.error}</div>`;
                        } else {
                            resultDiv.innerHTML = `<div class="alert alert-success">YAML applied successfully!</div><pre>${data.output}</pre>`;
                        }
                    }
                })
                .catch(error => {
                    console.error('Error uploading YAML:', error);
                    if (resultDiv) {
                        resultDiv.innerHTML = `<div class="alert alert-danger">Error uploading YAML: ${error.message}</div>`;
                    }
                });
            }
        });
    }
}

// Update thumbnail for drop zone
function updateDropZoneThumbnail(dropZone, file) {
    const prompt = dropZone.querySelector('.drop-zone__prompt');
    if (prompt) {
        prompt.style.display = 'none';
    }
    
    let thumbnail = dropZone.querySelector('.drop-zone__thumb');
    if (!thumbnail) {
        thumbnail = document.createElement('div');
        thumbnail.classList.add('drop-zone__thumb');
        dropZone.appendChild(thumbnail);
    }
    
    // Set the file name
    thumbnail.textContent = file.name;
    
    // If it's an image, show preview (optional for YAML files)
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
            thumbnail.style.backgroundImage = `url('${reader.result}')`;
            thumbnail.textContent = '';
        };
        reader.readAsDataURL(file);
    } else {
        thumbnail.style.backgroundImage = '';
    }
}

// Fetch namespaces for events tab
function fetchNamespaces() {
    const namespaceSelect = document.getElementById('namespaceSelect');
    if (!namespaceSelect) return;
    
    fetch('/get_namespaces')
        .then(response => response.json())
        .then(data => {
            if (data.namespaces) {
                // Clear existing options except the first one
                while (namespaceSelect.options.length > 1) {
                    namespaceSelect.remove(1);
                }
                
                // Add namespaces
                data.namespaces.forEach(namespace => {
                    const option = document.createElement('option');
                    option.value = namespace;
                    option.textContent = namespace;
                    namespaceSelect.appendChild(option);
                });
                
                // Set up event listener for selection changes
                if (!namespaceSelect.hasEventListener) {
                    namespaceSelect.addEventListener('change', function() {
                        if (this.value) {
                            fetchEventsByNamespace(this.value);
                        }
                    });
                    namespaceSelect.hasEventListener = true;
                }
            }
        })
        .catch(error => {
            console.error('Error fetching namespaces:', error);
        });
}

// Fetch events for a specific namespace
function fetchEventsByNamespace(namespace) {
    const eventsLoading = document.getElementById('eventsLoading');
    const eventsTable = document.getElementById('eventsTable');
    
    if (eventsLoading) eventsLoading.style.display = 'flex';
    if (eventsTable) eventsTable.style.display = 'none';
    
    fetch('/get_events', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `namespace=${namespace}`
    })
    .then(response => response.json())
    .then(data => {
        // Assuming the response has events in a similar format to resources
        if (eventsLoading) eventsLoading.style.display = 'none';
        if (eventsTable) {
            eventsTable.style.display = 'table';
            const tbody = eventsTable.querySelector('tbody');
            if (tbody && data.events) {
                tbody.innerHTML = '';
                data.events.forEach(event => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${event.namespace || namespace}</td>
                        <td>${event.type || '-'}</td>
                        <td>${event.reason || '-'}</td>
                        <td>${event.object || '-'}</td>
                        <td>${event.message || '-'}</td>
                        <td>${event.age || '-'}</td>
                    `;
                    tbody.appendChild(row);
                });
                
                if (data.events.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center">No events found in namespace ${namespace}</td></tr>`;
                }
            } else {
                const tbody = eventsTable.querySelector('tbody');
                if (tbody) {
                    tbody.innerHTML = `<tr><td colspan="6" class="text-center">No events data available</td></tr>`;
                }
            }
        }
    })
    .catch(error => {
        console.error('Error fetching events:', error);
        if (eventsLoading) eventsLoading.style.display = 'none';
        if (eventsTable) {
            eventsTable.style.display = 'table';
            const tbody = eventsTable.querySelector('tbody');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error loading events: ${error.message}</td></tr>`;
            }
        }
    });
}

// Check Git availability for settings page
function checkGitAvailability() {
    fetch('/git_status')
        .then(response => response.json())
        .then(data => {
            if (!data.available) {
                // Show a warning if Git is not available
                const githubResult = document.getElementById('githubResult');
                if (githubResult) {
                    githubResult.innerHTML = `
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle"></i> Git functionality is not available.
                            <p>Please ensure git is installed on the server and properly configured.</p>
                        </div>
                    `;
                }
                
                // Disable Git-related buttons
                const updateFromGithubBtn = document.getElementById('updateFromGithub');
                if (updateFromGithubBtn) updateFromGithubBtn.disabled = true;
            }
        })
        .catch(error => {
            console.error('Error checking Git availability:', error);
        });
}

// Add resource controls to resource tabs
function initializeResourceControls() {
    const resourceTabs = document.querySelectorAll('.resource-tab');
    resourceTabs.forEach(tab => {
        const resourceType = tab.getAttribute('data-tab');
        // Set up event listener if not already set
        if (!tab.hasClickListener) {
            tab.addEventListener('click', function() {
                // Only fetch data if not already loaded
                if (!window.loadedResources || !window.loadedResources[resourceType]) {
                    loadResourceData(resourceType);
                }
            });
            tab.hasClickListener = true;
        }
    });

    // Set up refresh button
    const refreshBtn = document.getElementById('refreshTableBtn');
    if (refreshBtn && !refreshBtn.hasClickListener) {
        refreshBtn.addEventListener('click', function() {
            const activeTab = document.querySelector('.custom-tab.active');
            if (activeTab) {
                const resourceType = activeTab.getAttribute('data-tab');
                // Force refresh by clearing the cached data
                if (window.loadedResources) {
                    delete window.loadedResources[resourceType];
                }
                loadResourceData(resourceType);
            }
        });
        refreshBtn.hasClickListener = true;
    }

    // Set up search input
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput && !searchInput.hasInputListener) {
        searchInput.addEventListener('input', function() {
            filterResourceTable(this.value);
        });
        searchInput.hasInputListener = true;
    }
}

// Initialize the application
function initializeApp() {
    // Track loaded resources to avoid unnecessary reloading
    window.loadedResources = window.loadedResources || {};
    
    // Initialize components
    initializeResourceControls();
    setupDropZone();
    fetchNamespaces();
    checkGitAvailability();
    
    // Set up Socket.IO event listeners for refresh log
    if (window.app && window.app.socket) {
        const refreshLog = document.getElementById('refreshLog');
        if (refreshLog) {
            window.app.socket.on('refresh_log', function(data) {
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
                
                logEntry.innerHTML = `[${timestamp}] ${data.message}`;
                refreshLog.appendChild(logEntry);
                
                // Auto-scroll to the bottom
                refreshLog.scrollTop = refreshLog.scrollHeight;
            });
        }
    } else {
        console.warn('Socket.IO not available for event listeners');
    }
}

// Utility - Capitalize first letter
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    
    // Set up page visibility change detection
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            // Check if the active tab needs to be refreshed
            const activeTab = document.querySelector('.custom-tab.active');
            if (activeTab) {
                const resourceType = activeTab.getAttribute('data-tab');
                // Only refresh if we haven't loaded this resource yet
                if (!window.loadedResources || !window.loadedResources[resourceType]) {
                    loadResourceData(resourceType);
                }
            }
        }
    });
}); 