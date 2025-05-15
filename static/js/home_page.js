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
        return '-'; // Return a dash for N/A or error, consistent with HTML placeholders
    }
    if (decimals === 0) {
        return num.toFixed(0);
    }
    return num.toFixed(decimals);
}

// Helper to format bytes to GB
function formatBytesToGB(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes) || bytes === 0) {
        return '0';
    }
    return (bytes / (1024 * 1024 * 1024)).toFixed(1);
}

// Helper to format millicores to cores
function formatMillicoresToCores(millicores) {
    if (typeof millicores !== 'number' || isNaN(millicores) || millicores === 0) {
        return '0';
    }
    return (millicores / 1000).toFixed(1);
}

// Fetches and displays the new dashboard metrics from the API
async function fetchAndDisplayDashboardMetrics() {
    console.log('Fetching dashboard environment metrics...');
    const loadingText = '...'; // Briefer loading text
    const errorText = 'Error';
    const naText = '-';

    // Set initial loading texts using HTML IDs
    updateTextContent('podCardRunningCount', loadingText);
    updateTextContent('podCardTotalCapacity', loadingText);
    updateTextContent('podCardPercentage', loadingText);
    updateProgress('podUsageBar', 0); // Assuming 'podUsageBar' is the correct ID for the pod progress bar if it exists or will be added
                                     // If no progress bar for pods, this line can be removed. index.html snippet didn't show one.

    updateTextContent('vcpuCardUtilized', loadingText);
    updateTextContent('vcpuCardTotalAllocatable', loadingText);
    updateTextContent('vcpuCardPercentageUtilized', loadingText);
    updateTextContent('vcpuCardOverprovisionLimit', loadingText); // This will show total capacity
    updateProgress('vcpuProgressBar', 0);

    updateTextContent('ramCardUtilized', loadingText);
    updateTextContent('ramCardTotalAllocatable', loadingText);
    updateTextContent('ramCardPercentageUtilized', loadingText);
    updateTextContent('ramCardOverprovisionLimit', loadingText); // This will show total capacity
    updateProgress('ramProgressBar', 0);

    updateTextContent('gpuCardUtilizedUnits', loadingText);
    updateTextContent('gpuCardTotalAllocatableUnits', loadingText);
    updateTextContent('gpuCardPercentageUtilized', loadingText);
    updateProgress('gpuProgressBar', 0);
    
    const lastUpdatedIds = ['metricsLastUpdatedPods', 'metricsLastUpdatedVCPU', 'metricsLastUpdatedRAM', 'metricsLastUpdatedGPU'];
    lastUpdatedIds.forEach(id => updateTextContent(id, loadingText));

    try {
        const response = await fetch('/api/environment_metrics');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const metrics = await response.json();
        console.log('Dashboard metrics received:', metrics);

        const timestamp = metrics.last_updated_timestamp ? new Date(metrics.last_updated_timestamp).toLocaleTimeString() : naText;
        lastUpdatedIds.forEach(id => updateTextContent(id, timestamp));

        // Pods
        if (metrics.pods) {
            const running = metrics.pods.current_running || 0;
            const totalCapacity = metrics.pods.total_capacity || 0;
            updateTextContent('podCardRunningCount', formatNumber(running, 0));
            updateTextContent('podCardTotalCapacity', formatNumber(totalCapacity, 0));
            // const podPercentage = totalCapacity > 0 ? (running / totalCapacity) * 100 : 0; // API provides this
            const podPercentage = metrics.pods.percentage_running || 0;
            updateTextContent('podCardPercentage', formatNumber(podPercentage, 0));
            // updateProgress('podUsageBar', podPercentage); // If there's a progress bar for pods
        } else {
            updateTextContent('podCardRunningCount', naText);
            updateTextContent('podCardTotalCapacity', naText);
            updateTextContent('podCardPercentage', naText);
            // updateProgress('podUsageBar', 0);
        }

        // vCPU
        if (metrics.vcpu) {
            const utilized = metrics.vcpu.current_request_millicores || 0;
            const allocatable = metrics.vcpu.total_allocatable_millicores || 0;
            const capacity = metrics.vcpu.total_capacity_millicores || 0;

            updateTextContent('vcpuCardUtilized', formatMillicoresToCores(utilized));
            updateTextContent('vcpuCardTotalAllocatable', formatMillicoresToCores(allocatable));
            // const cpuPercentageVsAllocatable = allocatable > 0 ? (utilized / allocatable) * 100 : 0; // API provides this
            const cpuPercentageVsAllocatable = metrics.vcpu.percentage_utilized_vs_allocatable || 0;
            updateTextContent('vcpuCardPercentageUtilized', formatNumber(cpuPercentageVsAllocatable, 0));
            updateProgress('vcpuProgressBar', cpuPercentageVsAllocatable);
            updateTextContent('vcpuCardOverprovisionLimit', formatMillicoresToCores(capacity));
        } else {
            updateTextContent('vcpuCardUtilized', naText);
            updateTextContent('vcpuCardTotalAllocatable', naText);
            updateTextContent('vcpuCardPercentageUtilized', naText);
            updateTextContent('vcpuCardOverprovisionLimit', naText);
            updateProgress('vcpuProgressBar', 0);
        }

        // RAM
        if (metrics.memory) {
            const utilized = metrics.memory.current_request_bytes || 0;
            const allocatable = metrics.memory.total_allocatable_bytes || 0;
            const capacity = metrics.memory.total_capacity_bytes || 0;

            updateTextContent('ramCardUtilized', formatBytesToGB(utilized));
            updateTextContent('ramCardTotalAllocatable', formatBytesToGB(allocatable));
            // const ramPercentageVsAllocatable = allocatable > 0 ? (utilized / allocatable) * 100 : 0; // API provides this
            const ramPercentageVsAllocatable = metrics.memory.percentage_utilized_vs_allocatable || 0;
            updateTextContent('ramCardPercentageUtilized', formatNumber(ramPercentageVsAllocatable, 0));
            updateProgress('ramProgressBar', ramPercentageVsAllocatable);
            updateTextContent('ramCardOverprovisionLimit', formatBytesToGB(capacity));
        } else {
            updateTextContent('ramCardUtilized', naText);
            updateTextContent('ramCardTotalAllocatable', naText);
            updateTextContent('ramCardPercentageUtilized', naText);
            updateTextContent('ramCardOverprovisionLimit', naText);
            updateProgress('ramProgressBar', 0);
        }

        // GPU
        if (metrics.gpu) {
            const utilized = metrics.gpu.current_request_units || 0;
            const allocatable = metrics.gpu.total_allocatable_units || 0;

            updateTextContent('gpuCardUtilizedUnits', formatNumber(utilized, 0));
            updateTextContent('gpuCardTotalAllocatableUnits', formatNumber(allocatable, 0));
            // const gpuPercentage = allocatable > 0 ? (utilized / allocatable) * 100 : 0; // API provides this
            const gpuPercentage = metrics.gpu.percentage_utilized || 0;
            updateTextContent('gpuCardPercentageUtilized', formatNumber(gpuPercentage, 0));
            updateProgress('gpuProgressBar', gpuPercentage);
        } else {
            updateTextContent('gpuCardUtilizedUnits', naText);
            updateTextContent('gpuCardTotalAllocatableUnits', naText);
            updateTextContent('gpuCardPercentageUtilized', naText);
            updateProgress('gpuProgressBar', 0);
        }

    } catch (error) {
        console.error('Failed to fetch or display dashboard metrics:', error);
        updateTextContent('podCardRunningCount', errorText);
        updateTextContent('podCardTotalCapacity', '');
        updateTextContent('podCardPercentage', errorText);
        
        updateTextContent('vcpuCardUtilized', errorText);
        updateTextContent('vcpuCardTotalAllocatable', '');
        updateTextContent('vcpuCardPercentageUtilized', errorText);
        updateTextContent('vcpuCardOverprovisionLimit', errorText);
        
        updateTextContent('ramCardUtilized', errorText);
        updateTextContent('ramCardTotalAllocatable', '');
        updateTextContent('ramCardPercentageUtilized', errorText);
        updateTextContent('ramCardOverprovisionLimit', errorText);

        updateTextContent('gpuCardUtilizedUnits', errorText);
        updateTextContent('gpuCardTotalAllocatableUnits', '');
        updateTextContent('gpuCardPercentageUtilized', errorText);
        
        lastUpdatedIds.forEach(id => updateTextContent(id, errorText));

        // Reset progress bars on error too
        // updateProgress('podUsageBar', 0); // If exists
        updateProgress('vcpuProgressBar', 0);
        updateProgress('ramProgressBar', 0);
        updateProgress('gpuProgressBar', 0);
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