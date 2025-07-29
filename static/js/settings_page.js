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
        
        // Group nodes by role
        const controlPlaneNodes = [];
        const workerNodes = [];
        
        nodes.forEach(node => {
            const isControlPlane = node.role === 'control-plane';
            
            if (isControlPlane) {
                controlPlaneNodes.push(node);
            } else {
                workerNodes.push(node);
            }
        });
        
        // Clear container
        nodesContainer.innerHTML = '';
        
        // Add Control Plane section
        if (controlPlaneNodes.length > 0) {
            const controlPlaneSection = document.createElement('div');
            controlPlaneSection.className = 'col-12 node-role-section';
            controlPlaneSection.innerHTML = `
                <h5 class="text-muted mb-3">
                    <i class="fas fa-crown me-2"></i>Control Plane Nodes
                </h5>
                <div class="row" id="controlPlaneNodesContainer"></div>
            `;
            nodesContainer.appendChild(controlPlaneSection);
            
            const controlPlaneContainer = document.getElementById('controlPlaneNodesContainer');
            controlPlaneNodes.forEach(node => {
                const nodeCard = createNodeCard(node);
                controlPlaneContainer.appendChild(nodeCard);
            });
        }
        
        // Add Worker section
        if (workerNodes.length > 0) {
            const workerSection = document.createElement('div');
            workerSection.className = 'col-12 node-role-section';
            workerSection.innerHTML = `
                <h5 class="text-muted mb-3">
                    <i class="fas fa-server me-2"></i>Worker Nodes
                </h5>
                <div class="row" id="workerNodesContainer"></div>
            `;
            nodesContainer.appendChild(workerSection);
            
            const workerContainer = document.getElementById('workerNodesContainer');
            workerNodes.forEach(node => {
                const nodeCard = createNodeCard(node);
                workerContainer.appendChild(nodeCard);
            });
        }
    }
    
    function createNodeCard(node) {
        const col = document.createElement('div');
        col.className = 'col-lg-4 col-md-6 col-sm-12 mb-4';
        
        const statusClass = node.status === 'Ready' ? 'ready' : 'not-ready';
        const gpuDisplay = node.gpu_count > 0 ? node.gpu_count : 'None';
        
        // Determine node role for display
        const isControlPlane = node.role === 'control-plane';
        const roleIcon = isControlPlane ? 'fas fa-crown' : 'fas fa-server';
        
        col.innerHTML = `
            <div class="node-card" data-node-name="${node.name}">
                <div class="node-header">
                    <h5 class="node-name">
                        <i class="${roleIcon} me-2" style="color: ${isControlPlane ? '#ffd700' : '#6c757d'};"></i>
                        ${node.name}
                    </h5>
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
        
        // Add click event listener to the card
        const cardElement = col.querySelector('.node-card');
        cardElement.addEventListener('click', function() {
            showNodeDetails(node.name);
        });
        
        return col;
    }
    
    // Make showNodeDetails available globally
    window.showNodeDetails = function(nodeName) {
        console.log('showNodeDetails called for:', nodeName);
        
        // Add more comprehensive modal searching
        let modalElement = document.getElementById('nodeDetailsModal');
        
        if (!modalElement) {
            console.log('Modal not found by ID, searching by class...');
            modalElement = document.querySelector('.node-details-modal');
        }
        
        if (!modalElement) {
            console.log('Modal not found by class, searching by any modal with node details...');
            modalElement = document.querySelector('[id*="nodeDetails"]');
        }
        
        if (!modalElement) {
            console.error('Node details modal not found in DOM');
            console.log('Available modals:', document.querySelectorAll('.modal'));
            console.log('Elements with nodeDetails:', document.querySelectorAll('[id*="nodeDetails"]'));
            console.log('DOM ready state:', document.readyState);
            
            // Try to create the modal dynamically if it doesn't exist
            createModalDynamically();
            return;
        }
        
        console.log('Modal found:', modalElement);
        
        const modalTitle = document.getElementById('nodeDetailsModalLabel');
        const loadingDiv = document.getElementById('nodeDetailsLoading');
        const contentDiv = document.getElementById('nodeDetailsContent');
        const errorDiv = document.getElementById('nodeDetailsError');
        
        // Set modal title
        if (modalTitle) {
            modalTitle.innerHTML = `<i class="fas fa-server me-2"></i>Node Details: ${nodeName}`;
        }
        
        // Show loading state
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (contentDiv) contentDiv.innerHTML = '';
        if (errorDiv) errorDiv.style.display = 'none';
        
        // Initialize and show modal with proper configuration and error handling
        let modal = null;
        
        // First, check if Bootstrap is available
        if (typeof bootstrap === 'undefined' || typeof bootstrap.Modal === 'undefined') {
            console.error('Bootstrap is not loaded or Modal class is not available');
            showModalFallback();
            return;
        }
        
        try {
            // Check if there's already a modal instance
            const existingModal = bootstrap.Modal.getInstance(modalElement);
            if (existingModal) {
                modal = existingModal;
            } else {
                // Create new modal instance with explicit configuration
                modal = new bootstrap.Modal(modalElement, {
                    backdrop: true,
                    keyboard: true,
                    focus: true
                });
            }
            
            // Show the modal
            modal.show();
            
        } catch (error) {
            console.error('Error initializing Bootstrap modal:', error);
            showModalFallback();
            return;
        }
        
        // Fallback modal display function
        function showModalFallback() {
            console.log('Using fallback modal display');
            modalElement.style.display = 'block';
            modalElement.classList.add('show');
            modalElement.setAttribute('aria-hidden', 'false');
            document.body.classList.add('modal-open');
            
            // Create backdrop manually
            let backdrop = document.getElementById('nodeDetailsBackdrop');
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'modal-backdrop fade show';
                backdrop.id = 'nodeDetailsBackdrop';
                document.body.appendChild(backdrop);
            }
            
            // Add manual close handlers for fallback
            const closeModal = () => {
                modalElement.style.display = 'none';
                modalElement.classList.remove('show');
                modalElement.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('modal-open');
                const existingBackdrop = document.getElementById('nodeDetailsBackdrop');
                if (existingBackdrop) {
                    existingBackdrop.remove();
                }
            };
            
            // Close on backdrop click
            backdrop.addEventListener('click', closeModal);
            
            // Close on close button click
            const closeButton = modalElement.querySelector('.btn-close');
            if (closeButton) {
                closeButton.addEventListener('click', closeModal);
            }
            
            // Close on escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                    document.removeEventListener('keydown', handleEscape);
                }
            };
            document.addEventListener('keydown', handleEscape);
        }
        
        // Function to create modal dynamically if not found
        function createModalDynamically() {
            console.log('Creating modal dynamically...');
            const modalHTML = `
                <div class="modal fade node-details-modal" id="nodeDetailsModal" tabindex="-1" aria-labelledby="nodeDetailsModalLabel" aria-hidden="true">
                    <div class="modal-dialog modal-xl">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title" id="nodeDetailsModalLabel">
                                    <i class="fas fa-server me-2"></i>Node Details: ${nodeName}
                                </h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                <div id="nodeDetailsLoading" class="text-center py-4">
                                    <div class="spinner-border text-primary" role="status">
                                        <span class="visually-hidden">Loading node details...</span>
                                    </div>
                                    <p class="mt-2 text-muted">Loading detailed node information...</p>
                                </div>
                                
                                <div id="nodeDetailsContent" class="node-details-content">
                                    <!-- Node details will be populated here -->
                                </div>
                                
                                <div id="nodeDetailsError" class="alert alert-danger" style="display: none;">
                                    <i class="fas fa-exclamation-triangle me-2"></i>
                                    <span id="nodeDetailsErrorMessage">Unable to load node details.</span>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Add the modal to the body
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
            // Now try to show the modal again
            const newModal = document.getElementById('nodeDetailsModal');
            if (newModal) {
                console.log('Modal created successfully');
                try {
                    const modal = new bootstrap.Modal(newModal, {
                        backdrop: true,
                        keyboard: true,
                        focus: true
                    });
                    modal.show();
                } catch (error) {
                    console.error('Error with dynamically created modal:', error);
                    showModalFallback();
                }
            }
        }
        
        // Fetch node details
        fetch(`/api/nodes/${nodeName}/details`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(nodeData => {
                if (loadingDiv) loadingDiv.style.display = 'none';
                renderNodeDetails(nodeData);
            })
            .catch(error => {
                console.error('Error loading node details:', error);
                if (loadingDiv) loadingDiv.style.display = 'none';
                if (errorDiv) {
                    errorDiv.style.display = 'block';
                    const errorMessage = document.getElementById('nodeDetailsErrorMessage');
                    if (errorMessage) {
                        errorMessage.textContent = `Error loading node details: ${error.message}`;
                    }
                }
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
        console.log('Settings view became visible');
        
        // Ensure the modal exists before loading nodes
        ensureModalExists();
        
        injectTimestampElement();
        updateDatabaseTimestamp();
        loadNodes();
    }
    
    function ensureModalExists() {
        let modal = document.getElementById('nodeDetailsModal');
        if (!modal) {
            console.log('Modal not found, creating it...');
            // Create the modal if it doesn't exist
            const modalHTML = `
                <div class="modal fade node-details-modal" id="nodeDetailsModal" tabindex="-1" aria-labelledby="nodeDetailsModalLabel" aria-hidden="true">
                    <div class="modal-dialog modal-xl">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title" id="nodeDetailsModalLabel">
                                    <i class="fas fa-server me-2"></i>Node Details
                                </h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                <div id="nodeDetailsLoading" class="text-center py-4" style="display: none;">
                                    <div class="spinner-border text-primary" role="status">
                                        <span class="visually-hidden">Loading node details...</span>
                                    </div>
                                    <p class="mt-2 text-muted">Loading detailed node information...</p>
                                </div>
                                
                                <div id="nodeDetailsContent" class="node-details-content">
                                    <!-- Node details will be populated here -->
                                </div>
                                
                                <div id="nodeDetailsError" class="alert alert-danger" style="display: none;">
                                    <i class="fas fa-exclamation-triangle me-2"></i>
                                    <span id="nodeDetailsErrorMessage">Unable to load node details.</span>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            console.log('Modal created and added to DOM');
        } else {
            console.log('Modal already exists');
        }
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