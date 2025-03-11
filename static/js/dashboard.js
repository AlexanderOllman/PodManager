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
        } else {
            console.error('Invalid data format received');
        }
        
        if (loadingElement) loadingElement.style.display = 'none';
        if (tableElement) tableElement.style.display = 'table';
        
        // Apply search filter if it exists
        const searchInput = document.getElementById('resourceSearchInput');
        if (searchInput && searchInput.value.trim() !== '') {
            filterResourceTable(searchInput.value);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        if (loadingElement) loadingElement.style.display = 'none';
    });
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