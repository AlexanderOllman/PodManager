// resource_data_logic.js

// Main function to fetch resource data, deciding whether to get count first or just a page
function fetchResourceData(resourceType, namespace = 'all', criticalOnly = false, page = 1, resetData = false) {
    console.log(`Fetching ${resourceType} data for namespace ${namespace}${criticalOnly ? ' (critical only)' : ''}, page ${page}, reset: ${resetData}`);

    if (page === 1 && typeof showLoading === 'function') showLoading(resourceType);

    // If resetData is true, or it's the first page and no items/totalCount is known, fetch count first.
    const resourceState = window.app.state.resources[resourceType];
    const shouldFetchCountFirst = resetData || (page === 1 && (!resourceState || resourceState.totalCount === undefined || resourceState.items.length === 0));

    if (shouldFetchCountFirst) {
        return fetchResourceCount(resourceType, namespace)
            .then(count => {
                const loadingText = document.getElementById(`${resourceType}LoadingText`);
                if (loadingText) loadingText.textContent = `Loading ${count} ${resourceType}...`;
                // After count, fetch the first page (or the requested page if it was resetData for a specific page)
                return fetchResourcePage(resourceType, namespace, criticalOnly, page);
            })
            .catch(error => {
                console.error(`Error fetching ${resourceType} count:`, error);
                // Still try to fetch the page even if count fails
                return fetchResourcePage(resourceType, namespace, criticalOnly, page);
            });
    } else {
        return fetchResourcePage(resourceType, namespace, criticalOnly, page);
    }
}

// Processes a fetched page of resource data and updates the application state
function processResourcePageData(resourceType, data, page) {
    const processingStartTime = performance.now();

    if (!window.app.state.resources[resourceType]) {
        window.app.state.resources[resourceType] = {
            items: [],
            totalCount: 0,
            currentPage: 1,
            pageSize: 50, // Default, can be updated from data
            loadedPages: []
        };
    }
    const state = window.app.state.resources[resourceType];

    // Ensure data and data.data exist
    if (!data || !data.data) {
        console.error("Received invalid data object in processResourcePageData for", resourceType, data);
        if (typeof hideLoading === 'function') hideLoading(resourceType);
        // Potentially render an error message in the UI here
        return;
    }

    const newItems = data.data.items || [];
    
    // If it's the first page OR if the page isn't already in loadedPages (e.g. reset scenario)
    if (page === 1 || !state.loadedPages.includes(page)) {
        if (page === 1) { // For page 1, always reset items and loadedPages
            state.items = [];
            state.loadedPages = [];
        }
        state.items = [...state.items, ...newItems]; // Append new items
        if (!state.loadedPages.includes(page)) {
             state.loadedPages.push(page);
             state.loadedPages.sort((a, b) => a - b); // Keep loadedPages sorted
        }
    } else {
        // This case (page > 1 and page already loaded) should ideally not happen if logic is correct,
        // but if it does, it means we might be re-fetching an already loaded page for some reason.
        // For now, we can assume items are already there, or decide to replace them if necessary.
        console.warn(`Page ${page} for ${resourceType} was re-processed. Check fetching logic.`);
    }

    state.totalCount = data.data.totalCount !== undefined ? data.data.totalCount : state.items.length;
    state.pageSize = data.data.pageSize || state.pageSize || 50;
    state.totalPages = Math.ceil(state.totalCount / state.pageSize);
    state.currentPage = page; // Update current page based on what was fetched and processed

    // If it's the first page of pods, update dashboard metrics
    if (page === 1 && resourceType === 'pods' && typeof updateDashboardMetrics === 'function') {
        console.log('Updating dashboard metrics with data from', newItems.length, 'pods on page 1');
        updateDashboardMetrics(state.items); // Pass all currently loaded items for accurate metrics
    }

    // Add sorting functionality to the table headers if this is the first page load for the table
    if (page === 1 && typeof addSortingToResourceTable === 'function') {
        setTimeout(() => addSortingToResourceTable(resourceType), 100); 
    }
    
    // If a sort field is set, re-sort all items after new data is added
    if (state.sortField && typeof sortResourceData === 'function') {
        sortResourceData(resourceType, state.sortField, state.sortDirection);
    }

    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);
    else console.warn('renderCurrentPage function not found after processing page data.');

    if (page === 1 && typeof hideLoading === 'function') hideLoading(resourceType);
    
    const processTime = performance.now() - processingStartTime;
    console.log(`${resourceType} page ${page} processed in ${processTime.toFixed(0)}ms. Total items now: ${state.items.length}`);
}


// Filter resources displayed in a table based on a search term
function filterResources(resourceType, searchTermProvided) {
    let searchInput = document.getElementById(`${resourceType}Search`);
    if (!searchInput) searchInput = document.querySelector(`input[placeholder^="Filter ${resourceType}"]`);
    if (!searchInput) searchInput = document.querySelector(`#${resourceType} input[type="search"], #${resourceType} input[type="text"]`);
    
    const searchTerm = searchTermProvided !== undefined ? searchTermProvided.toLowerCase() : (searchInput ? searchInput.value.toLowerCase() : '');

    // Use the full dataset from the primary cache if available, otherwise from current state
    // This assumes window.app.state.cache.resources stores the *unfiltered* master list for each type after initial full fetch.
    // If not, this needs adjustment. For now, let's assume app.state.resources[resourceType].items is the source of truth *before* filtering.
    
    // Get the full dataset (original items before any client-side filtering)
    // It's crucial to have a consistent source for the full dataset.
    // Let's assume `window.app.state.cache.resources[resourceType + '-all-full-allpages']` (or similar key) holds all items if fetched.
    // For now, we'll work with what `fetchResourcePage` populates into `state.items` assuming it aggregates.
    // This part is tricky without knowing exactly how all items are aggregated before filtering.
    // Let's assume `window.app.state.resources[resourceType].originalItems` is populated if we want to preserve an unfiltered list.
    // For now, this will filter the *currently displayed* items if not careful.

    // To implement filtering correctly, we need a definitive source of *all* items.
    // Let's assume `window.app.state.resources[resourceType].allItems` gets populated elsewhere with all items for this resourceType.
    // If not, the filter will only work on the currently loaded page(s).
    
    const allItems = window.app.state.resources[resourceType]?.allItems || window.app.state.resources[resourceType]?.items || [];
    if (!window.app.state.resources[resourceType].originalItems && window.app.state.resources[resourceType].items.length > 0) {
        // Store the original full list of items before filtering for the first time
        window.app.state.resources[resourceType].originalItems = [...window.app.state.resources[resourceType].items];
    }
    
    const sourceItems = window.app.state.resources[resourceType].originalItems || allItems;

    const filteredItems = searchTerm
        ? sourceItems.filter(item => {
            const name = item.metadata?.name?.toLowerCase() || '';
            const namespace = item.metadata?.namespace?.toLowerCase() || '';
            // Add more sophisticated search logic if needed (e.g., search by status, labels, etc.)
            return name.includes(searchTerm) || namespace.includes(searchTerm);
        })
        : [...sourceItems]; // If no search term, show all original items

    // Update the displayed items and reset pagination for the filtered view
    window.app.state.resources[resourceType].items = filteredItems;
    window.app.state.resources[resourceType].totalCount = filteredItems.length; // Total count is now the filtered count
    window.app.state.resources[resourceType].currentPage = 1;
    window.app.state.resources[resourceType].loadedPages = [1]; // Only page 1 of filtered results is initially "loaded"
    window.app.state.resources[resourceType].totalPages = Math.ceil(filteredItems.length / (window.app.state.resources[resourceType].pageSize || 50));

    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);

    // Add a "no results" message if needed
    if (filteredItems.length === 0 && searchTerm) {
        const tableBody = selectTableBody(resourceType);
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center py-4">
                        <i class="fas fa-search me-2 text-muted"></i>
                        No resources found matching "<span class="fw-bold">${searchTerm}</span>".
                        <button class="btn btn-sm btn-outline-secondary ms-3" onclick="clearSearch('${resourceType}')">
                            <i class="fas fa-times me-1"></i> Clear Search
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}

// Sorts the currently loaded resource data based on a field and direction
function sortResourceData(resourceType, sortField, sortDirection) {
    const state = window.app.state.resources[resourceType];
    if (!state || !state.items || !state.items.length) return;

    state.items.sort((a, b) => {
        let valueA, valueB;

        // Extract values based on sortField
        if (sortField === 'name') {
            valueA = a.metadata?.name?.toLowerCase() || '';
            valueB = b.metadata?.name?.toLowerCase() || '';
        } else if (sortField === 'namespace') {
            valueA = a.metadata?.namespace?.toLowerCase() || '';
            valueB = b.metadata?.namespace?.toLowerCase() || '';
        } else if (sortField === 'status') {
            valueA = a.status?.phase?.toLowerCase() || '';
            valueB = b.status?.phase?.toLowerCase() || '';
        } else if (sortField === 'age') {
            valueA = new Date(a.metadata?.creationTimestamp || 0).getTime();
            valueB = new Date(b.metadata?.creationTimestamp || 0).getTime();
        } else if (['cpu', 'gpu', 'memory'].includes(sortField)) {
            const usageA = typeof getResourceUsage === 'function' ? getResourceUsage(a) : {};
            const usageB = typeof getResourceUsage === 'function' ? getResourceUsage(b) : {};
            if (sortField === 'cpu') {
                valueA = parseFloat(usageA.cpu) || 0;
                valueB = parseFloat(usageB.cpu) || 0;
            } else if (sortField === 'gpu') {
                valueA = parseInt(usageA.gpu) || 0;
                valueB = parseInt(usageB.gpu) || 0;
            } else { // memory
                valueA = parseFloat(String(usageA.memory).replace('Mi', '')) || 0;
                valueB = parseFloat(String(usageB.memory).replace('Mi', '')) || 0;
            }
        } else {
            // Fallback for unhandled sort fields or custom fields
            valueA = a[sortField] || '';
            valueB = b[sortField] || '';
        }
        
        // Perform comparison
        let comparison = 0;
        if (typeof valueA === 'number' && typeof valueB === 'number') {
            comparison = valueA - valueB;
        } else {
            comparison = String(valueA).localeCompare(String(valueB));
        }
        return sortDirection === 'asc' ? comparison : -comparison;
    });

    // After sorting, reset current page to 1 and re-render
    state.currentPage = 1;
    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);
} 