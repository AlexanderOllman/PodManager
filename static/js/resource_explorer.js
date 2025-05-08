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
    resetPaginationUI(); // Reset pagination display

    // Fetch page 1, resetting any previous data for this type
    fetchResourceData(resourceType, 'all', false, 1, true)
        .then(data => {
            if (progressBar) progressBar.style.width = '100%';
            updatePaginationUI(resourceType);
            // renderResourcePage(resourceType); // fetchResourceData calls process, which calls render
            setTimeout(() => {
                if (loadingContainer) loadingContainer.style.display = 'none';
                if (tableContainer) tableContainer.style.opacity = '1'; // Show table
            }, 300); 
        })
        .catch(error => {
            console.error(`Error loading ${resourceType} in explorer:`, error);
            if (tableContainer) {
                tableContainer.innerHTML = `
                    <div class="alert alert-danger mt-3">
                        Error loading ${resourceType}: ${error.message}
                        <button class="btn btn-sm btn-outline-danger ms-3" onclick="loadResourceType('${resourceType}')">Retry</button>
                    </div>`;
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
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const namespace = document.getElementById('resourceNamespaceSelector')?.value || 'all'; // Use selected namespace if available
    
    console.log(`Explorer searching ${resourceType} in namespace ${namespace} for: "${searchTerm}"`);
    
    // Indicate loading/searching state
    const loadingContainer = document.getElementById('resourcesLoading');
    const tableContainer = document.getElementById('resourcesTableContainer');
    const progressBar = document.getElementById('resourcesProgressBar');
    const loadingText = document.getElementById('resourcesLoadingText');

    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (tableContainer) tableContainer.style.opacity = '0.5'; 
    if (progressBar) progressBar.style.width = '10%';
    if (loadingText) loadingText.textContent = 'Searching resources...';

    clearResourceSearchIndicator(); // Clear previous indicator

    // Option 1: Client-side filtering (if all data is loaded or cached)
    // This requires a mechanism to ensure all data is available client-side first.
    // filterResourcesClientSide(resourceType, searchTerm, namespace);

    // Option 2: Server-side filtering (more robust for large datasets)
    // Adapt fetchResourceData or use a dedicated search endpoint if available.
    // For now, let's mimic client-side logic but fetch *all* pages first, then filter.
    // WARNING: This is inefficient for large datasets!
    fetchAllPagesAndFilter(resourceType, namespace, searchTerm);

    window.app.lastUserInteraction = Date.now();
}

// Helper to fetch all pages then filter (INEFFICIENT - use server-side search if possible)
async function fetchAllPagesAndFilter(resourceType, namespace, searchTerm) {
    const loadingText = document.getElementById('resourcesLoadingText');
    const progressBar = document.getElementById('resourcesProgressBar');
    let allItems = [];
    let currentPage = 1;
    let totalPages = 1;

    try {
        // Fetch first page to get total count
        if (loadingText) loadingText.textContent = `Fetching initial data for ${resourceType}...`;
        const initialData = await fetchResourcePage(resourceType, namespace, false, 1);
        if (!initialData || !initialData.data) throw new Error('Failed to fetch initial page data.');
        
        allItems = initialData.data.items || [];
        const totalCount = initialData.data.totalCount || allItems.length;
        const pageSize = initialData.data.pageSize || 50;
        totalPages = Math.ceil(totalCount / pageSize);
        if (progressBar) progressBar.style.width = `${(1/totalPages) * 80 + 10}%`; // Update progress

        // Fetch remaining pages
        const pagePromises = [];
        for (let page = 2; page <= totalPages; page++) {
            pagePromises.push(
                fetchResourcePage(resourceType, namespace, false, page).then(data => {
                    if (data && data.data && data.data.items) {
                        return data.data.items;
                    }
                    return [];
                })
            );
        }
        
        if (loadingText) loadingText.textContent = `Fetching all ${totalCount} ${resourceType} items...`;
        const remainingItemsArrays = await Promise.all(pagePromises);
        remainingItemsArrays.forEach((items) => allItems = allItems.concat(items));
        if (progressBar) progressBar.style.width = '90%';

        // Now filter all items
        if (loadingText) loadingText.textContent = `Filtering ${allItems.length} items...`;
        const filteredItems = searchTerm
            ? allItems.filter(item => {
                const name = item.metadata?.name?.toLowerCase() || '';
                const ns = item.metadata?.namespace?.toLowerCase() || '';
                // Add more complex filtering logic here if needed
                return name.includes(searchTerm) || ns.includes(searchTerm);
            })
            : allItems;

        // Update state with filtered items
        const state = window.app.state.resources[resourceType] || {};
        state.items = filteredItems;
        state.totalCount = filteredItems.length;
        state.pageSize = pageSize;
        state.currentPage = 1;
        state.totalPages = Math.ceil(filteredItems.length / pageSize);
        state.loadedPages = Array.from({length: state.totalPages}, (_, i) => i + 1); // All pages are loaded
        state.originalItems = allItems; // Store the full list for clearing filter
        window.app.state.resources[resourceType] = state;
        
        if (progressBar) progressBar.style.width = '100%';
        if (loadingText) loadingText.textContent = 'Rendering results...';

        renderCurrentPage(resourceType); // Renders page 1 of filtered results
        addResourceSearchIndicator(resourceType, searchTerm, filteredItems.length); // Add indicator

    } catch (error) {
        console.error('Error fetching all pages or filtering:', error);
        if (loadingText) loadingText.textContent = `Error: ${error.message}`;
        if (progressBar) progressBar.style.width = '100%'; 
        // Show error in table
        const tableContainer = document.getElementById('resourcesTableContainer');
        if (tableContainer) {
            tableContainer.innerHTML = `<div class="alert alert-danger">Search failed: ${error.message}</div>`;
            tableContainer.style.opacity = '1';
        }
    } finally {
         // Hide loading indicator after a short delay
         const loadingContainer = document.getElementById('resourcesLoading');
         const tableContainer = document.getElementById('resourcesTableContainer');
         setTimeout(() => {
             if (loadingContainer) loadingContainer.style.display = 'none';
             if (tableContainer) tableContainer.style.opacity = '1';
         }, 500);
    }
}

// Clears the search input and results in the explorer
function clearResourceSearch() {
    const searchInput = document.getElementById('resourceSearchInput');
    if (searchInput) searchInput.value = '';
    clearResourceSearchIndicator();
    
    // Restore original items if available, otherwise reload type
    const resourceType = window.app.currentResourceType;
    const state = window.app.state.resources[resourceType];
    if (state && state.originalItems) {
        state.items = [...state.originalItems];
        state.totalCount = state.items.length;
        state.currentPage = 1;
        state.totalPages = Math.ceil(state.totalCount / (state.pageSize || 50));
        state.loadedPages = Array.from({length: state.totalPages}, (_, i) => i + 1);
        delete state.originalItems; // Clear the backup
        renderCurrentPage(resourceType);
    } else {
        loadResourceType(resourceType); // Reload the resource type entirely
    }
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

// Handles pagination navigation (Previous/Next)
function navigateResourcePage(direction) {
    const resourceType = window.app.currentResourceType;
    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData) return;

    let currentPage = resourceData.currentPage || 1;
    const totalPages = resourceData.totalPages || 1;

    if (direction === 'prev' && currentPage > 1) currentPage--;
    else if (direction === 'next' && currentPage < totalPages) currentPage++;
    else return; // No change

    resourceData.currentPage = currentPage;

    // Check if the required page's data is already in state.items (due to fetch-all search or previous load)
    const pageSize = resourceData.pageSize || 50;
    const requiredStartIndex = (currentPage - 1) * pageSize;
    
    // If the needed items are already in the main `items` array (common after a search/filter)
    if (resourceData.items && resourceData.items.length >= requiredStartIndex + 1) {
        console.log(`Rendering page ${currentPage} from existing items for ${resourceType}`);
        updatePaginationUI(resourceType);
        renderResourcePage(resourceType); // Render the specific slice
    } else {
        // If data for the page isn't available, fetch it (original load-more or paged scenario)
        console.log(`Fetching page ${currentPage} for ${resourceType}`);
        const loadingContainer = document.getElementById('resourcesLoading');
        const tableContainer = document.getElementById('resourcesTableContainer');
        if (loadingContainer) loadingContainer.style.display = 'flex';
        if (tableContainer) tableContainer.style.opacity = '0.5';
        
        fetchResourcePage(resourceType, 'all', false, currentPage)
            .then(() => {
                // processResourcePageData updates state and calls renderCurrentPage
            })
            .catch(error => console.error(`Error fetching page ${currentPage}:`, error))
            .finally(() => {
                 if (loadingContainer) loadingContainer.style.display = 'none';
                 if (tableContainer) tableContainer.style.opacity = '1';
            });
    }
    window.app.lastUserInteraction = Date.now();
}

// Renders the specific page of items for the resources explorer table
function renderResourcePage(resourceType) {
    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData || !resourceData.items) {
        console.error(`No data/items found for ${resourceType} in renderResourcePage`);
        return;
    }
    
    const { items, totalCount, pageSize, currentPage } = resourceData;
    const tableBody = document.getElementById('resourcesTableBody');
    if (!tableBody) {
        console.error('Resources table body (#resourcesTableBody) not found.');
        return;
    }

    tableBody.innerHTML = ''; // Clear previous page content

    // Calculate the slice of items for the current page
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageItems = items.slice(startIndex, endIndex);

    if (pageItems.length === 0) {
        const colSpan = document.getElementById('resourcesTableHeader')?.children.length || 7;
        tableBody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No ${resourceType} found on this page.</td></tr>`;
    } else {
        pageItems.forEach(item => {
            const row = createResourceRow(resourceType, item); // Use shared row creation logic
            if (row) tableBody.appendChild(row);
        });
        // Initialize dropdowns for the new rows
        setTimeout(initializeAllDropdowns, 50); 
    }
    
     // Update count info specific to the resources page table container
    const tableContainer = document.getElementById('resourcesTableContainer');
    if (tableContainer) {
        let countInfo = tableContainer.querySelector('.count-info');
        if (!countInfo) {
            countInfo = document.createElement('div');
            countInfo.className = 'text-muted small mb-2 count-info';
            tableContainer.insertBefore(countInfo, tableContainer.firstChild);
        }
        const startItemNum = Math.min(startIndex + 1, totalCount);
        const endItemNum = Math.min(startIndex + pageItems.length, totalCount);
        countInfo.innerHTML = totalCount > 0 ? `Showing ${startItemNum}-${endItemNum} of ${totalCount} ${resourceType}` : `Showing 0 of 0 ${resourceType}`;
    }
}

// Updates the pagination UI controls (buttons, page info)
function updatePaginationUI(resourceType) {
    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData) return;
    
    const currentPage = resourceData.currentPage || 1;
    const totalPages = resourceData.totalPages || 1;

    const paginationInfo = document.getElementById('paginationInfo');
    if (paginationInfo) paginationInfo.textContent = `Page ${currentPage} of ${totalPages}`;

    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
}

// Resets pagination UI to default state (Page 1, disabled buttons)
function resetPaginationUI() {
    const paginationInfo = document.getElementById('paginationInfo');
    if (paginationInfo) paginationInfo.textContent = 'Page 1 of 1';
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) prevPageBtn.disabled = true;
    if (nextPageBtn) nextPageBtn.disabled = true;
} 