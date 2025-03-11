// HPE Private Cloud AI Resource Manager - Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Initialize dashboard metrics
    updateDashboardMetrics();
    
    // Initialize sidebar toggle
    initializeSidebar();
    
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
});

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

// Function to initialize sidebar functionality
function initializeSidebar() {
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', function() {
            sidebar.classList.toggle('sidebar-collapsed');
            mainContent.classList.toggle('main-content-expanded');
        });
    }
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
                        <div class="action-menu-item" onclick="runAction('describe', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-info-circle"></i> Describe
                        </div>
                        <div class="action-menu-item" onclick="runAction('logs', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-file-alt"></i> Logs
                        </div>
                        <div class="action-menu-item" onclick="runAction('exec', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-terminal"></i> Exec (ps)
                        </div>
                        <div class="action-menu-item" onclick="runAction('delete', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-trash-alt"></i> Delete
                        </div>
                    `;
                } else {
                    dropdown.innerHTML = `
                        <div class="action-menu-item" onclick="runAction('describe', '${resourceType}', '${namespace}', '${name}')">
                            <i class="fas fa-info-circle"></i> Describe
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