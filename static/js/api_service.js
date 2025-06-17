// api_service.js

// Fetch cluster capacity information
function fetchClusterCapacity() {
    console.log('Fetching cluster capacity information...');
    if (!window.clusterCapacity) {
        window.clusterCapacity = { cpu: 256, memory: 1024, gpu: 8 }; // Defaults
    }

    const podsLoadingDetails = document.getElementById('podsLoadingDetails');
    if (podsLoadingDetails && document.getElementById('podsLoading')?.style.display !== 'none') {
        podsLoadingDetails.textContent = 'Fetching cluster capacity information...';
    }

    const url = window.app.getRelativeUrl('/get_cluster_capacity');
    return fetch(url)
        .then(response => {
            if (!response.ok) throw new Error(`Failed to fetch cluster capacity: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.cpu && !isNaN(parseFloat(data.cpu))) window.clusterCapacity.cpu = parseFloat(data.cpu);
            if (data.memory && !isNaN(parseFloat(data.memory))) window.clusterCapacity.memory = parseFloat(data.memory);
            if (data.gpu !== undefined && !isNaN(parseInt(data.gpu))) window.clusterCapacity.gpu = parseInt(data.gpu);
            
            console.log(`Cluster capacity loaded: ${window.clusterCapacity.cpu} CPU cores, ${window.clusterCapacity.memory} Gi memory, ${window.clusterCapacity.gpu} GPUs`);
            
            const cpuCapacityElement = document.getElementById('totalCPUCapacity');
            if (cpuCapacityElement) cpuCapacityElement.textContent = window.clusterCapacity.cpu;
            
            if (window.app.state?.resources?.pods?.data?.items && typeof updateDashboardMetrics === 'function') {
                console.log('Recalculating metrics with updated capacity');
                updateDashboardMetrics(window.app.state.resources.pods.data.items);
            }
            if (podsLoadingDetails && document.getElementById('podsLoading')?.style.display !== 'none') {
                podsLoadingDetails.textContent = 'Cluster capacity information loaded';
            }
            return data;
        })
        .catch(error => {
            console.warn(`Error fetching cluster capacity: ${error.message}. Using default values.`);
            window.clusterCapacity = window.clusterCapacity || { cpu: 256, memory: 1024, gpu: 8 };
            const cpuCapacityElement = document.getElementById('totalCPUCapacity');
            if (cpuCapacityElement) cpuCapacityElement.textContent = window.clusterCapacity.cpu;
            if (podsLoadingDetails && document.getElementById('podsLoading')?.style.display !== 'none') {
                podsLoadingDetails.textContent = 'Using default cluster capacity values';
            }
            return window.clusterCapacity;
        });
}

// Fetch just the resource count
function fetchResourceCount(resourceType, namespace = 'all') {
    console.log(`Fetching count for ${resourceType} in namespace ${namespace}`);
    const formData = new FormData();
    formData.append('resource_type', resourceType);
    formData.append('namespace', namespace);
    formData.append('count_only', 'true');
    
    const url = window.app.getRelativeUrl('/get_resources');
    return fetch(url, { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
            return response.json();
        })
        .then(data => {
            const count = data.data?.totalCount || 0;
            console.log(`${resourceType} count: ${count}`);
            if (!window.app.state.resources[resourceType]) {
                window.app.state.resources[resourceType] = {
                    items: [], totalCount: count, currentPage: 1, pageSize: 50, loadedPages: []
                };
            } else {
                window.app.state.resources[resourceType].totalCount = count;
            }
            return count;
        });
}

// Fetch a specific page of resources (or potentially all if pageSize is large)
function fetchResourcePage(resourceType, namespace = 'all', page = 1, pageSize = 50) {
    console.log(`Fetching page ${page} size ${pageSize} for ${resourceType} in ${namespace}`);
    const cacheKey = `${resourceType}-${namespace}-page${page}-size${pageSize}`; // Specific cache key
    const lastFetch = window.app.state.lastFetch[cacheKey];

    // Skip cache if pageSize is very large (likely a fetchAll request)
    const skipCache = pageSize > 500;

    if (!skipCache && lastFetch && (Date.now() - lastFetch) < window.app.CACHE_TIMEOUT) {
        const cachedData = window.app.state.cache.resources[cacheKey];
        if (cachedData) {
            console.log(`Using cached data for ${resourceType} (${namespace}), page ${page}, size ${pageSize}`);
            if (typeof processResourcePageData === 'function') processResourcePageData(resourceType, cachedData, page, pageSize);
            if (page === 1 && typeof hideLoading === 'function') hideLoading(resourceType);
            return Promise.resolve(cachedData);
        }
    }

    const startTime = performance.now();
    const formData = new FormData();
    formData.append('resource_type', resourceType);
    formData.append('namespace', namespace);
    // critical_only parameter removed for simplicity, can be added back if needed
    formData.append('page', page.toString());
    formData.append('page_size', pageSize.toString());

    const url = window.app.getRelativeUrl('/get_resources');
    return fetch(url, { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
            return response.json();
        })
        .then(data => {
            console.log(`Fetched ${resourceType} page ${page}, size ${pageSize} in ${Math.round(performance.now() - startTime)}ms`);
            // Only cache if it's not a fetchAll request
            if (!skipCache) {
                window.app.state.lastFetch[cacheKey] = Date.now();
                window.app.state.cache.resources[cacheKey] = data;
            }
            
            if (typeof processResourcePageData === 'function') processResourcePageData(resourceType, data, page, pageSize);
            if (page === 1 && typeof hideLoading === 'function') hideLoading(resourceType);
            return data;
        })
        .catch(error => {
            console.error(`Error fetching ${resourceType} page ${page}, size ${pageSize}:`, error);
            if (page === 1) {
                if (typeof hideLoading === 'function') hideLoading(resourceType);
                 const tableContainer = document.getElementById('resourcesTableContainer') || document.getElementById(`${resourceType}TableContainer`);
                 if (tableContainer) {
                    let errorMsgContainer = tableContainer.querySelector('.fetch-error-message');
                    if (!errorMsgContainer) {
                        errorMsgContainer = document.createElement('div');
                        errorMsgContainer.className = 'alert alert-danger fetch-error-message';
                        tableContainer.prepend(errorMsgContainer);
                    }
                    errorMsgContainer.innerHTML = `
                         <i class="fas fa-exclamation-triangle me-2"></i> Error loading ${resourceType}: ${error.message}
                         <button class="btn btn-sm btn-outline-danger ms-3" onclick="fetchResourceData('${resourceType}', '${namespace}', ${pageSize > 500}, 1, true)">
                         <i class="fas fa-sync-alt me-1"></i> Retry
                         </button>
                    `;
                 }
            }
            throw error;
        });
}

// Fetch namespaces (for selectors and events tab)
function fetchNamespacesForSelectors() {
    // Renamed to avoid conflict if another fetchNamespaces exists for a different purpose
    if (window.app.namespaces) { // Check a global cache if you prefer
        // If using a global cache: populateNamespaceSelector(resourceType, window.app.namespaces);
        // Dispatch custom event if it relies on this specific fetch
        document.dispatchEvent(new CustomEvent('namespacesLoadedForSelector'));
        return Promise.resolve(window.app.namespaces);
    }
    const url = window.app.getRelativeUrl('/get_namespaces');
    return fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.namespaces) {
                window.app.namespaces = data.namespaces; // Cache globally if desired
                // Example: populate selectors for all resource types if this is a general fetch
                // const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
                // resourceTypes.forEach(rt => populateNamespaceSelector(rt, data.namespaces));
                document.dispatchEvent(new CustomEvent('namespacesLoadedForSelector', { detail: data.namespaces }));
                return data.namespaces;
            } else {
                console.error('Failed to load namespaces:', data.error);
                return []; // Return empty array on error
            }
        })
        .catch(error => {
            console.error('Error loading namespaces for selectors:', error);
            return []; // Return empty array on error
        });
}

// Function to refresh the database cache on the server
function refreshDatabase() {
    const statusDiv = document.getElementById('databaseRefreshStatus');
    if (!statusDiv) {
        console.warn('databaseRefreshStatus element not found for displaying status.');
        // Fallback to a simple alert or console log if UI element is missing
        alert('Refreshing database...'); 
    } else {
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = `<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Refreshing database...</div>`;
    }

    const url = window.app.getRelativeUrl('/api/refresh-database');
    fetch(url, { method: 'POST' })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            if (statusDiv) statusDiv.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle"></i> ${data.message}</div>`;
            else alert(`Database refreshed: ${data.message}`);
            
            // Refresh current view based on active tab
            if (window.app.state.navigation.activeTab === 'home' && typeof initializeHomePage === 'function') {
                initializeHomePage();
            } else if (window.app.state.navigation.activeTab === 'resources' && typeof loadResourcesPage === 'function') {
                loadResourcesPage();
            }
            // Add more conditions for other tabs if necessary
        } else {
            if (statusDiv) statusDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> Error: ${data.error}</div>`;
            else alert(`Error refreshing database: ${data.error}`);
        }
        if (statusDiv) setTimeout(() => { statusDiv.style.display = 'none'; }, 5000);
    })
    .catch(error => {
        if (statusDiv) statusDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> Error: ${error}</div>`;
        else alert(`Error refreshing database: ${error}`);
        if (statusDiv) setTimeout(() => { statusDiv.style.display = 'none'; }, 5000);
    });
}

// === Functions moved from resource_data_logic.js ===

// Main function to fetch resource data
function fetchResourceData(resourceType, namespace = 'all', fetchAll = false, page = 1, resetData = true) {
    console.log(`Fetching ${resourceType} data for ns ${namespace}, fetchAll: ${fetchAll}, page ${page}, reset: ${resetData}`);

    if (page === 1 && typeof showLoading === 'function') showLoading(resourceType);

    // Determine page size and which page to fetch
    const pageSize = fetchAll ? 10000 : 50; // Use large number for fetchAll
    const targetPage = fetchAll ? 1 : page; // Always fetch page 1 if fetching all
    
    // Always reset data in state if fetching all
    if (fetchAll) {
         resetData = true;
         if (window.app.state.resources[resourceType]) {
            window.app.state.resources[resourceType].items = [];
            window.app.state.resources[resourceType].loadedPages = [];
         }
    }

    // Fetch count first only if specifically resetting page 1 and not fetching all
    const resourceState = window.app.state.resources[resourceType];
    const shouldFetchCountFirst = resetData && !fetchAll && targetPage === 1 && (!resourceState || resourceState.totalCount === undefined || resourceState.items.length === 0);

    if (shouldFetchCountFirst) {
        return fetchResourceCount(resourceType, namespace)
            .then(count => {
                const loadingText = document.getElementById(`${resourceType}LoadingText`);
                if (loadingText) loadingText.textContent = `Loading ${count} ${resourceType}...`;
                return fetchResourcePage(resourceType, namespace, targetPage, pageSize); 
            })
            .catch(error => {
                console.error(`Error fetching ${resourceType} count:`, error);
                return fetchResourcePage(resourceType, namespace, targetPage, pageSize);
            });
    } else {
        return fetchResourcePage(resourceType, namespace, targetPage, pageSize);
    }
}

// Processes a fetched page of resource data and updates the application state
function processResourcePageData(resourceType, data, page, pageSize = 50) {
    if (!data || !data.data) {
        console.error("Invalid or empty data received from API for:", resourceType);
        return;
    }

    // New logic: Only update dashboard metrics if cluster_metrics is present
    if (data.data.cluster_metrics && typeof updateDashboardMetrics === 'function') {
        updateDashboardMetrics(data.data);
    }

    const resourceData = window.app.state.resources[resourceType];
    if (!resourceData) {
        window.app.state.resources[resourceType] = { items: [], totalCount: 0, currentPage: 1, pageSize: pageSize, loadedPages: [] };
    }

    const processingStartTime = performance.now();

    state = window.app.state.resources[resourceType];
    state.pageSize = pageSize; 

    const newItems = data.data.items || [];
    
    // If page size is large, assume it's a fetchAll response and replace items
    const isFetchAll = pageSize > 500;

    if (page === 1 || isFetchAll) {
        state.items = newItems; // Replace items on page 1 load or fetchAll
        state.loadedPages = [1];
    } else {
        // Append logic for standard pagination (if needed in future)
        if (!state.loadedPages.includes(page)) {
            state.items = [...state.items, ...newItems];
            state.loadedPages.push(page);
            state.loadedPages.sort((a, b) => a - b);
        } else {
            console.warn(`Page ${page} for ${resourceType} was re-processed.`);
        }
    }

    state.totalCount = data.data.totalCount !== undefined ? data.data.totalCount : state.items.length;
    state.totalPages = isFetchAll ? 1 : Math.ceil(state.totalCount / state.pageSize); // Only 1 page if fetchAll
    state.currentPage = isFetchAll ? 1 : page;

    if (page === 1 && resourceType === 'pods' && typeof updateDashboardMetrics === 'function') {
        console.log('Updating dashboard metrics with data from', newItems.length, 'pods on page 1');
        updateDashboardMetrics(state.items); 
    }

    if (page === 1 && typeof addSortingToResourceTable === 'function') {
        setTimeout(() => addSortingToResourceTable(resourceType), 100); 
    }
    
    if (state.sortField && typeof sortResourceData === 'function') {
        sortResourceData(resourceType, state.sortField, state.sortDirection);
    }

    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);
    else console.warn('renderCurrentPage function not found after processing page data.');

    if (page === 1 && typeof hideLoading === 'function') hideLoading(resourceType);
    
    const processTime = performance.now() - processingStartTime;
    console.log(`${resourceType} page ${page} processed in ${processTime.toFixed(0)}ms. Total items: ${state.items.length} / ${state.totalCount}`);
}

// Filter resources displayed in a table based on a search term
// NOTE: This is data *manipulation*, not direct API service. Consider moving 
// filterResources and sortResourceData to a different module like ui_helpers.js or resource_controls.js?
// For now, leaving here for consolidation, but might need further refactoring.
function filterResources(resourceType, searchTermProvided) {
    let searchInput = document.getElementById(`${resourceType}Search`);
    if (!searchInput) searchInput = document.querySelector(`input[placeholder^="Filter ${resourceType}"]`);
    if (!searchInput) searchInput = document.querySelector(`#${resourceType} input[type="search"], #${resourceType} input[type="text"]`);
    
    const searchTerm = searchTermProvided !== undefined ? searchTermProvided.toLowerCase() : (searchInput ? searchInput.value.toLowerCase() : '');

    const state = window.app.state.resources[resourceType];
    if (!state) return; // No state for this resource type

    // Ensure originalItems exists before filtering
    if (!state.originalItems && state.items) {
        state.originalItems = [...state.items];
    }
    
    const sourceItems = state.originalItems || state.items || [];

    const filteredItems = searchTerm
        ? sourceItems.filter(item => {
            const name = item.metadata?.name?.toLowerCase() || '';
            const namespace = item.metadata?.namespace?.toLowerCase() || '';
            return name.includes(searchTerm) || namespace.includes(searchTerm);
        })
        : [...(state.originalItems || sourceItems)]; // Show original items if search is cleared

    state.items = filteredItems;
    state.totalCount = filteredItems.length;
    state.currentPage = 1;
    state.loadedPages = [1]; 
    state.totalPages = Math.ceil(filteredItems.length / (state.pageSize || 50));

    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);

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
// NOTE: Like filterResources, consider moving this to a UI/control module.
function sortResourceData(resourceType, sortField, sortDirection) {
    const state = window.app.state.resources[resourceType];
    if (!state || !state.items || !state.items.length) return;

    state.items.sort((a, b) => {
        let valueA, valueB;
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
            valueA = a[sortField] || '';
            valueB = b[sortField] || '';
        }
        
        let comparison = 0;
        if (typeof valueA === 'number' && typeof valueB === 'number') {
            comparison = valueA - valueB;
        } else {
            comparison = String(valueA).localeCompare(String(valueB));
        }
        return sortDirection === 'asc' ? comparison : -comparison;
    });

    state.currentPage = 1;
    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);
} 