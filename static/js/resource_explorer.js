// resource_explorer.js

// A map to store sort state for each resource type
if (!window.app) window.app = {};
if (!window.app.state) window.app.state = {};
if (!window.app.state.resourceSort) window.app.state.resourceSort = {};

// Initializes the Resources explorer page
function initializeResourcesPage() {
    console.log('Initializing resources explorer page...');
    if (!window.app) window.app = {};
    if (!window.app.state) window.app.state = {};
    if (!window.app.state.resources) window.app.state.resources = {};
    if (!window.app.state.lastFetch) window.app.state.lastFetch = {};
    if (!window.app.CACHE_TIMEOUT) window.app.CACHE_TIMEOUT = 60000; // 1 min cache for explorer?
    
    // Set initial resource type if not already set
    window.app.currentResourceType = window.app.currentResourceType || 'pods';
    
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
        const clearBtn = document.getElementById('clearSearchBtn');
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            if(searchInput.value) {
                clearBtn.style.display = 'block';
            } else {
                clearBtn.style.display = 'none';
            }
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
        clearSearchBtn.addEventListener('click', () => {
             clearResourceSearch();
             clearSearchBtn.style.display = 'none';
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshResourcesBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshResourcesPage);
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

    const loadingContainer = document.getElementById('resourcesLoading');
    const tableContainer = document.getElementById('resourcesTableContainer');
    const progressBar = document.getElementById('resourcesProgressBar');

    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (tableContainer) tableContainer.style.opacity = '0'; // Hide table during load
    if (progressBar) progressBar.style.width = '10%';

    setupTableHeaders(resourceType); // Setup headers for the new type
    setupSortDropdown(resourceType); // Setup sorting dropdown

    // Fetch ALL data, page 1, reset=true
    fetchResourceData(resourceType, 'all', true, 1, true) // fetchAll=true
        .then(data => {
            if (progressBar) progressBar.style.width = '100%';
            renderResourceSummaryCard(resourceType); // Render the summary card
            updateLastUpdatedTimestamp('resources-last-updated-time');
            sortResources(null, null, true); // Apply default sort
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
            // Add sorting indicator placeholder
            const sortIndicator = document.createElement('span');
            sortIndicator.className = 'sort-indicator ms-1';
            sortIndicator.innerHTML = '<i class="fas fa-sort text-muted"></i>';
            th.appendChild(sortIndicator);
        }
        tableHeadersRow.appendChild(th);
    });
    
    // Re-attach sorting listeners to the new headers
    addSortingToResourceTable(resourceType);
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
    
    const loadingContainer = document.getElementById('resourcesLoading');
    const tableContainer = document.getElementById('resourcesTableContainer');
    const progressBar = document.getElementById('resourcesProgressBar');
    const loadingText = document.getElementById('resourcesLoadingText');

    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (tableContainer) tableContainer.style.opacity = '0.5'; 
    if (progressBar) progressBar.style.width = '10%';
    if (loadingText) loadingText.textContent = 'Filtering resources...';

    clearResourceSearchIndicator();

    const state = window.app.state.resources[resourceType];
    if (!state) {
        console.warn('No state found for resource type:', resourceType);
        if (loadingContainer) loadingContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.opacity = '1';
        return;
    }

    // If a status filter is active, we filter from that subset. Otherwise, from the full list.
    const activeStatusFilter = window.app.state.resources.activeStatusFilter;
    let itemsToFilter;

    // Ensure originalItems exists and is up-to-date
    if (!state.originalItems) {
        state.originalItems = [...state.items]; 
    }

    if (activeStatusFilter) {
        itemsToFilter = state.originalItems.filter(item => getResourceStatus(resourceType, item) === activeStatusFilter);
    } else {
        itemsToFilter = state.originalItems;
    }

    const filteredItems = searchTerm
        ? itemsToFilter.filter(item => {
            const name = item.metadata?.name?.toLowerCase() || '';
            const namespace = item.metadata?.namespace?.toLowerCase() || '';
            // Add other fields to search if necessary
            return name.includes(searchTerm) || namespace.includes(searchTerm);
        })
        : itemsToFilter; // If search term is empty, show the status-filtered (or all) items

    // Update the main items list in the state with the filtered results
    state.items = filteredItems;
    // Update totalCount to reflect the filtered items for display purposes, but keep original totalCount if needed elsewhere.
    // For simplicity in rendering, we might just show the count of filtered items.
    // state.totalCount = filteredItems.length; // This might be confusing if totalCount means total in cluster.
    // Let renderResourcePage handle the display of count based on current items.length

    if (progressBar) progressBar.style.width = '100%';
    if (loadingText) loadingText.textContent = 'Rendering results...';

    renderCurrentPage(resourceType); // This will call renderResourcePage

    if (searchTerm) {
        addResourceSearchIndicator(resourceType, searchTerm, filteredItems.length);
    } else {
        // If search term is empty, we effectively cleared the search.
        // Restore original items if they exist, otherwise, state.items already has them.
        if (state.originalItems) {
            state.items = [...state.originalItems];
            // delete state.originalItems; // Keep originalItems to allow re-filtering without re-fetch
        }
    }

    setTimeout(() => {
        if (loadingContainer) loadingContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.opacity = '1';
    }, 300);

    window.app.lastUserInteraction = Date.now();
}

// Clears the search input and results in the explorer
function clearResourceSearch() {
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) searchInput.value = '';
    clearResourceSearchIndicator();
    
    const resourceType = window.app.currentResourceType;
    const state = window.app.state.resources[resourceType];
    const activeStatusFilter = window.app.state.resources.activeStatusFilter;

    if (state && state.originalItems) {
        if (activeStatusFilter) {
            // If a status filter is active, clearing search should restore the status-filtered list
            state.items = state.originalItems.filter(item => getResourceStatus(resourceType, item) === activeStatusFilter);
        } else {
            // Otherwise, restore the full original list
            state.items = [...state.originalItems];
        }
    } else if (state) {
        console.warn('clearResourceSearch: originalItems not found, reloading.');
        loadResourceType(resourceType);
        return;
    }
    renderCurrentPage(resourceType);
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
    const countInfoEl = document.getElementById('resources-count-info');
    if (countInfoEl) {
        const total = resourceData.totalCount || items.length;
        const showing = items.length;
        countInfoEl.innerHTML = `Showing <strong>${showing}</strong> of <strong>${total}</strong> ${resourceType}`;
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
        summaryContainer.innerHTML = '<div class="text-center text-muted p-3">No data available to generate summary.</div>';
        return;
    }

    const items = resourceData.items;
    const statusCounts = items.reduce((acc, item) => {
        const status = getResourceStatus(resourceType, item);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    let summaryHtml = '<div class="d-flex flex-wrap gap-3 align-items-center">';

    // 'All' status filter
    const totalCount = items.length;
    const isActive = window.app.state.resources.activeStatusFilter === null;
    summaryHtml += `
        <a href="#" class="text-decoration-none text-dark d-flex align-items-center ${isActive ? 'fw-bold' : ''}" onclick="filterResourcesByStatus(event, '${resourceType}', null)">
            <span class="badge bg-secondary rounded-pill me-2">${totalCount}</span> Total
        </a>`;

    Object.entries(statusCounts).forEach(([status, count]) => {
        const statusColor = getStatusColor(status);
        const isActive = window.app.state.resources.activeStatusFilter === status;
        summaryHtml += `
            <a href="#" class="text-decoration-none text-dark d-flex align-items-center ${isActive ? 'fw-bold' : ''}" onclick="filterResourcesByStatus(event, '${resourceType}', '${status}')">
                <span class="status-dot me-2" style="background-color: ${statusColor};"></span>
                <span class="fw-bold me-1">${count}</span>
                <span class="text-muted">${status}</span>
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
    if (!state || !state.originalItems) {
        // Fallback to ensure originalItems exists. This should be set on first load.
        if (state.items) {
            state.originalItems = [...state.items];
        } else {
            console.error("Original items not found for filtering.");
            return;
        }
    }
    
    window.app.state.resources.activeStatusFilter = status;

    if (status === null || status === 'null') {
        state.items = [...state.originalItems];
    } else {
        state.items = state.originalItems.filter(item => getResourceStatus(resourceType, item) === status);
    }
    
    // After filtering, re-apply any active search term
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput && searchInput.value) {
        searchResources(); // This will filter the already status-filtered list
    } else {
        renderCurrentPage(resourceType);
    }

    // Update active state on summary card
    renderResourceSummaryCard(resourceType);
}

function updateLastUpdatedTimestamp(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = new Date().toLocaleString();
    }
    const container = document.getElementById('resource-explorer-last-updated');
    if(container) container.style.display = 'block';
}

function refreshResourcesPage() {
    console.log("Refreshing all resource data from server...");
    // Assuming refreshDatabase shows its own global loading indicator
    if (typeof refreshDatabase === 'function') {
        // Show a button spinner
        const refreshBtn = document.getElementById('refreshResourcesBtn');
        const originalHtml = refreshBtn.innerHTML;
        refreshBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Refreshing...`;
        refreshBtn.disabled = true;

        refreshDatabase()
            .then(() => {
                console.log("Database refresh complete. Reloading current resource view.");
                loadResourceType(window.app.currentResourceType);
            })
            .catch(error => {
                console.error("Failed to refresh database:", error);
                // You might want to show an error message to the user
            })
            .finally(() => {
                 refreshBtn.innerHTML = originalHtml;
                 refreshBtn.disabled = false;
            });

    } else {
        console.error("refreshDatabase function is not defined. Cannot refresh.");
    }
}

function getSortableValue(item, key) {
    if (!item) return null;
    
    switch(key) {
        case 'name':
            return item.metadata?.name?.toLowerCase();
        case 'namespace':
            return item.metadata?.namespace?.toLowerCase();
        case 'age':
            return new Date(item.metadata?.creationTimestamp).getTime();
        case 'status':
            return getResourceStatus(window.app.currentResourceType, item);
        case 'cpu':
        case 'gpu':
        case 'memory':
            const usage = getResourceUsage(item);
            if (key === 'memory') {
                 // Standardize to MiB for sorting
                 const mem = usage.memory;
                 if (mem === '-') return 0;
                 return parseFloat(mem);
            }
            return parseFloat(usage[key]) || 0;
        default:
            // For other keys like 'type', 'clusterip' etc.
            return item.spec?.[key] || item.status?.[key] || '';
    }
}

function sortResources(key, order, isDefault = false) {
    const resourceType = window.app.currentResourceType;
    const state = window.app.state.resources[resourceType];
    if (!state || !state.items) return;

    if (!window.app.state.resourceSort[resourceType]) {
        window.app.state.resourceSort[resourceType] = { key: 'name', order: 'asc' };
    }

    const sortState = window.app.state.resourceSort[resourceType];

    if (!isDefault) {
        if (key) {
             if (sortState.key === key) {
                 sortState.order = sortState.order === 'asc' ? 'desc' : 'asc';
             } else {
                 sortState.key = key;
                 sortState.order = 'asc';
             }
         }
    }
    
     if (key && order) {
        sortState.key = key;
        sortState.order = order;
    }

    const { key: sortKey, order: sortOrder } = sortState;

    const sorter = (a, b) => {
        const valA = getSortableValue(a, sortKey);
        const valB = getSortableValue(b, sortKey);

        const orderMultiplier = sortOrder === 'asc' ? 1 : -1;

        if (typeof valA === 'string' && typeof valB === 'string') {
            return valA.localeCompare(valB) * orderMultiplier;
        }
        if (valA < valB) return -1 * orderMultiplier;
        if (valA > valB) return 1 * orderMultiplier;
        return 0;
    };

    state.items.sort(sorter);
    if (state.originalItems) {
        state.originalItems.sort(sorter);
    }
    
    console.log(`Sorted ${resourceType} by ${sortKey} (${sortOrder})`);
    renderCurrentPage(resourceType);
    updateSortIndicators();
}

function addSortingToResourceTable(resourceType) {
    const headerRow = document.getElementById('resourcesTableHeader');
    headerRow.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort');
            sortResources(sortKey);
        });
    });
}

function updateSortIndicators() {
    const resourceType = window.app.currentResourceType;
    if (!window.app.state.resourceSort[resourceType]) return;

    const { key, order } = window.app.state.resourceSort[resourceType];
    
    // Update dropdown button label
    const currentSortLabel = document.getElementById('current-sort-label');
    if(currentSortLabel) {
        const keyLabel = key.charAt(0).toUpperCase() + key.slice(1);
        currentSortLabel.textContent = `${keyLabel} (${order === 'asc' ? 'Asc' : 'Desc'})`;
    }

    // Update table header indicators
    const headerRow = document.getElementById('resourcesTableHeader');
    headerRow.querySelectorAll('th[data-sort]').forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        th.classList.remove('sorting-asc', 'sorting-desc');
        indicator.innerHTML = '<i class="fas fa-sort text-muted"></i>';

        if (th.getAttribute('data-sort') === key) {
            th.classList.add(order === 'asc' ? 'sorting-asc' : 'sorting-desc');
            indicator.innerHTML = order === 'asc' ? '<i class="fas fa-sort-up"></i>' : '<i class="fas fa-sort-down"></i>';
        }
    });
}

function setupSortDropdown(resourceType) {
    const dropdown = document.getElementById('resourceSortDropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';

    const addOption = (key, label, order) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item';
        a.href = '#';
        a.textContent = label;
        a.onclick = (e) => {
            e.preventDefault();
            sortResources(key, order);
        };
        li.appendChild(a);
        dropdown.appendChild(li);
    };

    const headers = document.querySelectorAll('#resourcesTableHeader th[data-sort]');
    headers.forEach(th => {
        const key = th.getAttribute('data-sort');
        const label = th.textContent.replace(/sort/i, '').trim();
        if (key && label) {
             addOption(key, `${label} (Asc)`, 'asc');
             addOption(key, `${label} (Desc)`, 'desc');
        }
    });
} 