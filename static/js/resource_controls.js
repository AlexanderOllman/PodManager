// resource_controls.js

// Adds search, namespace selector, and refresh button to a resource tab
function addResourceControls(resourceType) {
    window.resourceControlsCreated = window.resourceControlsCreated || {};
    if (window.resourceControlsCreated[resourceType]) {
        // console.log(`Controls already marked as created for ${resourceType}, skipping.`);
        return;
    }

    const tabPane = document.getElementById(resourceType);
    if (!tabPane) {
        // console.warn(`Tab pane for ${resourceType} not found when trying to add controls.`);
        return;
    }

    // Check if controls container already exists in the DOM to prevent duplication from multiple calls
    if (tabPane.querySelector('.resource-controls-container')) {
        // console.log(`Controls container already in DOM for ${resourceType}, marking as created.`);
        window.resourceControlsCreated[resourceType] = true;
        return;
    }

    let tableContainer = tabPane.querySelector('.table-responsive');
    if (!tableContainer) {
        // console.warn(`Table container not found in tab ${resourceType} for controls placement.`);
        // As a fallback, create one if other content exists, or prepend to tabPane directly.
        const contentPlaceholder = tabPane.querySelector('div'); // Or any other expected content
        if(contentPlaceholder) {
            tableContainer = document.createElement('div');
            tableContainer.className = 'table-responsive'; 
            // Create a dummy table or expect it to be populated later
            const table = document.createElement('table');
            table.id = `${resourceType}Table`;
            table.className = 'table table-hover table-sm align-middle';
            table.innerHTML = '<thead></thead><tbody></tbody>';
            tableContainer.appendChild(table);
            tabPane.appendChild(tableContainer);
        } else {
            // console.warn(`No suitable place to insert controls for ${resourceType}`);
            return;
        }
    }

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'mb-3 d-flex flex-wrap justify-content-between align-items-center resource-controls-container';

    // Search input
    const searchContainer = document.createElement('div');
    searchContainer.className = 'input-group input-group-sm me-2 mb-2 flex-grow-1';
    searchContainer.style.minWidth = '200px';
    searchContainer.innerHTML = `
        <span class="input-group-text" id="search-addon-${resourceType}"><i class="fas fa-search"></i></span>
        <input type="text" class="form-control" placeholder="Filter ${resourceType}..." id="${resourceType}Search" aria-describedby="search-addon-${resourceType}">
        <button class="btn btn-outline-secondary" type="button" onclick="clearSearch('${resourceType}')" title="Clear search">
            <i class="fas fa-times"></i>
        </button>
    `;

    // Namespace selector
    const namespaceContainer = document.createElement('div');
    namespaceContainer.className = 'namespace-selector me-2 mb-2';
    namespaceContainer.style.minWidth = '200px';
    namespaceContainer.innerHTML = `
        <select class="form-select form-select-sm" id="${resourceType}Namespace" onchange="namespaceChanged('${resourceType}')">
            <option value="all" selected>All Namespaces</option>
            <option value="loading" disabled>Loading namespaces...</option>
        </select>
    `;

    // Refresh button
    const refreshButtonContainer = document.createElement('div');
    refreshButtonContainer.className = 'mb-2';
    const refreshButton = document.createElement('button');
    refreshButton.className = 'btn btn-primary btn-sm';
    refreshButton.innerHTML = `<i class="fas fa-sync-alt me-1"></i> Refresh ${capitalizeFirstLetter(resourceType)}`;
    refreshButton.onclick = function() { 
        if (window.app.state.cache.lastFetch) {
            // Construct cache key similar to how it's made in fetchResourcePage
            const currentNamespace = document.getElementById(`${resourceType}Namespace`)?.value || 'all';
            const cacheKeyPage1 = `${resourceType}-${currentNamespace}-full-1`; 
            delete window.app.state.cache.lastFetch[cacheKeyPage1];
            // Potentially delete from window.app.state.cache.resources too if more robust caching is used
        }
        if(window.app.state.resources[resourceType]) {
            window.app.state.resources[resourceType].loadedPages = []; // Force re-fetch by clearing loaded pages
        }
        fetchResourceData(resourceType, document.getElementById(`${resourceType}Namespace`)?.value || 'all', false, 1, true);
    };
    refreshButtonContainer.appendChild(refreshButton);

    controlsContainer.appendChild(searchContainer);
    controlsContainer.appendChild(namespaceContainer);
    controlsContainer.appendChild(refreshButtonContainer);

    tableContainer.parentNode.insertBefore(controlsContainer, tableContainer);
    window.resourceControlsCreated[resourceType] = true;

    const searchInput = document.getElementById(`${resourceType}Search`);
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener('input', function() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                filterResources(resourceType, this.value);
            }, 300); // 300ms debounce
        });
    }

    loadNamespacesForSelector(resourceType); // Populate the namespace dropdown
}

// Clears the search field for a resource type and resets the filtered view
function clearSearch(resourceType) {
    const searchInput = document.getElementById(`${resourceType}Search`);
    if (searchInput) {
        searchInput.value = '';
    }
    // Restore original items if they were stored
    if (window.app.state.resources[resourceType] && window.app.state.resources[resourceType].originalItems) {
        window.app.state.resources[resourceType].items = [...window.app.state.resources[resourceType].originalItems];
        window.app.state.resources[resourceType].totalCount = window.app.state.resources[resourceType].items.length;
        window.app.state.resources[resourceType].currentPage = 1;
        window.app.state.resources[resourceType].loadedPages = [1]; 
        window.app.state.resources[resourceType].totalPages = Math.ceil(window.app.state.resources[resourceType].totalCount / (window.app.state.resources[resourceType].pageSize || 50));
    } else {
        // If no originalItems, just re-fetch to clear filters server-side or re-process full list client-side
        const currentNamespace = document.getElementById(`${resourceType}Namespace`)?.value || 'all';
        fetchResourceData(resourceType, currentNamespace, false, 1, true);
        return; // fetchResourceData will call renderCurrentPage
    }
    
    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);
}

// Handles namespace selection change for a resource tab
function namespaceChanged(resourceType) {
    const selector = document.getElementById(`${resourceType}Namespace`);
    if (!selector) return;
    const selectedNamespace = selector.value;
    console.log(`Namespace changed to ${selectedNamespace} for ${resourceType}`);

    // Clear last fetch timestamp and loaded pages for this resource type to force a full refresh
    if (window.app.state.cache.lastFetch) {
        // Clear all cache entries for this resourceType or be more specific if needed
        Object.keys(window.app.state.cache.lastFetch).forEach(key => {
            if (key.startsWith(resourceType + '-')) {
                delete window.app.state.cache.lastFetch[key];
            }
        });
    }
    if (window.app.state.resources[resourceType]) {
        window.app.state.resources[resourceType].items = [];
        window.app.state.resources[resourceType].loadedPages = [];
        window.app.state.resources[resourceType].currentPage = 1;
        // Keep totalCount for a moment if you want to show estimated count during load
    }
    
    // Clear search input when namespace changes
    const searchInput = document.getElementById(`${resourceType}Search`);
    if (searchInput) searchInput.value = '';

    fetchResourceData(resourceType, selectedNamespace, false, 1, true); // page 1, reset data
}

// Load namespaces for the selector dropdown in resource tables
function loadNamespacesForSelector(resourceType) {
    const selector = document.getElementById(`${resourceType}Namespace`);
    if (!selector) {
        console.warn(`Namespace selector not found for ${resourceType}`);
        return; // Exit if the selector doesn't exist for this resource type
    }

    // Check if namespaces are already cached globally
    if (window.app.state?.cache?.namespaces) {
        console.log(`Using cached namespaces for ${resourceType} selector`);
        populateNamespaceSelector(resourceType, window.app.state.cache.namespaces);
        return;
    }

    // Show loading state in selector
    const loadingOption = selector.querySelector('option[value="loading"]');
    if(loadingOption) loadingOption.style.display = 'block';
    selector.disabled = true;

    console.log(`Fetching namespaces for ${resourceType} selector...`);
    const url = window.app.getRelativeUrl('/get_namespaces');
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
         })
        .then(data => {
            if (data.namespaces) {
                // Cache namespaces globally in our state management
                window.app.state.cache.namespaces = data.namespaces;
                populateNamespaceSelector(resourceType, data.namespaces);
                document.dispatchEvent(new CustomEvent('namespacesLoaded'));
            } else {
                console.error('Failed to load namespaces:', data.error || 'Invalid data format');
                selector.innerHTML = '<option value="all">All (Error loading)</option>'; // Indicate error
            }
        })
        .catch(error => {
            console.error('Error fetching namespaces for selector:', error);
            selector.innerHTML = '<option value="all">All (Error loading)</option>'; // Indicate error
        })
        .finally(() => {
             if(loadingOption) loadingOption.style.display = 'none';
             selector.disabled = false;
        });
}

// Populates a namespace dropdown with options
function populateNamespaceSelector(resourceType, namespaces) {
    const selector = document.getElementById(`${resourceType}Namespace`);
    if (!selector) return;

    // Clear existing options, keeping only "All Namespaces" and potentially error/loading
    const currentValue = selector.value;
    let allNamespacesOption = selector.querySelector('option[value="all"]');
    selector.innerHTML = ''; // Clear all

    if (allNamespacesOption) {
        selector.appendChild(allNamespacesOption); // Re-add "All Namespaces"
    } else {
        allNamespacesOption = document.createElement('option');
        allNamespacesOption.value = 'all';
        allNamespacesOption.textContent = 'All Namespaces';
        selector.appendChild(allNamespacesOption);
    }

    if (!Array.isArray(namespaces)) {
        console.warn(`Namespaces data for ${resourceType} is not an array:`, namespaces);
        const loadingOption = document.createElement('option');
        loadingOption.value = 'error';
        loadingOption.textContent = 'Invalid namespace data';
        loadingOption.disabled = true;
        selector.appendChild(loadingOption);
        return;
    }

    if (namespaces.length === 0) {
        const noNsOption = document.createElement('option');
        noNsOption.value = 'none';
        noNsOption.textContent = 'No namespaces found';
        noNsOption.disabled = true;
        selector.appendChild(noNsOption);
    } else {
        namespaces.forEach(ns => {
            const option = document.createElement('option');
            option.value = ns;
            option.textContent = ns;
            selector.appendChild(option);
        });
    }
    // Try to restore previous selection if valid, otherwise default to 'all'
    if (namespaces.includes(currentValue)) {
        selector.value = currentValue;
    } else {
        selector.value = 'all';
    }
}

// Sets up click handlers for resource tabs to load data
function setupTabClickHandlers() {
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    resourceTypes.forEach(resourceType => {
        // Ensure controls are added before setting up click handlers that might rely on them
        addResourceControls(resourceType);
        
        const tabButton = document.getElementById(`${resourceType}-tab`);
        if (tabButton) {
            // Clone and replace to remove any old listeners before adding a new one
            const newTabButton = tabButton.cloneNode(true);
            tabButton.parentNode.replaceChild(newTabButton, tabButton);

            newTabButton.addEventListener('click', () => {
                console.log(`Tab ${resourceType} clicked.`);
                const namespaceSelector = document.getElementById(`${resourceType}Namespace`);
                const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
                
                // Check if data is already loaded and not stale for the current namespace view
                const cacheKey = `${resourceType}-${currentNamespace}-full-1`; // Assuming page 1 focus on tab switch
                const lastFetchTime = window.app.state.cache.lastFetch[cacheKey];
                const isDataStale = !lastFetchTime || (Date.now() - lastFetchTime > window.app.CACHE_TIMEOUT);

                if (!window.app.state.resources[resourceType] || 
                    !window.app.state.resources[resourceType].items || 
                    window.app.state.resources[resourceType].items.length === 0 || 
                    isDataStale || 
                    (window.app.state.resources[resourceType].currentNamespace !== currentNamespace) // If namespace changed
                ) {
                    console.log(`Fetching data for ${resourceType} in namespace ${currentNamespace}...`);
                    fetchResourceData(resourceType, currentNamespace, false, 1, true); // page 1, reset data
                    if(window.app.state.resources[resourceType]) {
                        window.app.state.resources[resourceType].currentNamespace = currentNamespace;
                    }
                } else {
                    console.log(`Data for ${resourceType} in ${currentNamespace} is already loaded and fresh. Rendering.`);
                    // Ensure correct items are rendered if namespace context was stored and matches
                    if (typeof renderCurrentPage === 'function') renderCurrentPage(resourceType);
                }
                // Make sure table container is visible (might have been hidden by other tabs)
                const tableContainer = document.getElementById(`${resourceType}TableContainer`);
                if(tableContainer) tableContainer.style.display = 'block';
            });
        }
    });
}

// Adds sorting indicators and click listeners to table headers for a resource type
function addSortingToResourceTable(resourceType) {
    const table = document.getElementById(`${resourceType}Table`);
    if (!table) return;
    const tableHeaders = table.querySelectorAll('thead th[data-sort]');

    tableHeaders.forEach(header => {
        const newHeader = header.cloneNode(true); // Clone to remove old listeners
        header.parentNode.replaceChild(newHeader, header);

        let sortIndicator = newHeader.querySelector('.sort-indicator');
        if (!sortIndicator) {
            sortIndicator = document.createElement('span');
            sortIndicator.className = 'sort-indicator ms-1';
            sortIndicator.innerHTML = '<i class="fas fa-sort text-muted"></i>';
            newHeader.appendChild(sortIndicator);
            newHeader.style.cursor = 'pointer';
        }

        newHeader.addEventListener('click', () => {
            const sortField = newHeader.getAttribute('data-sort');
            let currentSortDirection = 'asc';
            
            // Toggle sort direction
            if (window.app.state.resources[resourceType]?.sortField === sortField) {
                currentSortDirection = window.app.state.resources[resourceType].sortDirection === 'asc' ? 'desc' : 'asc';
            }
            
            // Update global state
            if (!window.app.state.resources[resourceType]) window.app.state.resources[resourceType] = {};
            window.app.state.resources[resourceType].sortField = sortField;
            window.app.state.resources[resourceType].sortDirection = currentSortDirection;

            // Update all header indicators
            table.querySelectorAll('thead th[data-sort] .sort-indicator').forEach(ind => {
                ind.innerHTML = '<i class="fas fa-sort text-muted"></i>';
            });
            sortIndicator.innerHTML = currentSortDirection === 'asc' 
                ? '<i class="fas fa-sort-up text-primary"></i>' 
                : '<i class="fas fa-sort-down text-primary"></i>';

            if (typeof sortResourceData === 'function') {
                sortResourceData(resourceType, sortField, currentSortDirection);
            } else {
                console.warn('sortResourceData function not found.');
            }
        });
    });
} 