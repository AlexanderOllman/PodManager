// resource_explorer.js

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
            // Add sorting indicator placeholder
            const sortIndicator = document.createElement('span');
            sortIndicator.className = 'sort-indicator ms-1';
            sortIndicator.innerHTML = '<i class="fas fa-sort text-muted"></i>';
            th.appendChild(sortIndicator);
        }
        tableHeadersRow.appendChild(th);
    });
    
    // Re-attach sorting listeners to the new headers
    if (typeof addSortingToResourceTable === 'function') {
         addSortingToResourceTable(resourceType); // Assumes this function targets the correct table
    } else {
        console.warn('addSortingToResourceTable function not found.');
    }
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
    const summaryCard = document.getElementById('resourceSummaryCard');
    const cardBody = summaryCard.querySelector('.card-body');
    if (!cardBody) return;

    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData || !resourceData.items) {
        cardBody.innerHTML = 'No data available to generate summary.';
        return;
    }

    const items = resourceData.items;
    const statusCounts = items.reduce((acc, item) => {
        const status = getResourceStatus(resourceType, item);
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    let summaryHtml = `<h5 class="card-title">${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} Summary</h5>`;
    summaryHtml += '<div class="d-flex flex-wrap gap-3">';

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

    cardBody.innerHTML = summaryHtml;
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
    const summaryCard = document.getElementById('resourceSummaryCard');
    summaryCard.querySelectorAll('a').forEach(a => a.classList.remove('fw-bold'));
    event.currentTarget.classList.add('fw-bold');
} 