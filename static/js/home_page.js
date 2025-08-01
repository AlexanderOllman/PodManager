// home_page.js

// Fetches the initial data required for the home page dashboard
async function initializeHomePage() {
    console.log('Initializing home page...');

    // Fetch the detailed cluster metrics for the new dashboard cards
    try {
        const response = await fetch('/api/environment_metrics');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const metricsData = await response.json();

        // The new updateDashboardMetrics function expects the data to be nested
        // under a 'cluster_metrics' key, but the structure might just be the metrics object.
        // We'll pass it in a format it can handle.
        if (typeof updateDashboardMetrics === 'function') {
            updateDashboardMetrics({ cluster_metrics: metricsData });
        } else {
            console.warn('updateDashboardMetrics function not found.');
        }

    } catch (error) {
        console.error('Failed to fetch initial dashboard metrics:', error);
        // Here you could update the UI to show an error state for the cards
    }

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
    
    const effectiveTabId = window.app.state.navigation?.activeResourceTab || 'pods';
    console.log('Home page: effective active tab from navigation state:', effectiveTabId);

    // This is now the primary function to fetch data for the home page tables
    fetchResourcesForAllTabs();
    
    // Initialize GPU dashboard components
    if (typeof initializeGpuDashboard === 'function') {
        console.log('Initializing GPU dashboard...');
        initializeGpuDashboard();
    } else {
        console.warn('initializeGpuDashboard function not found.');
    }
}

// Home dashboard: This should only be called once on initial load.
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('home')) {
        console.log('Home dashboard: Initializing with active resource tab:', window.app.state.navigation.activeResourceTab);
        
        const tabs = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
        tabs.forEach(tabId => {
            const tabElement = document.getElementById(`${tabId}-tab`);
            if (tabElement) {
                tabElement.addEventListener('shown.bs.tab', function(event) {
                    const activatedTabId = event.target.getAttribute('aria-controls');
                    console.log(`Home page resource tab activated: ${activatedTabId}`);
                    window.app.state.navigation.activeResourceTab = activatedTabId;
                    loadResourcesForTab(activatedTabId);
                });
            }
        });

        // Load resources for the initially active tab if it's 'home'
        if (window.app.state.navigation.activeTab === 'home') {
             loadResourcesForTab(window.app.state.navigation.activeResourceTab || 'pods');
        }
    }
});

// Fetches resources for all tabs on the home page dashboard
function fetchResourcesForAllTabs() {
    // This could be changed to fetch only the active tab initially and others on demand
    const resourceTypes = ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'];
    
    resourceTypes.forEach(type => {
        // We only fetch page 1 by default. The rest is handled by 'load more' or pagination.
        fetchResourceData(type, 'all', false, 1, true); // fetchAll=false
    });
}

// Main logic to load or reload resources for a specific tab on the home page
function loadResourcesForTab(tabId) {
    if (!tabId) return;
    console.log(`loadResourcesForTab called for: ${tabId}`);

    const state = window.app.state.resources[tabId];
    const needsFetch = !state || !state.items || state.items.length === 0;

    if (needsFetch) {
        const namespaceSelector = document.getElementById(`${tabId}Namespace`);
        const namespace = namespaceSelector ? namespaceSelector.value : 'all';
        fetchResourceData(tabId, namespace, false, 1, true); // Always reset and fetch page 1
    } else {
        // Data already exists, just render it
        if (typeof renderCurrentPage === 'function') renderCurrentPage(tabId);
    }
}

// Handles namespace changes for any of the resource tabs on the home page
function handleNamespaceChange(resourceType, selectElement) {
    const newNamespace = selectElement.value;
    fetchResourceData(resourceType, newNamespace, false, 1, true); // Reset and fetch page 1 for the new namespace
}

// Refreshes the data for a specific resource tab on the dashboard
function refreshDashboardTab(resourceType) {
    const namespaceSelector = document.getElementById(`${resourceType}Namespace`);
    const namespace = namespaceSelector ? namespaceSelector.value : 'all';
    fetchResourceData(resourceType, namespace, false, 1, true);
} 