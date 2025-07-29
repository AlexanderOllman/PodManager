document.addEventListener('DOMContentLoaded', function() {

    function injectTimestampElement() {
        // Check if the element already exists
        if (document.getElementById('db-last-updated-time')) {
            return; // Already injected
        }

        const settingsView = document.getElementById('settings-view');
        if (!settingsView) return;

        // Find the h4 element with the text "Database Management"
        const h4Elements = settingsView.getElementsByTagName('h4');
        let dbManagementHeader = null;
        for (let h4 of h4Elements) {
            if (h4.textContent.trim() === 'Database Management') {
                dbManagementHeader = h4;
                break;
            }
        }

        if (dbManagementHeader) {
            const p = document.createElement('p');
            p.className = 'text-muted small mb-2';
            p.innerHTML = 'Last refreshed: <span id="db-last-updated-time">Loading...</span>';
            dbManagementHeader.parentNode.insertBefore(p, dbManagementHeader.nextSibling);
        }
    }

    function updateDatabaseTimestamp() {
        const timestampSpan = document.getElementById('db-last-updated-time');
        if (!timestampSpan) {
            // Element might not be injected yet, try to inject it now
            injectTimestampElement();
            // And try to find it again
            const newTimestampSpan = document.getElementById('db-last-updated-time');
            if(!newTimestampSpan) {
                console.log("Could not find or create element #db-last-updated-time.");
                return;
            }
            updateTimestamp(newTimestampSpan);
        } else {
             updateTimestamp(timestampSpan);
        }
    }
    
    function updateTimestamp(element) {
        element.textContent = 'Loading...';
        fetch('/api/database/last_updated')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.error) {
                    console.error('Error fetching database timestamp:', data.error);
                    element.textContent = 'Error';
                    return;
                }

                const lastUpdatedDate = new Date(data.last_updated_iso);
                const options = {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: true
                };
                element.textContent = lastUpdatedDate.toLocaleString(undefined, options);
            })
            .catch(error => {
                console.error('Failed to fetch or parse database timestamp:', error);
                element.textContent = 'Unavailable';
            });
    }

    function loadNodes() {
        const nodesContainer = document.getElementById('nodesContainer');
        const nodesLoading = document.getElementById('nodesLoading');
        const nodesError = document.getElementById('nodesError');
        
        if (!nodesContainer) return;
        
        // Show loading state
        nodesLoading.style.display = 'block';
        nodesError.style.display = 'none';
        nodesContainer.innerHTML = '';
        
        fetch('/api/nodes')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(nodes => {
                nodesLoading.style.display = 'none';
                
                if (nodes.length === 0) {
                    nodesContainer.innerHTML = '<div class="col-12"><p class="text-muted text-center">No nodes found in the cluster.</p></div>';
                    return;
                }
                
                renderNodeCards(nodes);
            })
            .catch(error => {
                console.error('Error loading nodes:', error);
                nodesLoading.style.display = 'none';
                nodesError.style.display = 'block';
                document.getElementById('nodesErrorMessage').textContent = `Error loading nodes: ${error.message}`;
            });
    }
    
    function renderNodeCards(nodes) {
        const nodesContainer = document.getElementById('nodesContainer');
        
        nodes.forEach(node => {
            const nodeCard = createNodeCard(node);
            nodesContainer.appendChild(nodeCard);
        });
    }
    
    function createNodeCard(node) {
        const col = document.createElement('div');
        col.className = 'col-lg-4 col-md-6 col-sm-12 mb-4';
        
        const statusClass = node.status === 'Ready' ? 'ready' : 'not-ready';
        const gpuDisplay = node.gpu_count > 0 ? node.gpu_count : 'None';
        
        col.innerHTML = `
            <div class="node-card" onclick="showNodeDetails('${node.name}')">
                <div class="node-header">
                    <h5 class="node-name">${node.name}</h5>
                    <span class="node-status ${statusClass}">${node.status}</span>
                </div>
                <div class="hardware-specs">
                    <div class="spec-row">
                        <span class="spec-label">
                            <i class="fas fa-microchip spec-icon"></i>CPU Cores
                        </span>
                        <span class="spec-value">${node.cpu_cores}</span>
                    </div>
                    <div class="spec-row">
                        <span class="spec-label">
                            <i class="fas fa-memory spec-icon"></i>Memory
                        </span>
                        <span class="spec-value">${node.memory_gb} GB</span>
                    </div>
                    <div class="spec-row">
                        <span class="spec-label">
                            <i class="fas fa-desktop spec-icon"></i>GPUs
                        </span>
                        <span class="spec-value">${gpuDisplay}</span>
                    </div>
                    <div class="spec-row">
                        <span class="spec-label">
                            <i class="fas fa-box spec-icon"></i>Max Pods
                        </span>
                        <span class="spec-value">${node.allocatable_pods}</span>
                    </div>
                    <div class="spec-row">
                        <span class="spec-label">
                            <i class="fas fa-info-circle spec-icon"></i>Kubelet
                        </span>
                        <span class="spec-value">${node.kubelet_version}</span>
                    </div>
                </div>
                <div class="node-age">
                    <i class="fas fa-clock me-1"></i>Age: ${node.age}
                </div>
            </div>
        `;
        
        return col;
    }
    
    // Make showNodeDetails available globally
    window.showNodeDetails = function(nodeName) {
        const modal = new bootstrap.Modal(document.getElementById('nodeDetailsModal'));
        const modalTitle = document.getElementById('nodeDetailsModalLabel');
        const loadingDiv = document.getElementById('nodeDetailsLoading');
        const contentDiv = document.getElementById('nodeDetailsContent');
        const errorDiv = document.getElementById('nodeDetailsError');
        
        // Set modal title
        modalTitle.innerHTML = `<i class="fas fa-server me-2"></i>Node Details: ${nodeName}`;
        
        // Show loading state
        loadingDiv.style.display = 'block';
        contentDiv.innerHTML = '';
        errorDiv.style.display = 'none';
        
        // Show modal
        modal.show();
        
        // Fetch node details
        fetch(`/api/nodes/${nodeName}/details`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(nodeData => {
                loadingDiv.style.display = 'none';
                renderNodeDetails(nodeData);
            })
            .catch(error => {
                console.error('Error loading node details:', error);
                loadingDiv.style.display = 'none';
                errorDiv.style.display = 'block';
                document.getElementById('nodeDetailsErrorMessage').textContent = `Error loading node details: ${error.message}`;
            });
    };
    
    function renderNodeDetails(node) {
        const contentDiv = document.getElementById('nodeDetailsContent');
        const metadata = node.metadata || {};
        const status = node.status || {};
        const spec = node.spec || {};
        const capacity = status.capacity || {};
        const allocatable = status.allocatable || {};
        const nodeInfo = status.nodeInfo || {};
        const conditions = status.conditions || [];
        
        contentDiv.innerHTML = `
            <div class="node-details-section">
                <h5>Basic Information</h5>
                <div class="details-grid">
                    <div class="details-item">
                        <span class="label">Name:</span>
                        <span class="value">${metadata.name || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Created:</span>
                        <span class="value">${metadata.creationTimestamp ? new Date(metadata.creationTimestamp).toLocaleString() : 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Kubelet Version:</span>
                        <span class="value">${nodeInfo.kubeletVersion || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">OS Image:</span>
                        <span class="value">${nodeInfo.osImage || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Kernel Version:</span>
                        <span class="value">${nodeInfo.kernelVersion || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Container Runtime:</span>
                        <span class="value">${nodeInfo.containerRuntimeVersion || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Architecture:</span>
                        <span class="value">${nodeInfo.architecture || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Operating System:</span>
                        <span class="value">${nodeInfo.operatingSystem || 'N/A'}</span>
                    </div>
                </div>
            </div>
            
            <div class="node-details-section">
                <h5>Resource Capacity & Allocation</h5>
                <div class="details-grid">
                    <div class="details-item">
                        <span class="label">CPU Capacity:</span>
                        <span class="value">${capacity.cpu || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">CPU Allocatable:</span>
                        <span class="value">${allocatable.cpu || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Memory Capacity:</span>
                        <span class="value">${capacity.memory || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Memory Allocatable:</span>
                        <span class="value">${allocatable.memory || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Pod Capacity:</span>
                        <span class="value">${capacity.pods || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Pod Allocatable:</span>
                        <span class="value">${allocatable.pods || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Ephemeral Storage:</span>
                        <span class="value">${capacity['ephemeral-storage'] || 'N/A'}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">GPU Count:</span>
                        <span class="value">${capacity['nvidia.com/gpu'] || '0'}</span>
                    </div>
                </div>
            </div>
            
            <div class="node-details-section">
                <h5>Network Information</h5>
                <div class="details-grid">
                    <div class="details-item">
                        <span class="label">Internal IP:</span>
                        <span class="value">${getNodeAddress(status.addresses, 'InternalIP')}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">External IP:</span>
                        <span class="value">${getNodeAddress(status.addresses, 'ExternalIP')}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Hostname:</span>
                        <span class="value">${getNodeAddress(status.addresses, 'Hostname')}</span>
                    </div>
                    <div class="details-item">
                        <span class="label">Pod CIDR:</span>
                        <span class="value">${spec.podCIDR || 'N/A'}</span>
                    </div>
                </div>
            </div>
            
            ${renderNodeConditions(conditions)}
            
            ${renderNodeLabels(metadata.labels)}
            
            ${renderNodeTaints(spec.taints)}
        `;
    }
    
    function getNodeAddress(addresses, type) {
        if (!addresses) return 'N/A';
        const address = addresses.find(addr => addr.type === type);
        return address ? address.address : 'N/A';
    }
    
    function renderNodeConditions(conditions) {
        if (!conditions || conditions.length === 0) {
            return '<div class="node-details-section"><h5>Conditions</h5><p class="text-muted">No conditions reported.</p></div>';
        }
        
        const conditionsHtml = conditions.map(condition => {
            const statusClass = condition.status.toLowerCase();
            return `
                <tr>
                    <td>${condition.type}</td>
                    <td class="condition-status ${statusClass}">${condition.status}</td>
                    <td>${condition.reason || 'N/A'}</td>
                    <td>${condition.lastTransitionTime ? new Date(condition.lastTransitionTime).toLocaleString() : 'N/A'}</td>
                    <td title="${condition.message || ''}">${condition.message ? (condition.message.length > 50 ? condition.message.substring(0, 50) + '...' : condition.message) : 'N/A'}</td>
                </tr>
            `;
        }).join('');
        
        return `
            <div class="node-details-section">
                <h5>Node Conditions</h5>
                <table class="table table-sm conditions-table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Reason</th>
                            <th>Last Transition</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${conditionsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    function renderNodeLabels(labels) {
        if (!labels || Object.keys(labels).length === 0) {
            return '<div class="node-details-section"><h5>Labels</h5><p class="text-muted">No labels found.</p></div>';
        }
        
        const labelsHtml = Object.entries(labels).map(([key, value]) => {
            return `<span class="label-badge">${key}: ${value}</span>`;
        }).join('');
        
        return `
            <div class="node-details-section">
                <h5>Labels</h5>
                <div class="labels-container">
                    ${labelsHtml}
                </div>
            </div>
        `;
    }
    
    function renderNodeTaints(taints) {
        if (!taints || taints.length === 0) {
            return '<div class="node-details-section"><h5>Taints</h5><p class="text-muted">No taints applied.</p></div>';
        }
        
        const taintsHtml = taints.map(taint => {
            return `
                <tr>
                    <td>${taint.key}</td>
                    <td>${taint.value || 'N/A'}</td>
                    <td>${taint.effect}</td>
                </tr>
            `;
        }).join('');
        
        return `
            <div class="node-details-section">
                <h5>Taints</h5>
                <table class="table table-sm">
                    <thead>
                        <tr>
                            <th>Key</th>
                            <th>Value</th>
                            <th>Effect</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${taintsHtml}
                    </tbody>
                </table>
            </div>
        `;
    }

    function handleSettingsViewVisible() {
        injectTimestampElement();
        updateDatabaseTimestamp();
        loadNodes();
    }

    const settingsView = document.getElementById('settings-view');
    if (settingsView) {
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (settingsView.style.display !== 'none') {
                        handleSettingsViewVisible();
                    }
                }
            });
        });

        observer.observe(settingsView, { attributes: true });

        if (settingsView.style.display !== 'none') {
            handleSettingsViewVisible();
        }
    }

    const settingsNavLink = document.querySelector('a.nav-link[data-target="settings-view"], a.nav-link[data-bs-target="#settings"]');
    if (settingsNavLink) {
        settingsNavLink.addEventListener('click', function() {
            setTimeout(handleSettingsViewVisible, 50);
        });
    }
}); 