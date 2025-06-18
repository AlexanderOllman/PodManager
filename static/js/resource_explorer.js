// resource_explorer.js

// Initializes the Resources explorer page
function initializeResourcesPage() {
    console.log('Initializing resources explorer page...');
    if (!window.app) window.app = {};
    if (!window.app.state) window.app.state = {};
    if (!window.app.state.resources) window.app.state.resources = {};
    if (!window.app.state.lastFetch) window.app.state.lastFetch = {};
    if (!window.app.CACHE_TIMEOUT) window.app.CACHE_TIMEOUT = 60000; // 1 min cache for explorer?
    
    // Set initial resource type to 'pods' on page load
    window.app.currentResourceType = 'pods';
    
    // Set up tabs
    const resourceTabs = document.querySelectorAll('#resourceTypeTabs .nav-link');
    resourceTabs.forEach(tab => {
        // The onclick attribute in the HTML already handles calling changeResourceType
        // We just need to set the active one based on currentResourceType
        if (tab.getAttribute('aria-controls') === window.app.currentResourceType) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        } else {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        }
    });

    // Setup search handler
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') searchResources();
        });
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (searchInput.value.length >= 3 || searchInput.value.length === 0) {
                    searchResources();
                }
            }, 500);
        });
    }

    // No longer need namespace selector logic here for now
    // Clear search button
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', clearResourceSearch);
    }

    const refreshBtn = document.getElementById('refreshResourceDatabase');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt fa-spin me-1"></i> Refreshing...';

            fetch('/api/refresh_db', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        console.log('Database refreshed, reloading resource view.');
                        loadResourceType(window.app.currentResourceType);
                        // Update last updated time
                        const timeEl = document.getElementById('resources-last-updated-time');
                        const containerEl = document.getElementById('resources-last-updated-container');
                        if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
                        if (containerEl) containerEl.style.display = 'block';
                    } else {
                        // Show an error
                        console.error('Failed to refresh database:', data.message);
                    }
                })
                .catch(error => {
                    console.error('Error refreshing database:', error);
                })
                .finally(() => {
                    refreshBtn.disabled = false;
                    refreshBtn.innerHTML = '<i class="fas fa-sync-alt me-1"></i> Refresh';
                });
        });
    }

    // Pagination buttons are not used with the full list view
    // Load initial data
    loadResourceType(window.app.currentResourceType);
    
    window.app.resourcesInitialized = true;
}

// Loads the resources explorer page (called when tab is activated)
function loadResourcesPage() {
    console.log('Loading resources explorer page content...');
    if (!window.app.resourcesInitialized) {
        initializeResourcesPage();
    } else {
        // If already initialized, just ensure the correct resource type is loaded
        loadResourceType(window.app.currentResourceType);
    }
}

// Loads data for the selected resource type in the explorer
function loadResourceType(resourceType) {
    console.log(`Loading resource type in explorer: ${resourceType}`);
    window.app.currentResourceType = resourceType; // Update global state
    window.app.state.resources.activeStatusFilter = null; // Clear status filter on new type load
    
    const state = window.app.state.resources[resourceType] || {};
    state.sortState = { key: null, direction: null };
    state.originalItems = null; // Mark as stale
    window.app.state.resources[resourceType] = state;

    const loadingContainer = document.getElementById('resourcesLoading');
    const tableContainer = document.getElementById('resourcesTableContainer');
    const progressBar = document.getElementById('resourcesProgressBar');

    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (tableContainer) tableContainer.style.opacity = '0'; // Hide table during load
    if (progressBar) progressBar.style.width = '10%';

    setupTableHeaders(resourceType); // Setup headers for the new type

    // Fetch ALL data, page 1, reset=true
    fetchResourceData(resourceType, 'all', true, 1, true) // fetchAll=true
        .then(data => {
            if (progressBar) progressBar.style.width = '100%';
            renderResourceSummaryCard(resourceType); // Render the summary card
            // renderResourcePage should be called by processResourcePageData via renderCurrentPage
            setTimeout(() => {
                if (loadingContainer) loadingContainer.style.display = 'none';
                if (tableContainer) tableContainer.style.opacity = '1'; // Show table
            }, 300); 
        })
        .catch(error => {
            console.error(`Error loading ${resourceType} in explorer:`, error);
            if (tableContainer) {
                // Simplified error display
                tableContainer.innerHTML = `<div class="alert alert-danger mt-3">Error loading ${resourceType}: ${error.message} <button class="btn btn-sm btn-outline-danger ms-3" onclick="loadResourceType('${resourceType}')">Retry</button></div>`;
                tableContainer.style.opacity = '1';
            }
            if (loadingContainer) loadingContainer.style.display = 'none';
        });
}

// Sets up the table headers for the resources explorer table
function setupTableHeaders(resourceType) {
    const tableHeadersRow = document.getElementById('resourcesTableHeader'); // Assuming <thead> has id="resourcesTableHeader"
    if (!tableHeadersRow) {
        console.error('Resource explorer table header row not found (#resourcesTableHeader).');
        return;
    }
    tableHeadersRow.innerHTML = ''; // Clear existing headers

    let headers = [];
    // Define headers based on resource type, including data-sort attribute
    switch (resourceType) {
        case 'pods': headers = [{n:'Namespace', s:'namespace'}, {n:'Name', s:'name'}, {n:'Status', s:'status'}, {n:'CPU', s:'cpu'}, {n:'GPU', s:'gpu'}, {n:'Memory', s:'memory'}, {n:'Age', s:'age'}, {n:'Actions', s:null}]; break;
        case 'services': headers = [{n:'Namespace', s:'namespace'}, {n:'Name', s:'name'}, {n:'Type', s:'type'}, {n:'Cluster IP', s:'clusterip'}, {n:'External IP', s:'externalip'}, {n:'Ports', s:null}, {n:'Age', s:'age'}, {n:'Actions', s:null}]; break;
        case 'deployments': headers = [{n:'Namespace', s:'namespace'}, {n:'Name', s:'name'}, {n:'Ready', s:null}, {n:'Status', s:'status'}, {n:'CPU', s:'cpu'}, {n:'Memory', s:'memory'}, {n:'Age', s:'age'}, {n:'Actions', s:null}]; break;
        case 'inferenceservices': headers = [{n:'Namespace', s:'namespace'}, {n:'Name', s:'name'}, {n:'URL', s:null}, {n:'Status', s:'status'}, {n:'CPU', s:'cpu'}, {n:'GPU', s:'gpu'}, {n:'Memory', s:'memory'}, {n:'Age', s:'age'}, {n:'Actions', s:null}]; break;
        case 'configmaps': headers = [{n:'Namespace', s:'namespace'}, {n:'Name', s:'name'}, {n:'Data', s:null}, {n:'Age', s:'age'}, {n:'Actions', s:null}]; break;
        case 'secrets': headers = [{n:'Namespace', s:'namespace'}, {n:'Name', s:'name'}, {n:'Type', s:null}, {n:'Data', s:null}, {n:'Age', s:'age'}, {n:'Actions', s:null}]; break;
        default: headers = [{n:'Namespace', s:'namespace'}, {n:'Name', s:'name'}, {n:'Age', s:'age'}, {n:'Actions', s:null}];
    }

    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.n;
        if (header.s) { // If sortable
            th.setAttribute('data-sort', header.s);
            th.style.cursor = 'pointer';
            
            const sortIndicator = document.createElement('span');
            sortIndicator.className = 'sort-indicator ms-1';
            sortIndicator.innerHTML = '<i class="fas fa-sort text-muted"></i>';
            th.appendChild(sortIndicator);

            th.addEventListener('click', () => handleHeaderSort(resourceType, header.s));
        }
        tableHeadersRow.appendChild(th);
    });
    
    updateSortOptions(resourceType, headers);

    // Re-attach sorting listeners to the new headers
    if (typeof addSortingToResourceTable === 'function') {
         addSortingToResourceTable(resourceType); // Assumes this function targets the correct table
    } else {
        console.warn('addSortingToResourceTable function not found.');
    }
}

function handleHeaderSort(resourceType, sortKey) {
    const state = window.app.state.resources[resourceType];
    if (!state) return;

    if (!state.sortState) {
        state.sortState = { key: null, direction: null };
    }

    const currentSortKey = state.sortState.key;
    const currentSortDirection = state.sortState.direction;
    let newDirection;

    if (currentSortKey !== sortKey) {
        newDirection = 'asc';
    } else {
        if (currentSortDirection === 'asc') {
            newDirection = 'desc';
        } else if (currentSortDirection === 'desc') {
            newDirection = null; // Unsort
        } else {
            newDirection = 'asc';
        }
    }

    state.sortState = { key: sortKey, direction: newDirection };
    
    sortResources(resourceType);
    updateSortIndicators(resourceType);
}

function updateSortIndicators(resourceType) {
    const state = window.app.state.resources[resourceType];
    const sortState = state.sortState || { key: null, direction: null };
    const tableHeaders = document.querySelectorAll('#resourcesTableHeader th[data-sort]');
    
    tableHeaders.forEach(th => {
        const key = th.dataset.sort;
        const indicator = th.querySelector('.sort-indicator i');
        
        th.classList.remove('sorting-asc', 'sorting-desc');
        if (indicator) {
            indicator.className = 'fas fa-sort text-muted';
        
            if (key === sortState.key && sortState.direction) {
                if (sortState.direction === 'asc') {
                    th.classList.add('sorting-asc');
                    indicator.className = 'fas fa-sort-up';
                } else {
                    th.classList.add('sorting-desc');
                    indicator.className = 'fas fa-sort-down';
                }
            }
        }
    });
}

function updateSortOptions(resourceType, headers) {
    const sortMenu = document.getElementById('resourceSortOptions');
    if (!sortMenu) return;
    sortMenu.innerHTML = ''; // Clear old options

    const createSortOption = (sortKey, text) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item sort-option';
        a.href = '#';
        a.dataset.sort = sortKey;
        a.textContent = text;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            sortResources(e.target.dataset.sort);
            document.getElementById('sort-resources-dropdown').textContent = `Sort By: ${text}`;
        });
        li.appendChild(a);
        return li;
    };

    headers.forEach(header => {
        if (header.s) { // If sortable
            sortMenu.appendChild(createSortOption(header.s, `${header.n} (Asc)`));
            sortMenu.appendChild(createSortOption(`${header.s}-desc`, `${header.n} (Desc)`));
        }
    });
}

function sortResources(resourceType) {
    const state = window.app.state.resources[resourceType];
    if (!state || !state.items) return;

    const sortState = state.sortState;
    if (!sortState || !sortState.direction) {
        // If unsorting, revert to original order if available
        if (state.originalItems) {
            // Re-filter by status if a status filter is active
            const activeStatusFilter = window.app.state.resources.activeStatusFilter;
            if (activeStatusFilter) {
                 state.items = state.originalItems.filter(item => getResourceStatus(resourceType, item) === activeStatusFilter);
            } else {
                state.items = [...state.originalItems];
            }
        }
        renderCurrentPage(resourceType);
        return;
    }

    const { key: sortKey, direction } = sortState;

    const parseMemory = (memStr) => {
        if (!memStr || memStr === '-') return 0;
        const value = parseFloat(memStr);
        if (memStr.toLowerCase().includes('ki')) return value * 1024;
        if (memStr.toLowerCase().includes('mi')) return value * 1024 * 1024;
        if (memStr.toLowerCase().includes('gi')) return value * 1024 * 1024 * 1024;
        return value;
    };

    const getValue = (item, key) => {
        switch (key) {
            case 'name': return item.metadata.name.toLowerCase();
            case 'namespace': return item.metadata.namespace.toLowerCase();
            case 'age': return new Date(item.metadata.creationTimestamp);
            case 'status': return getResourceStatus(resourceType, item);
            case 'cpu':
            case 'gpu':
            case 'memory':
                const usage = getResourceUsage(item);
                if (key === 'memory') return parseMemory(usage.memory);
                return parseFloat(usage[key]) || 0;
            default:
                // For other keys like 'type' on services
                const val = item.spec?.[key] || item[key] || '';
                return typeof val === 'string' ? val.toLowerCase() : val;
        }
    };

    state.items.sort((a, b) => {
        const valA = getValue(a, sortKey);
        const valB = getValue(b, sortKey);

        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });

    renderCurrentPage(resourceType);
}

// Handles resource type change in the explorer dropdown
function changeResourceType(resourceType) {
    console.log(`Explorer changing to resource type: ${resourceType}`);
    // Update active tab
    const resourceTabs = document.querySelectorAll('#resourceTypeTabs .nav-link');
    resourceTabs.forEach(tab => {
        if (tab.getAttribute('aria-controls') === resourceType) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        } else {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        }
    });

    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) searchInput.value = ''; // Clear search on type change
    clearResourceSearchIndicator(); // Remove filter indicator
    loadResourceType(resourceType);
    window.app.lastUserInteraction = Date.now(); // Track interaction time
}

// Handles namespace change in the explorer dropdown (if present)
function namespaceChangedResource() {
    const resourceType = window.app.currentResourceType;
    const namespaceSelector = document.getElementById('resourceNamespaceSelector');
    const selectedNamespace = namespaceSelector ? namespaceSelector.value : 'all';
    console.log(`Explorer namespace changed to: ${selectedNamespace} for ${resourceType}`);
    
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) searchInput.value = ''; // Clear search on namespace change
    clearResourceSearchIndicator();

    // Force reload for the new namespace
    if (window.app.state.resources[resourceType]) {
        window.app.state.resources[resourceType].items = [];
        window.app.state.resources[resourceType].loadedPages = [];
    }
    fetchResourceData(resourceType, selectedNamespace, false, 1, true);
    window.app.lastUserInteraction = Date.now();
}

// Handles search input in the resources explorer
function searchResources() {
    const resourceType = window.app.currentResourceType;
    const searchInput = document.getElementById('resourceSearchInput');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    console.log(`Explorer client-side searching ${resourceType} for: "${searchTerm}"`);
    
    clearResourceSearchIndicator();

    // Re-apply filters and sorting
    applyFiltersAndSorting(resourceType);
    
    const state = window.app.state.resources[resourceType];
    if (searchTerm) {
        addResourceSearchIndicator(resourceType, searchTerm, state.items.length);
    }
}

// Clears the search input and results in the explorer
function clearResourceSearch() {
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) searchInput.value = '';
    clearResourceSearchIndicator();
    
    // Just re-apply filters, which will now use an empty search term
    applyFiltersAndSorting(window.app.currentResourceType);

    window.app.lastUserInteraction = Date.now();
}

// Adds a visual indicator that the resource list is filtered
function addResourceSearchIndicator(resourceType, searchTerm, resultCount) {
    const tableContainer = document.getElementById('resourcesTableContainer');
    if (!tableContainer) return;
    clearResourceSearchIndicator(); // Remove previous indicator

    const indicator = document.createElement('div');
    indicator.className = 'filter-indicator alert alert-info mb-3';
    indicator.innerHTML = `
        <i class="fas fa-filter me-2"></i>
        Filtered by: "<strong>${searchTerm}</strong>" (${resultCount} results)
        <button type="button" class="btn-close float-end" aria-label="Close" onclick="clearResourceSearch()"></button>
    `;
    tableContainer.insertBefore(indicator, tableContainer.firstChild);
}

// Removes the search filter visual indicator
function clearResourceSearchIndicator() {
    const tableContainer = document.getElementById('resourcesTableContainer');
    const indicator = tableContainer?.querySelector('.filter-indicator');
    if (indicator) indicator.remove();
}

// Renders ALL items for the resources explorer table (no pagination)
function renderResourcePage(resourceType) {
    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData || !resourceData.items) {
        console.error(`No data available for ${resourceType} in renderResourcePage`);
        const tableBody = document.getElementById('resourcesTableBody');
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted py-4">No data available for ${resourceType}.</td></tr>`;
        return;
    }
    
    if (!resourceData.originalItems) {
        resourceData.originalItems = [...resourceData.items];
    }
    
    const { items, totalCount } = resourceData; // No pageSize/currentPage needed here
    const tableBody = document.getElementById('resourcesTableBody');
    if (!tableBody) {
        console.error('Resources table body (#resourcesTableBody) not found.');
        return;
    }

    tableBody.innerHTML = ''; // Clear previous content

    if (items.length === 0) {
        const colSpan = document.getElementById('resourcesTableHeader')?.children.length || 7;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No ${resourceType} found.</td></tr>`;
    } else {
        // Optimize rendering potentially with document fragment for large lists
        const fragment = document.createDocumentFragment();
        items.forEach(item => { // Iterate through ALL items
            const row = createResourceRow(resourceType, item); // Assumes createResourceRow exists (likely in resource_rendering.js)
            if (row) fragment.appendChild(row);
        });
        tableBody.appendChild(fragment);
        setTimeout(initializeAllDropdowns, 50); // Initialize dropdowns after appending
    }
    
    // Update count info
    const tableContainer = document.getElementById('resourcesTableContainer');
    if (tableContainer) {
        let countInfo = tableContainer.querySelector('.count-info');
        if (!countInfo) {
             countInfo = document.createElement('div');
             countInfo.className = 'text-muted small mb-2 count-info';
             // Insert before the table responsive div if possible
             const tableResponsiveDiv = tableContainer.querySelector('.table-responsive');
             if (tableResponsiveDiv) tableContainer.insertBefore(countInfo, tableResponsiveDiv);
             else tableContainer.prepend(countInfo);
        }
        // Show total count
        countInfo.innerHTML = `Showing ${items.length} of ${totalCount || items.length} ${resourceType}`; // Use totalCount if available
    }
     // Ensure table is visible after render
     const loadingContainer = document.getElementById('resourcesLoading');
     if (loadingContainer) loadingContainer.style.display = 'none';
     if (tableContainer) tableContainer.style.opacity = '1';
}

// Renders the summary card for the given resource type
function renderResourceSummaryCard(resourceType) {
    const summaryContainer = document.getElementById('resourceSummaryContainer');
    if (!summaryContainer) return;

    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData || !resourceData.items) {
        summaryContainer.innerHTML = 'No data available to generate summary.';
        return;
    }

    const items = resourceData.items;
    const statusCounts = items.reduce((acc, item) => {
        const status = getResourceStatus(resourceType, item);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    let summaryHtml = `<h5 class="card-title mb-2">${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} Summary</h5>`;
    summaryHtml += '<div class="d-flex flex-wrap gap-3 align-items-center">';

    // 'All' status
    summaryHtml += `
        <a href="#" class="text-decoration-none text-dark" onclick="filterResourcesByStatus(event, '${resourceType}', null)">
            <span class="badge bg-primary rounded-pill me-1">${items.length}</span>
            Total
        </a>`;

    Object.entries(statusCounts).forEach(([status, count]) => {
        const statusColor = getStatusColor(status);
        summaryHtml += `
            <a href="#" class="text-decoration-none text-dark" onclick="filterResourcesByStatus(event, '${resourceType}', '${status}')">
                <span class="p-1 me-1 rounded-circle" style="background-color: ${statusColor}; display: inline-block;"></span>
                <span class="fw-bold">${count}</span>
                ${status}
            </a>`;
    });
    summaryHtml += '</div>';

    summaryContainer.innerHTML = summaryHtml;
}

// Filter the resource table by a given status
function filterResourcesByStatus(event, resourceType, status) {
    event.preventDefault();
    console.log(`Filtering ${resourceType} by status: ${status}`);

    const state = window.app.state.resources[resourceType];
    if (!state) return;
    
    window.app.state.resources.activeStatusFilter = status;
    state.sortState = { key: null, direction: null }; // Reset sort on status filter change
    updateSortIndicators(resourceType);

    applyFiltersAndSorting(resourceType);

    // Update active state on summary card
    const summaryCard = document.getElementById('resourceSummaryContainer');
    if (!summaryCard) return;
    summaryCard.querySelectorAll('a').forEach(a => a.classList.remove('fw-bold'));
    
    // Find the correct link to bold
    const links = summaryCard.querySelectorAll('a');
    links.forEach(link => {
        const onclickAttr = link.getAttribute('onclick');
        if (onclickAttr && onclickAttr.includes(`'${status}'`)) {
            link.classList.add('fw-bold');
        }
    });
}

// Helper to get a standardized status from a resource item
function getResourceStatus(resourceType, item) {
    if (!item || !item.status) return 'Unknown';

    switch (resourceType) {
        case 'pods':
            return item.status.phase || 'Unknown';
        case 'deployments':
            const readyReplicas = item.status.readyReplicas || 0;
            const totalReplicas = item.status.replicas || 0;
            return readyReplicas === totalReplicas && totalReplicas > 0 ? 'Available' : 'Progressing';
        case 'inferenceservices':
            if (item.status.conditions) {
                const readyCondition = item.status.conditions.find(c => c.type === 'Ready');
                if (readyCondition) {
                    return readyCondition.status === 'True' ? 'NotReady' : 'Ready';
                }
            }
            return 'Unknown';
        case 'services':
            return item.spec.type || 'Unknown';
        default:
            return 'N/A';
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

// New central function to apply all filters and sorting
function applyFiltersAndSorting(resourceType) {
    const state = window.app.state.resources[resourceType];
    if (!state || !state.originalItems) {
        console.warn(`No original data for ${resourceType} to filter or sort.`);
        if (state) renderCurrentPage(resourceType); // Render whatever we have (e.g., empty state)
        return;
    }

    const searchInput = document.getElementById('resourceSearchInput');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const activeStatusFilter = window.app.state.resources.activeStatusFilter;
    
    let filteredItems = [...state.originalItems];

    // Apply status filter first
    if (activeStatusFilter) {
        filteredItems = filteredItems.filter(item => getResourceStatus(resourceType, item) === activeStatusFilter);
    }

    // Then apply search term filter
    if (searchTerm) {
        filteredItems = filteredItems.filter(item => {
            const name = item.metadata?.name?.toLowerCase() || '';
            const namespace = item.metadata?.namespace?.toLowerCase() || '';
            // Add other fields to search if necessary
            return name.includes(searchTerm) || namespace.includes(searchTerm);
        });
    }

    state.items = filteredItems;

    // Apply sorting
    const sortState = state.sortState;
    if (sortState && sortState.key && sortState.direction) {
        sortResources(resourceType);
    } else {
        // If no active sort, just render the filtered items
        renderCurrentPage(resourceType);
    }
} 