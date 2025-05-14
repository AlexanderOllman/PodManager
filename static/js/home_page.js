// home_page.js

// Helper to update text content safely
function updateTextContent(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
    } else {
        console.warn(`Element with ID ${id} not found for text update.`);
    }
}

// Helper to update progress bar width and aria-valuenow
function updateProgress(id, percentage) {
    const element = document.getElementById(id);
    if (element) {
        const p = Math.max(0, Math.min(100, Math.round(percentage)));
        element.style.width = `${p}%`;
        element.setAttribute('aria-valuenow', String(p)); // Ensure string for attribute
    } else {
        console.warn(`Element with ID ${id} not found for progress update.`);
    }
}

// Helper to format numbers to a fixed number of decimal places or as integer
function formatNumber(num, decimals = 1) {
    if (typeof num !== 'number' || isNaN(num)) {
        return 'N/A';
    }
    if (decimals === 0) {
        return num.toFixed(0);
    }
    return num.toFixed(decimals);
}

// Fetches and displays the new dashboard metrics from the API
async function fetchAndDisplayDashboardMetrics() {
    console.log('Fetching dashboard environment metrics...');
    const loadingText = 'Loading...';
    // Set initial loading texts
    updateTextContent('podCapacityUsage', loadingText);
    updateTextContent('podPercentageRunning', '');
    updateProgress('podUsageBar', 0);

    updateTextContent('vCpuAllocation', loadingText);
    updateTextContent('vCpuPercentageUtilized', '');
    updateTextContent('vCpuOverProvisioning', '');
    updateProgress('vCpuUsageBar', 0);

    updateTextContent('ramAllocation', loadingText);
    updateTextContent('ramPercentageUtilized', '');
    updateTextContent('ramOverProvisioning', '');
    updateProgress('ramUsageBar', 0);

    updateTextContent('gpuAllocation', loadingText);
    updateTextContent('gpuPercentageUtilized', '');
    updateProgress('gpuUsageBar', 0);

    try {
        const response = await fetch('/api/environment_metrics');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const metrics = await response.json();
        console.log('Dashboard metrics received:', metrics);

        // Pods
        if (metrics.pods) {
            const running = metrics.pods.running || 0;
            const totalPods = metrics.pods.count || 0; // Total actual pods
            updateTextContent('podCapacityUsage', `${formatNumber(running, 0)} / ${formatNumber(totalPods, 0)} Pods`);
            const podPercentage = totalPods > 0 ? (running / totalPods) * 100 : 0;
            updateTextContent('podPercentageRunning', `${formatNumber(podPercentage, 0)}% Running`);
            updateProgress('podUsageBar', podPercentage);
        } else {
            updateTextContent('podCapacityUsage', 'N/A');
            updateTextContent('podPercentageRunning', '');
            updateProgress('podUsageBar', 0);
        }

        // CPU
        if (metrics.cpu) {
            const utilized = metrics.cpu.utilized_cores || 0;
            const allocatable = metrics.cpu.allocatable_cores || 0;
            const limit = metrics.cpu.over_provisioning_limit_cores;

            updateTextContent('vCpuAllocation', `${formatNumber(utilized, 1)} / ${formatNumber(allocatable, 1)} Cores`);
            const cpuPercentage = allocatable > 0 ? (utilized / allocatable) * 100 : 0;
            updateTextContent('vCpuPercentageUtilized', `${formatNumber(cpuPercentage, 0)}% Utilized`);
            updateProgress('vCpuUsageBar', cpuPercentage);
            if (limit !== undefined && limit !== null) {
                updateTextContent('vCpuOverProvisioning', `Limit: ${formatNumber(limit, 1)} Cores`);
            } else {
                 updateTextContent('vCpuOverProvisioning', 'Limit: N/A');
            }
        } else {
            updateTextContent('vCpuAllocation', 'N/A');
            updateTextContent('vCpuPercentageUtilized', '');
            updateTextContent('vCpuOverProvisioning', '');
            updateProgress('vCpuUsageBar', 0);
        }

        // RAM
        if (metrics.ram) {
            const utilized = metrics.ram.utilized_gb || 0;
            const allocatable = metrics.ram.allocatable_gb || 0;
            const limit = metrics.ram.over_provisioning_limit_gb;

            updateTextContent('ramAllocation', `${formatNumber(utilized, 1)} / ${formatNumber(allocatable, 1)} GB`);
            const ramPercentage = allocatable > 0 ? (utilized / allocatable) * 100 : 0;
            updateTextContent('ramPercentageUtilized', `${formatNumber(ramPercentage, 0)}% Utilized`);
            updateProgress('ramUsageBar', ramPercentage);
            if (limit !== undefined && limit !== null) {
                updateTextContent('ramOverProvisioning', `Limit: ${formatNumber(limit, 1)} GB`);
            } else {
                updateTextContent('ramOverProvisioning', 'Limit: N/A');
            }
        } else {
             updateTextContent('ramAllocation', 'N/A');
             updateTextContent('ramPercentageUtilized', '');
             updateTextContent('ramOverProvisioning', '');
             updateProgress('ramUsageBar', 0);
        }

        // GPU
        if (metrics.gpu) {
            const utilized = metrics.gpu.utilized_units || 0;
            const allocatable = metrics.gpu.allocatable_units || 0;

            updateTextContent('gpuAllocation', `${formatNumber(utilized, 0)} / ${formatNumber(allocatable, 0)} Units`);
            const gpuPercentage = allocatable > 0 ? (utilized / allocatable) * 100 : 0;
            updateTextContent('gpuPercentageUtilized', `${formatNumber(gpuPercentage, 0)}% Utilized`);
            updateProgress('gpuUsageBar', gpuPercentage);
        } else {
            updateTextContent('gpuAllocation', 'N/A');
            updateTextContent('gpuPercentageUtilized', '');
            updateProgress('gpuUsageBar', 0);
        }

    } catch (error) {
        console.error('Failed to fetch or display dashboard metrics:', error);
        updateTextContent('podCapacityUsage', 'Error');
        updateTextContent('podPercentageRunning', '');
        updateTextContent('vCpuAllocation', 'Error');
        updateTextContent('vCpuPercentageUtilized', '');
        updateTextContent('vCpuOverProvisioning', '');
        updateTextContent('ramAllocation', 'Error');
        updateTextContent('ramPercentageUtilized', '');
        updateTextContent('ramOverProvisioning', '');
        updateTextContent('gpuAllocation', 'Error');
        updateTextContent('gpuPercentageUtilized', '');
        // Reset progress bars on error too
        updateProgress('podUsageBar', 0);
        updateProgress('vCpuUsageBar', 0);
        updateProgress('ramUsageBar', 0);
        updateProgress('gpuUsageBar', 0);
    }
}

// Initialize or reinitialize the home page (called on initial load and navigation to home)
function initializeHomePage() {
    console.log('Initializing home page...');
    fetchAndDisplayDashboardMetrics(); // Fetch and display new dashboard metrics

    // Check if returning from pod view and force reload if necessary
    const returningFromPodView = sessionStorage.getItem('returning_from_pod_view') === 'true';
    if (returningFromPodView) {
        console.log('Detected return from pod view - forcing reload of resources');
        sessionStorage.removeItem('returning_from_pod_view');
        // Force reset of cached resources for home page tabs
        const homePageTabs = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
        homePageTabs.forEach(tab => {
            if (window.app.state.cache.resources) delete window.app.state.cache.resources[tab];
            if (window.app.state.cache.lastFetch) delete window.app.state.cache.lastFetch[tab];
            if (window.app.state.resources[tab]) {
                window.app.state.resources[tab].items = [];
                window.app.state.resources[tab].loadedPages = [];
            }
        });
    }

    // Reset resources if navigating back to home or returning from pod view
    if (window.app.state.navigation?.isNavigating || returningFromPodView) {
        console.log('Resetting resources for home page due to navigation or pod view return.');
        // Similar reset as above, ensure all home page related resource states are cleared
        const homePageTabs = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
        homePageTabs.forEach(tab => {
            if (window.app.state.cache.resources) delete window.app.state.cache.resources[tab];
            if (window.app.state.cache.lastFetch) delete window.app.state.cache.lastFetch[tab];
             if (window.app.state.resources[tab]) {
                window.app.state.resources[tab].items = [];
                window.app.state.resources[tab].loadedPages = [];
                window.app.state.resources[tab].currentPage = 1;
                window.app.state.resources[tab].totalCount = 0;
            }
        });
        window.app.state.navigation.isNavigating = false;

        if (typeof fetchClusterCapacity === 'function') {
            console.log('Fetching cluster capacity after navigation to home.');
            fetchClusterCapacity();
        }
    }

    // Determine active tab for the home page (could be 'home' itself or a sub-resource tab)
    const activeTabId = window.app.state.navigation?.activeTab || 'home';
    console.log(`Home page: effective active tab from navigation state: ${activeTabId}`);

    // Activate the overall home tab or a specific resource tab if deep-linked
    // activateTab(activeTabId, false); // activateTab might need to be globally available or part of home_page.js
    // For now, assume bootstrap handles the visual activation based on URL or prior state.

    // Delay resource loading slightly to ensure DOM and other initializations are complete
    setTimeout(() => {
        if (typeof loadResourcesForTab === 'function') {
            loadResourcesForTab('home'); // 'home' will trigger loading for its active inner tab or default
        } else {
            console.warn('loadResourcesForTab function not found for home page initialization.');
            // Fallback to loading pods directly if the helper is missing
            if (typeof fetchResourceData === 'function') fetchResourceData('pods', 'all', false, 1, true);
        }
        if (typeof initializeGPUFilter === 'function') {
             initializeGPUFilter(); // Initialize GPU filter if on home page showing pods
        }
    }, 200);
}

// Initial fetch for all resource tabs shown on the home page (or lazy load setup)
function fetchResourcesForAllTabs() {
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    fetchClusterCapacity().then(() => {
        // Determine the currently active resource tab within the home page dashboard
        const activeResourceTabLink = document.querySelector('#resourceTabs .nav-link.active');
        let activeResourceTabId = 'pods'; // Default to pods
        if (activeResourceTabLink) {
            const target = activeResourceTabLink.getAttribute('data-bs-target');
            if (target) activeResourceTabId = target.replace('#', '');
        }

        console.log(`Home dashboard: Initializing with active resource tab: ${activeResourceTabId}`);
        if (typeof fetchResourceData === 'function') {
            fetchResourceData(activeResourceTabId, 'all', false, 1, true); // Load page 1, reset data
        }

        // Set up lazy loading or pre-emptive loading for other tabs
        resourceTypes.forEach(resourceType => {
            if (resourceType !== activeResourceTabId) {
                const tabElement = document.getElementById(`${resourceType}-tab`);
                if (tabElement) {
                    // Re-clone and re-add event listener to prevent multiple listeners if this function is called multiple times
                    const newTabElement = tabElement.cloneNode(true);
                    tabElement.parentNode.replaceChild(newTabElement, tabElement);
                    
                    newTabElement.addEventListener('click', () => {
                        const namespaceSelector = document.getElementById(`${resourceType}Namespace`);
                        const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
                        // Check if data needs loading (e.g., not loaded or stale)
                        const cacheKey = `${resourceType}-${currentNamespace}-full-1`; // Assuming page 1 for initial load
                        const isDataMissing = !window.app.state.resources[resourceType] || 
                                            !window.app.state.resources[resourceType].items || 
                                            window.app.state.resources[resourceType].items.length === 0;
                        const isCacheStale = !window.app.state.cache.lastFetch[cacheKey] || 
                                       (Date.now() - window.app.state.cache.lastFetch[cacheKey] > window.app.CACHE_TIMEOUT);

                        if (isDataMissing || isCacheStale) {
                            console.log(`Lazy loading ${resourceType} data on click (Namespace: ${currentNamespace})...`);
                            fetchResourceData(resourceType, currentNamespace, false, 1, true); // page 1, reset data
                        }
                    });
                }
            }
        });
    }).catch(error => {
        console.error("Failed to fetch cluster capacity before loading home tabs:", error);
        // Attempt to load default tab (pods) anyway
        if (typeof fetchResourceData === 'function') {
            fetchResourceData('pods', 'all', false, 1, true);
        }
    });
}

// Loads resources for the specified tab ID (could be 'home' or a specific resource)
function loadResourcesForTab(tabId) {
    console.log(`loadResourcesForTab called for: ${tabId}`);

    if (tabId === 'resources' && typeof loadResourcesPage === 'function') {
        // This was a hypothetical function from comments, ensure it exists if used
        // loadResourcesPage(); 
        console.log("loadResourcesPage() called - ensure this function is defined if needed.");
        return;
    }

    if (tabId === 'home') {
        let activeSubTabId = 'pods'; // Default for home page
        try {
            // Find the active nav-link within the resourceTabs container for the home page
            const activeSubTabLink = document.querySelector('#resourceTabs .nav-link.active');
            if (activeSubTabLink) {
                const target = activeSubTabLink.getAttribute('data-bs-target'); // e.g., "#pods"
                if (target) activeSubTabId = target.substring(1); // Remove #
            }
            console.log(`Home page active resource sub-tab: ${activeSubTabId}`);
        } catch (e) {
            console.warn('Could not determine active resource sub-tab for home, defaulting to pods.', e);
        }
        const namespaceSelector = document.getElementById(`${activeSubTabId}Namespace`);
        const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
        if (typeof fetchResourceData === 'function') {
             fetchResourceData(activeSubTabId, currentNamespace, false, 1, true); // page 1, reset
        }
        if (activeSubTabId === 'pods' && typeof initializeGPUFilter === 'function') {
            initializeGPUFilter();
        }
        return;
    }
    
    // For other direct top-level tabs like 'cli', 'yaml', etc.
    const directTabId = tabId.replace('-tab', ''); // Normalize ID
    if (['cli', 'yaml', 'namespaces', 'charts', 'settings'].includes(directTabId)) {
        console.log(`Non-resource tab selected: ${directTabId}. No data fetch needed by this function.`);
        // Specific initialization for these tabs should be handled by their own modules or event listeners
    } else if (directTabId && typeof fetchResourceData === 'function') {
        // This case might be for a resource tab that is *not* under the 'home' dashboard structure
        // but is a top-level tab itself. Adjust if this isn't the application structure.
        console.log(`Direct resource tab ${directTabId} selected, fetching data.`);
        fetchResourceData(directTabId, 'all', false, 1, true);
    } else if (!directTabId) {
        console.warn(`No valid tab ID derived from ${tabId}, defaulting to pods.`);
        if (typeof fetchResourceData === 'function') fetchResourceData('pods', 'all', false, 1, true);
    }
}