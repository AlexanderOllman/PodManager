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

// Fetch a specific page of resources
function fetchResourcePage(resourceType, namespace = 'all', criticalOnly = false, page = 1) {
    const pageSize = 50;
    const cacheKey = `${resourceType}-${namespace}-${criticalOnly ? 'critical' : 'full'}-${page}`;
    const lastFetch = window.app.state.lastFetch[cacheKey];

    if (lastFetch && (Date.now() - lastFetch) < window.app.CACHE_TIMEOUT) {
        const cachedData = window.app.state.cache.resources[cacheKey]; // Corrected to use app.state.cache
        if (cachedData) {
            console.log(`Using cached data for ${resourceType} (${namespace}), page ${page}`);
            if (typeof processResourcePageData === 'function') processResourcePageData(resourceType, cachedData, page);
            if (page === 1 && typeof hideLoading === 'function') hideLoading(resourceType);
            return Promise.resolve(cachedData);
        }
    }

    const startTime = performance.now();
    const formData = new FormData();
    formData.append('resource_type', resourceType);
    formData.append('namespace', namespace);
    formData.append('critical_only', criticalOnly.toString());
    formData.append('page', page.toString());
    formData.append('page_size', pageSize.toString());

    const url = window.app.getRelativeUrl('/get_resources');
    return fetch(url, { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
            return response.json();
        })
        .then(data => {
            console.log(`Fetched ${resourceType} data for page ${page} in ${Math.round(performance.now() - startTime)}ms`);
            window.app.state.lastFetch[cacheKey] = Date.now();
            window.app.state.cache.resources[cacheKey] = data; // Corrected to use app.state.cache
            
            if (typeof processResourcePageData === 'function') processResourcePageData(resourceType, data, page);
            if (page === 1 && typeof hideLoading === 'function') hideLoading(resourceType);
            return data;
        })
        .catch(error => {
            console.error(`Error fetching ${resourceType} page ${page}:`, error);
            if (page === 1) {
                if (typeof hideLoading === 'function') hideLoading(resourceType);
                const tableContainer = document.getElementById(`${resourceType}TableContainer`);
                if (tableContainer) {
                    tableContainer.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="fas fa-exclamation-triangle me-2"></i>
                            Error loading ${resourceType}: ${error.message}
                            <button class="btn btn-sm btn-outline-danger ms-3" onclick="fetchResourceData('${resourceType}', '${namespace}', ${criticalOnly}, 1, true)">
                            <i class="fas fa-sync-alt me-1"></i> Retry
                            </button>
                        </div>
                    `;
                }
            }
            throw error; // Re-throw to allow further error handling
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