// resource_explorer.js

// Initializes the Resources explorer page
function initializeResourcesPage() {
    console.log('Initializing resources explorer page...');
    if (!window.app) window.app = {};
    if (!window.app.state) window.app.state = {};
    if (!window.app.state.resources) window.app.state.resources = {};
    if (!window.app.state.lastFetch) window.app.state.lastFetch = {};
    if (!window.app.CACHE_TIMEOUT) window.app.CACHE_TIMEOUT = 60000; // 1 min cache for explorer?
    
    // Set initial resource type if not already set (e.g., from previous navigation)
    window.app.currentResourceType = window.app.currentResourceType || 'pods';
    const resourceTypeSelector = document.getElementById('resourceTypeSelector');
    if (resourceTypeSelector) {
        resourceTypeSelector.value = window.app.currentResourceType;
    }

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

    // Fetch namespaces for the selector (if it exists - removed in previous steps?)
    // Re-adding namespace fetch logic if explorer still has a selector
    const namespaceSelector = document.getElementById('resourceNamespaceSelector');
    if (namespaceSelector) {
        fetchNamespacesForSelectors() // Assumes function exists in api_service.js
            .then(namespaces => populateResourceNamespaceSelector(namespaces))
            .catch(error => console.error('Error loading namespaces for explorer:', error));
        // Add listener for namespace change
        namespaceSelector.addEventListener('change', namespaceChangedResource);
    }

    // Resource type change handler
    if (resourceTypeSelector) {
        resourceTypeSelector.addEventListener('change', function() {
            changeResourceType(this.value);
        });
    }

    // Clear search button
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', clearResourceSearch);
    }

    // Pagination buttons
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) prevPageBtn.addEventListener('click', () => navigateResourcePage('prev'));
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => navigateResourcePage('next'));

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
            // No pagination UI update needed
            // updatePaginationUI(resourceType);
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

    // Ensure originalItems exists and is up-to-date if it's the first search
    // or if we are clearing a search.
    if (!state.originalItems || searchTerm === '') {
        // If originalItems is not set, or we are clearing search, assume current items are the full list.
        // This relies on the initial loadResourceType having fetched all items.
        state.originalItems = [...state.items]; 
    }

    let itemsToFilter = state.originalItems || state.items;

    const filteredItems = searchTerm
        ? itemsToFilter.filter(item => {
            const name = item.metadata?.name?.toLowerCase() || '';
            const namespace = item.metadata?.namespace?.toLowerCase() || '';
            // Add other fields to search if necessary
            return name.includes(searchTerm) || namespace.includes(searchTerm);
        })
        : [...(state.originalItems || itemsToFilter)]; // If search term is empty, show original/all items

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

    if (state && state.originalItems) {
        state.items = [...state.originalItems]; // Restore from backup
        // Update counts/pagination if we were strictly managing that (not relevant for full list)
        // state.totalCount = state.items.length; 
        // state.currentPage = 1;
        // state.totalPages = 1;
        // delete state.originalItems; // Optionally clear originalItems if memory is a concern
    } else if (state) {
        // If no originalItems, implies either not searched yet or original state is already current
        // For safety, could reload, but ideally originalItems should exist after first load
        console.warn('clearResourceSearch: originalItems not found, full list might not be restored if previously filtered by other means.');
        // If originalItems are gone, the safest is to re-trigger the full load
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