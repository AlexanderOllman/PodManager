// home_page.js

// Initialize or reinitialize the home page (called on initial load and navigation to home)
function initializeHomePage() {
    console.log('Initializing home page...');

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

    // Determine active tab for the home page
    const activeTabId = window.app.state.navigation?.activeTab || 'home';
    console.log(`Home page: effective active tab from navigation state: ${activeTabId}`);

    // Delay resource loading slightly to ensure DOM and other initializations are complete
    setTimeout(() => {
        if (typeof loadResourcesForTab === 'function') {
            loadResourcesForTab('home');
        } else {
            console.warn('loadResourcesForTab function not found for home page initialization.');
            if (typeof fetchResourceData === 'function') fetchResourceData('pods', 'all', false, 1, true);
        }
        if (typeof initializeGPUFilter === 'function') {
            initializeGPUFilter();
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
                    const newTabElement = tabElement.cloneNode(true); // To remove old listeners
                    tabElement.parentNode.replaceChild(newTabElement, tabElement);
                    newTabElement.addEventListener('click', () => {
                        // Check if data needs loading (e.g., not loaded or stale)
                        const namespaceSelector = document.getElementById(`${resourceType}Namespace`);
                        const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
                        const cacheKey = `${resourceType}-${currentNamespace}-full-1`;
                        const isStale = !window.app.state.cache.lastFetch[cacheKey] || 
                                        (Date.now() - window.app.state.cache.lastFetch[cacheKey] > window.app.CACHE_TIMEOUT);

                        if (!window.app.state.resources[resourceType] || !window.app.state.resources[resourceType].items || window.app.state.resources[resourceType].items.length === 0 || isStale) {
                            console.log(`Lazy loading ${resourceType} data on click...`);
                            fetchResourceData(resourceType, currentNamespace, false, 1, true);
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
        loadResourcesPage();
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

// Updates dashboard metric cards (total pods, running, errors, CPU, GPU, RAM)
function updateDashboardMetrics(podsData) {
    if (!podsData || !Array.isArray(podsData)) {
        console.warn('updateDashboardMetrics called with invalid or empty podsData');
        resetMetricsToZero();
        return;
    }
    console.log('Updating dashboard metrics with data from', podsData.length, 'pods');

    // Pod Status Metrics
    const metrics = calculatePodMetrics(podsData);
    updatePodStatusCard(metrics);

    // CPU Usage Metrics
    const cpuMetrics = calculateCPUMetrics(podsData);
    updateCPUCard(cpuMetrics);

    // RAM Usage Metrics
    const ramMetrics = calculateRAMMetrics(podsData);
    updateRAMCard(ramMetrics);

    // GPU Usage Metrics
    const gpuMetrics = calculateGPUMetrics(podsData);
    updateGPUCard(gpuMetrics);
}

function resetMetricsToZero() {
    // Pod Status Card
    document.getElementById('totalPodsAllowed').textContent = '0';
    document.getElementById('totalPodsActive').textContent = '0';
    document.getElementById('podUtilizationPercentage').textContent = '0%';
    
    // CPU Card
    document.getElementById('totalCPUCores').textContent = '0';
    document.getElementById('allocatedCPUCores').textContent = '0';
    document.getElementById('cpuUtilizationPercentage').textContent = '0%';
    
    // RAM Card
    document.getElementById('totalRAM').textContent = '0';
    document.getElementById('allocatedRAM').textContent = '0';
    document.getElementById('ramUtilizationPercentage').textContent = '0%';
    
    // GPU Card
    document.getElementById('totalGPUs').textContent = '0';
    document.getElementById('allocatedGPUs').textContent = '0';
    document.getElementById('gpuUtilizationPercentage').textContent = '0%';
}

function calculatePodMetrics(podsData) {
    const totalPods = podsData.length;
    const maxAllowedPods = window.clusterCapacity?.maxPods || 0;
    const podUtilization = maxAllowedPods > 0 ? (totalPods / maxAllowedPods) * 100 : 0;
    
    return {
        totalAllowed: maxAllowedPods,
        totalActive: totalPods,
        utilizationPercentage: Math.round(podUtilization)
    };
}

function calculateCPUMetrics(podsData) {
    let totalCPURequest = 0;
    podsData.forEach(pod => {
        if (pod.status.phase === 'Running') {
            const containers = pod.spec.containers || [];
            containers.forEach(container => {
                const resources = container.resources || {};
                const requests = resources.requests || {};
                if (requests.cpu) {
                    totalCPURequest += parseCPUValue(requests.cpu);
                }
            });
        }
    });
    
    const totalCPUCores = window.clusterCapacity?.cpu || 0;
    const cpuUtilization = totalCPUCores > 0 ? (totalCPURequest / totalCPUCores) * 100 : 0;
    
    return {
        totalCores: totalCPUCores,
        allocatedCores: Math.round(totalCPURequest * 10) / 10,
        utilizationPercentage: Math.round(cpuUtilization)
    };
}

function calculateRAMMetrics(podsData) {
    let totalRAMRequest = 0;
    podsData.forEach(pod => {
        if (pod.status.phase === 'Running') {
            const containers = pod.spec.containers || [];
            containers.forEach(container => {
                const resources = container.resources || {};
                const requests = resources.requests || {};
                if (requests.memory) {
                    totalRAMRequest += parseMemoryValue(requests.memory);
                }
            });
        }
    });
    
    const totalRAMGB = window.clusterCapacity?.memory || 0;
    const ramUtilization = totalRAMGB > 0 ? (totalRAMRequest / totalRAMGB) * 100 : 0;
    
    return {
        totalRAM: totalRAMGB,
        allocatedRAM: Math.round(totalRAMRequest * 10) / 10,
        utilizationPercentage: Math.round(ramUtilization)
    };
}

function calculateGPUMetrics(podsData) {
    let totalGPURequest = 0;
    podsData.forEach(pod => {
        if (pod.status.phase === 'Running') {
            const containers = pod.spec.containers || [];
            containers.forEach(container => {
                const resources = container.resources || {};
                const requests = resources.requests || {};
                if (requests['nvidia.com/gpu']) {
                    totalGPURequest += parseInt(requests['nvidia.com/gpu']);
                }
            });
        }
    });
    
    const totalGPUs = window.clusterCapacity?.gpu || 0;
    const gpuUtilization = totalGPUs > 0 ? (totalGPURequest / totalGPUs) * 100 : 0;
    
    return {
        totalGPUs: totalGPUs,
        allocatedGPUs: totalGPURequest,
        utilizationPercentage: Math.round(gpuUtilization)
    };
}

function updatePodStatusCard(metrics) {
    document.getElementById('totalPodsAllowed').textContent = metrics.totalAllowed;
    document.getElementById('totalPodsActive').textContent = metrics.totalActive;
    document.getElementById('podUtilizationPercentage').textContent = `${metrics.utilizationPercentage}%`;
    updateProgressBar('podProgressBar', metrics.utilizationPercentage);
}

function updateCPUCard(metrics) {
    document.getElementById('totalCPUCores').textContent = metrics.totalCores;
    document.getElementById('allocatedCPUCores').textContent = metrics.allocatedCores;
    document.getElementById('cpuUtilizationPercentage').textContent = `${metrics.utilizationPercentage}%`;
    updateProgressBar('cpuProgressBar', metrics.utilizationPercentage);
}

function updateRAMCard(metrics) {
    document.getElementById('totalRAM').textContent = metrics.totalRAM;
    document.getElementById('allocatedRAM').textContent = metrics.allocatedRAM;
    document.getElementById('ramUtilizationPercentage').textContent = `${metrics.utilizationPercentage}%`;
    updateProgressBar('ramProgressBar', metrics.utilizationPercentage);
}

function updateGPUCard(metrics) {
    document.getElementById('totalGPUs').textContent = metrics.totalGPUs;
    document.getElementById('allocatedGPUs').textContent = metrics.allocatedGPUs;
    document.getElementById('gpuUtilizationPercentage').textContent = `${metrics.utilizationPercentage}%`;
    updateProgressBar('gpuProgressBar', metrics.utilizationPercentage);
}

function updateProgressBar(elementId, percentage) {
    const progressBar = document.getElementById(elementId);
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage);
        
        // Update color based on utilization
        if (percentage >= 90) {
            progressBar.className = 'progress-bar bg-danger';
        } else if (percentage >= 75) {
            progressBar.className = 'progress-bar bg-warning';
        } else {
            progressBar.className = 'progress-bar bg-success';
        }
    }
}

function parseCPUValue(cpuStr) {
    if (typeof cpuStr !== 'string') return 0;
    if (cpuStr.endsWith('m')) {
        return parseInt(cpuStr.slice(0, -1)) / 1000;
    }
    return parseInt(cpuStr);
}

function parseMemoryValue(memStr) {
    if (typeof memStr !== 'string') return 0;
    const units = {
        'Ki': 1 / (1024 * 1024),
        'Mi': 1 / 1024,
        'Gi': 1,
        'Ti': 1024
    };
    
    for (const [unit, multiplier] of Object.entries(units)) {
        if (memStr.endsWith(unit)) {
            return parseInt(memStr.slice(0, -2)) * multiplier;
        }
    }
    return parseInt(memStr);
}

// Initialize the page when DOM is ready
document.addEventListener('DOMContentLoaded', initializeHomePage); 
