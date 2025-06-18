// resource_rendering.js

// Main function to render the current page of resources for a given type
function renderCurrentPage(resourceType) {
    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData || !resourceData.items) {
        console.error(`No data available for ${resourceType} to render.`);
        const tableBody = selectTableBody(resourceType);
        if (tableBody) {
            const colSpan = tableBody.closest('table')?.querySelector('thead tr')?.children.length || 7;
            tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i> No data to display for ${resourceType}.</td></tr>`;
        }
        return;
    }

    // If on the 'Resources' tab, call the full page renderer
    if (window.app.state.navigation?.activeTab === 'resources') {
        if (typeof renderResourcePage === 'function') {
             renderResourcePage(resourceType); // This now renders all items from resource_explorer.js
        } else {
             console.warn('renderResourcePage function not found for resources tab.');
        }
        return;
    }

    // For other tabs (home page resource views), use the original load-more rendering logic
    renderLoadMorePage(resourceType, resourceData);
}

// Renders a page of resources with a "Load More" button (original logic for home tabs)
function renderLoadMorePage(resourceType, resourceData) {
    const { items, totalCount, pageSize } = resourceData;
    const tableBody = selectTableBody(resourceType);
    const tableContainer = selectTableContainer(resourceType);

    if (!tableBody) {
        console.error(`Table body not found for ${resourceType} in renderLoadMorePage`);
        return;
    }
    if (!tableContainer) {
        console.error(`Table container not found for ${resourceType} in renderLoadMorePage`);
        return;
    }

    // Clear existing "Load More" button and count info
    const existingLoadMore = tableContainer.querySelector('.load-more-container');
    if (existingLoadMore) existingLoadMore.remove();
    const existingCountInfo = tableContainer.querySelector('.count-info');
    if (existingCountInfo) existingCountInfo.remove();

    // If it's the first load for this set of items (e.g., not appending), clear the table body
    // This assumes that 'items' contains ALL currently loaded items for the load-more view.
    if (resourceData.loadedPages && resourceData.loadedPages.length === 1 && resourceData.loadedPages[0] === 1) {
        tableBody.innerHTML = ''; 
    }
    
    // If no items at all, show empty state
    if (items.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center text-muted py-4">
                    <i class="fas fa-info-circle me-2"></i> No ${resourceType} found.
                </td>
            </tr>
        `;
        tableContainer.style.opacity = '1';
        return;
    }

    // Add count message
    const countInfo = document.createElement('div');
    countInfo.className = 'text-muted small mb-2 count-info';
    countInfo.innerHTML = `Showing ${items.length} of ${totalCount || items.length} ${resourceType}`;
    if (tableContainer.firstChild) {
        tableContainer.insertBefore(countInfo, tableContainer.firstChild);
    } else {
        tableContainer.appendChild(countInfo);
    }

    // Render items (append if items are already there, otherwise set)
    // For simplicity, this example will re-render all current items.
    // A more optimized version would only append new items.
    tableBody.innerHTML = ''; // Clear and re-render all current items for load-more view
    items.forEach(item => {
        const row = createResourceRow(resourceType, item);
        if (row) tableBody.appendChild(row);
    });

    // Add "Load More" button if needed
    if (items.length < (totalCount || items.length)) {
        const loadMoreContainer = document.createElement('div');
        loadMoreContainer.className = 'load-more-container text-center mt-3 mb-2';
        loadMoreContainer.innerHTML = `
            <button class="btn btn-outline-primary load-more-btn">
                <i class="fas fa-chevron-down me-1"></i> 
                Load More (showing ${items.length} of ${totalCount})
            </button>
        `;
        tableContainer.appendChild(loadMoreContainer);
        
        const loadMoreBtn = loadMoreContainer.querySelector('.load-more-btn');
        loadMoreBtn.addEventListener('click', () => {
            const nextPage = Math.ceil(items.length / pageSize) + 1;
            loadMoreBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> Loading...';
            loadMoreBtn.disabled = true;
            
            fetchResourceData(resourceType, 'all', false, nextPage)
                .catch(err => { console.error("Error fetching next page for load more:", err); /* handle error */ })
                .finally(() => { /* Button state managed by re-render */ });
        });
    }

    tableContainer.style.opacity = '1';
    setTimeout(initializeAllDropdowns, 100);
}

// Helper to get an icon for a resource kind
function getResourceIcon(kind) {
    const kindLower = kind.toLowerCase();
    const iconMap = {
        'pod': 'fas fa-box',
        'pods': 'fas fa-box',
        'deployment': 'fas fa-layer-group',
        'deployments': 'fas fa-layer-group',
        'service': 'fas fa-network-wired',
        'services': 'fas fa-network-wired',
        'node': 'fas fa-server',
        'nodes': 'fas fa-server',
        'namespace': 'fas fa-project-diagram',
        'namespaces': 'fas fa-project-diagram',
        'job': 'fas fa-tasks',
        'jobs': 'fas fa-tasks',
        'statefulset': 'fas fa-database',
        'statefulsets': 'fas fa-database',
        'daemonset': 'fas fa-cogs',
        'daemonsets': 'fas fa-cogs',
        'replicaset': 'fas fa-copy',
        'replicasets': 'fas fa-copy',
        'persistentvolumeclaim': 'fas fa-hdd',
        'persistentvolumeclaims': 'fas fa-hdd',
        'configmap': 'fas fa-file-alt',
        'configmaps': 'fas fa-file-alt',
        'secret': 'fas fa-key',
        'secrets': 'fas fa-key',
        'inferenceservice': 'fas fa-bolt',
        'inferenceservices': 'fas fa-bolt',
        'default': 'fas fa-cube'
    };
    return iconMap[kindLower] || iconMap['default'];
}

// Helper to get a color for a resource status
function getStatusColor(status) {
    if (!status) return '#6c757d'; // grey for unknown
    const lowerStatus = status.toLowerCase();
    switch (lowerStatus) {
        case 'running':
        case 'succeeded':
        case 'ready':
        case 'available':
        case 'bound':
            return '#28a745'; // green
        case 'pending':
        case 'progressing':
        case 'containercreating':
            return '#ffc107'; // yellow
        case 'failed':
        case 'error':
        case 'notready':
            return '#dc3545'; // red
        default:
            return '#6c757d'; // grey
    }
}

// Formats a Kubernetes timestamp into a human-readable age string
function formatAge(creationTimestamp) {
    if (!creationTimestamp) return '-';
    try {
        const createdDate = new Date(creationTimestamp);
        const now = new Date();
        const diff = now.getTime() - createdDate.getTime();

        if (diff < 0) return 'in the future';

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d`;
        if (hours > 0) return `${hours}h`;
        if (minutes > 0) return `${minutes}m`;
        return `${seconds}s`;
    } catch (e) {
        console.error('Could not parse timestamp:', creationTimestamp, e);
        return '-';
    }
}

// Creates a single table row for a given resource item
function createResourceRow(resourceType, item) {
    const row = document.createElement('tr');
    let content = '';

    // Common metadata
    const namespace = item.metadata?.namespace || '-';
    const name = item.metadata?.name || '-';
    const iconClass = getResourceIcon(item.kind || resourceType);
    const actionButton = typeof createActionButton === 'function' ? createActionButton(resourceType, namespace, name) : '-';
    const age = formatAge(item.metadata?.creationTimestamp);

    // Icon and Name cell
    const nameCell = `
        <td class="resource-name-cell">
            <i class="${iconClass} resource-icon"></i>
            <span>${name}</span>
        </td>
    `;

    switch (resourceType) {
        case 'pods':
            const podResources = typeof getResourceUsage === 'function' ? getResourceUsage(item) : { cpu: '-', gpu: '-', memory: '-' };
            const podStatus = getResourceStatus(resourceType, item);
            const podStatusColor = getStatusColor(podStatus);

            content = `
                <td>${namespace}</td>
                ${nameCell}
                <td>
                    <span class="status-dot" style="background-color: ${podStatusColor};"></span>
                    ${podStatus}
                </td>
                <td class="resource-cell cpu-cell">${podResources.cpu}</td>
                <td class="resource-cell gpu-cell">${podResources.gpu}</td>
                <td class="resource-cell memory-cell">${podResources.memory}</td>
                <td>${age}</td>
                <td>${actionButton}</td>
            `;
            break;
        case 'services':
            const serviceType = item.spec?.type || 'ClusterIP';
            const clusterIP = item.spec?.clusterIP || '-';
            const externalIP = item.status?.loadBalancer?.ingress?.[0]?.ip || '-';
            let ports = '-';
            if (item.spec?.ports && item.spec.ports.length > 0) {
                ports = item.spec.ports.map(p => `${p.port}${p.targetPort ? ':'+p.targetPort : ''}/${p.protocol || 'TCP'}`).join(', ');
            }
            content = `
                <td>${namespace}</td>
                ${nameCell}
                <td>${serviceType}</td>
                <td>${clusterIP}</td>
                <td>${externalIP}</td>
                <td>${ports}</td>
                <td>${age}</td>
                <td>${actionButton}</td>
            `;
            break;
        case 'inferenceservices':
            const isvcStatus = getResourceStatus(resourceType, item);
            const isvcStatusColor = getStatusColor(isvcStatus);
            let url = '-';
            if (item.status?.url) {
                url = `<a href="${item.status.url}" target="_blank">${item.status.url}</a>`;
            }
            const isvcResources = typeof getResourceUsage === 'function' ? getResourceUsage(item) : { cpu: '-', gpu: '-', memory: '-' };
            content = `
                <td>${namespace}</td>
                ${nameCell}
                <td>${url}</td>
                <td>
                    <span class="status-dot" style="background-color: ${isvcStatusColor};"></span>
                    ${isvcStatus}
                </td>
                <td>${isvcResources.cpu}</td>
                <td>${isvcResources.gpu}</td>
                <td>${isvcResources.memory}</td>
                <td>${age}</td>
                <td>${actionButton}</td>
            `;
            break;
        case 'deployments':
            const readyReplicas = item.status?.readyReplicas || 0;
            const totalReplicas = item.status?.replicas || 0;
            const deploymentStatus = getResourceStatus(resourceType, item);
            const deploymentStatusColor = getStatusColor(deploymentStatus);
            const depResources = typeof getResourceUsage === 'function' ? getResourceUsage(item) : { cpu: '-', memory: '-' }; // No GPU for deployments typically
            content = `
                <td>${namespace}</td>
                ${nameCell}
                <td>${readyReplicas}/${totalReplicas}</td>
                <td>
                    <span class="status-dot" style="background-color: ${deploymentStatusColor};"></span>
                    ${deploymentStatus}
                </td>
                <td>${depResources.cpu}</td>
                <td>${depResources.memory}</td>
                <td>${age}</td>
                <td>${actionButton}</td>
            `;
            break;
        case 'configmaps':
            const dataCount = Object.keys(item.data || {}).length;
            content = `
                <td>${namespace}</td>
                ${nameCell}
                <td>${dataCount} items</td>
                <td>${age}</td>
                <td>${actionButton}</td>
            `;
            break;
        case 'secrets':
            const secretType = item.type || 'Opaque';
            const secretDataCount = Object.keys(item.data || {}).length;
            content = `
                <td>${namespace}</td>
                ${nameCell}
                <td>${secretType}</td>
                <td>${secretDataCount} items</td>
                <td>${age}</td>
                <td>${actionButton}</td>
            `;
            break;
        default:
            console.warn(`Unhandled resource type for row creation: ${resourceType}`);
            content = `
                <td>${namespace}</td>
                ${nameCell}
                <td colspan="5">Details not available for this resource type.</td>
                <td>${actionButton}</td>
            `;
            break;
    }
    row.innerHTML = content;
    return row;
}

// Helper to select the correct table body
function selectTableBody(resourceType) {
    if (window.app.state.navigation?.activeTab === 'resources') {
        return document.getElementById('resourcesTableBody');
    } else {
        return document.querySelector(`#${resourceType}Table tbody`);
    }
}

// Helper to select the correct table container
function selectTableContainer(resourceType) {
    if (window.app.state.navigation?.activeTab === 'resources') {
        return document.getElementById('resourcesTableContainer');
    } else {
        return document.getElementById(`${resourceType}TableContainer`);
    }
}

// Helper function to calculate and format age of a resource
function getAge(creationTimestamp) {
    if (!creationTimestamp) {
        return '-';
    }
    const age = Date.now() - new Date(creationTimestamp);
    const seconds = Math.floor(age / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d`;
    }
    if (hours > 0) {
        return `${hours}h`;
    }
    if (minutes > 0) {
        return `${minutes}m`;
    }
    return `${seconds}s`;
}

// Helper function to get status icon based on phase or status text
function getStatusIcon(status) {
    switch(status.toLowerCase()) {
        case 'running':
        case 'succeeded':
        case 'available':
        case 'ready':
        case 'bound':
            return '<i class="fas fa-check-circle text-success me-2"></i>';
        case 'pending':
        case 'progressing':
            return '<i class="fas fa-hourglass-half text-warning me-2"></i>';
        case 'failed':
        case 'error':
            return '<i class="fas fa-exclamation-circle text-danger me-2"></i>';
        case 'unknown':
        default:
            return '<i class="fas fa-question-circle text-muted me-2"></i>';
    }
}

// Initialize all Bootstrap dropdowns on the page or in a container
function initializeAllDropdowns() {
    try {
        const dropdownElementList = [].slice.call(document.querySelectorAll('.action-dropdown .dropdown-toggle'));
        dropdownElementList.map(function(dropdownToggleEl) {
            // Ensure no old dropdown instance is attached before creating a new one
            const existingInstance = bootstrap.Dropdown.getInstance(dropdownToggleEl);
            if (existingInstance) {
                // No direct re-init, if issues arise, might need to dispose and recreate
            }
            return new bootstrap.Dropdown(dropdownToggleEl);
        });
    } catch(e) {
        console.warn("Error initializing dropdowns:", e);
    }
}

// Helper function to calculate resource usage (CPU, GPU, Memory)
function getResourceUsage(item) {
    let cpu = 0;
    let gpu = 0;
    let totalMemoryMi = 0; // Accumulate memory in Mi

    function standardizeAndSumMemory(memStr) {
        if (!memStr) return 0;
        memStr = String(memStr).trim();
        let value = parseFloat(memStr);
        if (isNaN(value)) return 0;

        if (memStr.endsWith('Ki')) return value / 1024;
        if (memStr.endsWith('Mi')) return value;
        if (memStr.endsWith('Gi')) return value * 1024;
        if (memStr.endsWith('Ti')) return value * 1024 * 1024;
        if (memStr.endsWith('Pi')) return value * 1024 * 1024 * 1024;
        // Assuming bytes if no unit, convert to Mi
        if (/^\d+$/.test(memStr)) return value / (1024 * 1024);
        return 0; // Unknown unit or format
    }

    if (item.spec && item.spec.containers) {
        item.spec.containers.forEach(container => {
            if (container.resources && container.resources.requests) {
                const requests = container.resources.requests;
                if (requests.cpu) {
                    const cpuRequest = String(requests.cpu);
                    if (cpuRequest.endsWith('m')) {
                        cpu += parseInt(cpuRequest.slice(0, -1)) / 1000;
                    } else {
                        cpu += parseFloat(cpuRequest);
                    }
                }
                if (requests['nvidia.com/gpu']) {
                    gpu += parseInt(requests['nvidia.com/gpu']);
                } else if (requests.gpu) { // Generic gpu request
                    gpu += parseInt(requests.gpu);
                }
                if (requests.memory) {
                    totalMemoryMi += standardizeAndSumMemory(requests.memory);
                }
            }
        });
    }
    // For non-pod items that might have resources directly in spec.resources.requests
    else if (item.spec && item.spec.resources && item.spec.resources.requests) {
        const requests = item.spec.resources.requests;
        if (requests.cpu) {
            const cpuRequest = String(requests.cpu);
            if (cpuRequest.endsWith('m')) {
                cpu += parseInt(cpuRequest.slice(0, -1)) / 1000;
            } else {
                cpu += parseFloat(cpuRequest);
            }
        }
        if (requests['nvidia.com/gpu']) {
            gpu += parseInt(requests['nvidia.com/gpu']);
        } else if (requests.gpu) {
            gpu += parseInt(requests.gpu);
        }
        if (requests.memory) {
            totalMemoryMi += standardizeAndSumMemory(requests.memory);
        }
    }

    return {
        cpu: cpu > 0 ? cpu.toFixed(2) : '-', // Show '-' if 0
        gpu: gpu > 0 ? gpu.toString() : '-',
        memory: totalMemoryMi > 0 ? `${totalMemoryMi.toFixed(1)}Mi` : '-'
    };
} 