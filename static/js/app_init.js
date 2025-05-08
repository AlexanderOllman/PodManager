// Global application namespace and core state
window.app = window.app || {};

window.app.state = window.app.state || {
    resources: {},          // Holds data for various resource types
    lastFetch: {},          // Timestamps of last data fetch for caching
    errors: {},             // Stores any operational errors
    activeRequests: new Map(), // Tracks active API requests
    filters: {              // Global filter states
        gpu: false,
        namespace: 'all'
    },
    navigation: {           // Navigation state
        isNavigating: false,
        activeTab: 'home'   // Default active tab, updated by initNavigation
    },
    // Cache for resource data to avoid redundant fetches
    cache: {
        resources: {},
        lastFetch: {},
        STALE_THRESHOLD: 2 * 60 * 1000, // 2 minutes for stale data warning
        clear: function() {
            this.resources = {};
            this.lastFetch = {};
        }
    }
};

window.app.CACHE_TIMEOUT = window.app.CACHE_TIMEOUT || 5 * 60 * 1000; // 5 minutes for general cache expiry
window.app.currentResourceType = 'pods'; // Current resource type for Resources page

// Helper to construct URLs relative to the application's base path
window.app.getRelativeUrl = function(path) {
    // If path starts with '/', it's considered absolute from the app's root.
    // The `fetch` API handles these correctly when given to it directly, 
    // so no need to prepend window.location.origin here.
    // Just ensure it is a valid path.
    if (path.startsWith('/')) {
        return path; 
    }

    // If path does not start with '/', resolve it relative to the current page's path.
    // This is useful for links like './sub-resource' or 'image.png' from a specific page.
    // However, for API calls, it's generally better to use absolute paths from root (e.g., '/api/data').
    let currentPath = window.location.pathname;
    // If currentPath doesn't end with a '/', get its directory part.
    if (!currentPath.endsWith('/')) {
        currentPath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
    }
    // Ensure the current path starts with a slash if it's not empty.
    if (currentPath && !currentPath.startsWith('/')) {
        currentPath = '/' + currentPath;
    }
    if (currentPath === '/') {
         return '/' + path; // Avoid double slashes if currentPath is root
    }
    return currentPath + path; // e.g. /current/dir/ + relativePath
};

// Main initialization function that runs when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM content loaded, initializing application...');
    
    initNavigation(); // Initialize navigation state first
    initializeApp();  // Then initialize the main application logic
    
    // Add page visibility change detection
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            console.log('Page is now visible, checking resource loading state...');
            try {
                const activeTabId = document.querySelector('.tab-pane.active')?.id;
                if (activeTabId && ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(activeTabId)) {
                    // Check if loadedResources exists and then check the specific tab
                    if (!window.app.state.cache.resources[activeTabId] || !window.app.state.cache.lastFetch[activeTabId]) {
                         console.log(`Active tab ${activeTabId} not loaded or cache missing, fetching data...`);
                        fetchResourceData(activeTabId);
                    }
                }
            } catch (e) {
                console.error('Error checking visible tab state:', e);
            }
        }
    });

    // Set up Resources tab handler
    const resourcesTab = document.querySelector('a[data-bs-target="#resources"]');
    if (resourcesTab) {
        resourcesTab.addEventListener('click', function() {
            if (typeof loadResourcesPage === 'function') {
                loadResourcesPage();
            } else {
                console.warn('loadResourcesPage function not found.');
            }
        });
    }
    
    // Start data freshness checker
    if (typeof startDataFreshnessChecker === 'function') {
        startDataFreshnessChecker();
    }

    // Initialize namespace functionality (jQuery dependent)
    if (typeof initializeNamespaceFunctionality === 'function') {
        setTimeout(initializeNamespaceFunctionality, 500); // Ensure jQuery is loaded
    }
});

// Handle browser navigation (back/forward) events
window.onpopstate = function(event) {
    console.log('Navigation state change detected', event.state);
    
    if (window.location.pathname === '/' || window.location.pathname === '') {
        if (event.state && event.state.tabId) {
            console.log(`History state has tab: ${event.state.tabId}`);
            if (event.state.tabId === 'home' && event.state.activeResourceTab) {
                console.log(`History navigation to home with active resource tab: ${event.state.activeResourceTab}`);
                if (!window.app.state) window.app.state = {};
                window.app.state.activeResourceTab = event.state.activeResourceTab;
                
                const homeTab = document.getElementById('home');
                if (homeTab) homeTab.classList.add('show', 'active');
                
                ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].forEach(tab => {
                    const tabElement = document.getElementById(tab);
                    const tabButton = document.getElementById(`${tab}-tab`);
                    if (tabElement) tabElement.classList.remove('show', 'active');
                    if (tabButton) tabButton.classList.remove('active');
                });
                
                const resourceTab = document.getElementById(event.state.activeResourceTab);
                const resourceTabButton = document.getElementById(`${event.state.activeResourceTab}-tab`);
                if (resourceTab) resourceTab.classList.add('show', 'active');
                if (resourceTabButton) resourceTabButton.classList.add('active');
                
                if (window.app.state.cache.resources) {
                    window.app.state.cache.resources[event.state.activeResourceTab] = false; // Mark for reload
                }
                fetchResourceData(event.state.activeResourceTab);
                return;
            }
            
            if (['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(event.state.tabId)) {
                console.log(`History navigation to resource tab: ${event.state.tabId}`);
                if (window.app.state.cache.resources) {
                     window.app.state.cache.resources[event.state.tabId] = false; // Mark for reload
                }
                fetchResourceData(event.state.tabId);
            }
        } else {
            const activeTabId = document.querySelector('.tab-pane.active')?.id;
            if (activeTabId && ['pods', 'services', 'inferenceservices', 'deployments', 'configmaps', 'secrets'].includes(activeTabId)) {
                console.log(`Navigation returned to home page, loading ${activeTabId} data`);
                if (window.app.state.cache.resources) {
                     window.app.state.cache.resources[activeTabId] = false; // Mark for reload
                }
                fetchResourceData(activeTabId);
            }
        }
    }
    
    if (event.state && event.state.content) {
        document.getElementById('main-content').innerHTML = event.state.content;
        if (event.state.page === 'home' && typeof initializeHomePage === 'function') {
            initializeHomePage();
        } else if (event.state.page === 'explore' && typeof initializeExplorePage === 'function') {
            initializeExplorePage(); // Assuming initializeExplorePage exists or will be handled
        }
    }
};

// Main application initialization
function initializeApp() {
    console.log('Initializing application components...');
    
    initializeBootstrapComponents();
    
    if (typeof fetchResourcesForAllTabs === 'function') fetchResourcesForAllTabs();
    if (typeof fetchClusterCapacity === 'function') fetchClusterCapacity();
    if (typeof checkGitAvailability === 'function') checkGitAvailability();
    if (typeof fetchNamespaces === 'function') fetchNamespaces(); // For events tab
    if (typeof setupDropZone === 'function') setupDropZone();
    if (typeof initializeTerminal === 'function') initializeTerminal();
    if (typeof connectSocketListeners === 'function') connectSocketListeners();
    if (typeof setupTabClickHandlers === 'function') setupTabClickHandlers();
    
    // Initialize dashboard cards if they exist and functions are available
    if (document.getElementById('gpuPodsTableContainer') && typeof fetchGpuPods === 'function') {
        fetchGpuPods();
    }
    if (document.getElementById('namespaceMetricsTableContainer') && typeof fetchNamespaceMetrics === 'function') {
        fetchNamespaceMetrics(); // Default to GPU
    }
    
    console.log('Application components initialized.');
}

// Initialize Bootstrap components
function initializeBootstrapComponents() {
    console.log('Initializing Bootstrap components...');
    var dropdownElementList = [].slice.call(document.querySelectorAll('[data-bs-toggle="dropdown"]'));
    dropdownElementList.map(function(dropdownToggleEl) {
        return new bootstrap.Dropdown(dropdownToggleEl);
    });
    
    document.addEventListener('namespacesLoaded', function() {
        setTimeout(function() {
            var dropdownElementList = [].slice.call(document.querySelectorAll('[data-bs-toggle="dropdown"]'));
            dropdownElementList.map(function(dropdownToggleEl) {
                return new bootstrap.Dropdown(dropdownToggleEl);
            });
        }, 100);
    });
}

// Socket event listeners
function connectSocketListeners() {
    if (!window.app.socket) {
        try {
            window.app.socket = io(); // Initialize socket if not already
            console.log('Socket connection initialized in connectSocketListeners.');
        } catch (e) {
            console.warn('Socket.io client (io) not available. Socket-dependent features might not work.', e);
            return;
        }
    }
    const socket = window.app.socket;
    if (!socket) {
        console.warn('Socket not available for event listeners');
        return;
    }

    // Ensure terminal output is handled if terminal exists
    socket.on('terminal_output', function(data) {
        if (window.app.terminal && data.data) {
            window.app.terminal.write(data.data);
            if (data.complete) {
                window.app.terminal.write('\r\n$ ');
            }
        }
    });
    
    const refreshLog = document.getElementById('refreshLog');
    if (refreshLog) {
        socket.on('refresh_log', function(data) {
            const logMessageContent = data.message;
            const logEntry = document.createElement('div');
            const timestamp = new Date().toLocaleTimeString();
            
            if (data.status === 'error') logEntry.className = 'text-danger';
            else if (data.status === 'warning') logEntry.className = 'text-warning';
            else if (data.status === 'success') logEntry.className = 'text-success';
            else logEntry.className = 'text-info';
            
            logEntry.innerHTML = `[${timestamp}] ${logMessageContent}`;
            refreshLog.appendChild(logEntry);
            refreshLog.scrollTop = refreshLog.scrollHeight;
            
            if (logMessageContent.includes('Preparing to restart application')) {
                setTimeout(() => {
                    fetch('/restart', { method: 'POST' })
                    .then(response => response.json())
                    .then(data => {
                        const statusDiv = document.getElementById('updateStatus');
                        if (data.status === 'success') {
                            const successLogEntry = document.createElement('div');
                            successLogEntry.className = 'text-success';
                            successLogEntry.innerHTML = `[${new Date().toLocaleTimeString()}] Application restarted successfully. Page will refresh shortly...`;
                            refreshLog.appendChild(successLogEntry);
                            if(statusDiv) statusDiv.innerHTML = 'Application restarted successfully. Refreshing page...';
                            setTimeout(() => window.location.reload(), 3000);
                        }
                    });
                }, 1000);
            }
        });
    }
}

// Navigation function (moved from base.html)
// This function handles navigation between main sections, potentially reloading content.
function navigateToTab(tabId) {
    console.log(`Navigating to tab: ${tabId} (global navigator)`);
    const mainContent = document.getElementById('main-content');
    if (!mainContent) {
        console.error("Main content area not found for navigation.");
        return;
    }

    // Update navigation state
    window.app.state.navigation.activeTab = tabId;
    history.pushState({ tabId: tabId }, null, `#${tabId}`); // Update URL hash

    // Deactivate all tabs and tab content
    document.querySelectorAll('.sidebar .nav-link').forEach(link => link.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('show', 'active'));

    // Activate the new tab link and content pane
    const newTabLink = document.querySelector(`.sidebar .nav-link[data-bs-target="#${tabId}"]`);
    const newTabPane = document.getElementById(tabId);

    if (newTabLink) newTabLink.classList.add('active');
    if (newTabPane) {
        newTabPane.classList.add('show', 'active');
        console.log(`Activated tab pane: ${tabId}`);
    } else {
        console.warn(`Tab pane with ID ${tabId} not found.`);
        // If the tab pane is not directly in the DOM (e.g. for 'explore' page which is separate)
        // this function might need to trigger a full page load or load content dynamically.
        // For now, it assumes tab panes are part of the main index.html structure.
        if (tabId === 'explore') { // Special handling for explore page
             window.location.href = window.app.getRelativeUrl('explore.html'); // Or just /explore if routing handles it
             return;
        }
    }
    
    // Call the appropriate loader for the tab
    // This simplifies the logic from the original base.html's navigateToTab
    if (typeof loadResourcesForTab === 'function') {
        loadResourcesForTab(tabId); // Centralized loading logic
    } else {
        console.warn('loadResourcesForTab function is not defined. Tab content might not load.');
    }

    // Scroll to top of main content
    mainContent.scrollTop = 0;
}

// Function to initialize navigation state
function initNavigation() {
    if (!window.app.state.navigation) {
         window.app.state.navigation = {};
    }
    window.app.state.navigation.activeTab = getActiveTabFromURL();
    console.log('Navigation initialized, active tab:', window.app.state.navigation.activeTab);

    // Set up event listener for tab changes to update activeTab state
    document.querySelectorAll('a[data-bs-toggle="tab"]').forEach(tab => {
        tab.addEventListener('shown.bs.tab', function (e) {
            const tabId = e.target.getAttribute('data-bs-target').substring(1);
            window.app.state.navigation.activeTab = tabId;
            console.log('Tab changed to:', tabId);
            
            if (tabId === 'resources' && typeof initializeResourcesPage === 'function') {
                initializeResourcesPage();
            }
            // Potentially call other initializers if needed for other tabs
        });
    });
}

// Helper function to get the active tab from URL hash or path
function getActiveTabFromURL() {
    const hash = window.location.hash;
    if (hash) {
        const tabId = hash.substring(1); // Remove the # character
        // Validate against known tab IDs if necessary
        const knownTabs = ['home', 'resources', 'cli', 'yaml', 'namespaces', 'charts', 'settings', 'events', 
                           'pods', 'services', 'deployments', 'inferenceservices', 'configmaps', 'secrets']; // Add all valid tab IDs
        if (knownTabs.includes(tabId)) {
            return tabId;
        }
    }
    const pathParts = window.location.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    const validTabs = ['resources', 'cli', 'yaml', 'namespaces', 'charts', 'settings', 'home'];
    if (validTabs.includes(lastPart)) {
        return lastPart;
    }
    return 'home'; // Default tab
}

// Add a function to check data freshness periodically
function startDataFreshnessChecker() {
    setInterval(() => {
        // Determine active tab, considering primary tabs and sub-tabs on home page
        let resourceTypeToCheck = null;
        const activePrimaryTabId = window.app.state.navigation.activeTab;

        if (activePrimaryTabId === 'home') {
            const activeSubTabLink = document.querySelector('#resourceTabs .nav-link.active');
            if (activeSubTabLink) {
                resourceTypeToCheck = activeSubTabLink.getAttribute('data-bs-target')?.replace('#', '');
            }
        } else if (['resources'].includes(activePrimaryTabId)) {
            // For pages like 'resources' explorer
            resourceTypeToCheck = window.app.currentResourceType;
        } else if (['pods', 'services', 'deployments', 'inferenceservices', 'configmaps', 'secrets'].includes(activePrimaryTabId)) {
            // If a resource tab itself is marked as the main activeTab (less likely with sidebar)
            resourceTypeToCheck = activePrimaryTabId;
        }


        if (resourceTypeToCheck) {
            const namespaceSelectorId = activePrimaryTabId === 'resources' ? 'resourceNamespaceSelector' : `${resourceTypeToCheck}Namespace`;
            const currentNamespace = document.getElementById(namespaceSelectorId)?.value || 'all';
            const cacheKey = `${resourceTypeToCheck}-${currentNamespace}-full-1`; // Check page 1 cache key
            
            const lastFetchTime = window.app.state.cache.lastFetch[cacheKey];
            
            if (lastFetchTime) {
                const timeSinceLastFetch = Date.now() - lastFetchTime;
                if (timeSinceLastFetch >= window.app.state.cache.STALE_THRESHOLD) {
                    if (typeof addRefreshAlert === 'function') {
                        const alertElement = addRefreshAlert(resourceTypeToCheck, activePrimaryTabId === 'resources' ? 'resourcesTableContainer' : `${resourceTypeToCheck}TableContainer`);
                        if (alertElement) {
                            alertElement.style.display = 'flex';
                        }
                    }
                }
            }
        }
    }, 30000); // Check every 30 seconds
}

// Helper function to activate a tab and its content programmatically
function activateTab(tabId, triggerLoad = true) {
    console.log(`Activating tab: ${tabId}, triggerLoad: ${triggerLoad}`);
    
    // Deactivate all sidebar links and tab panes
    document.querySelectorAll('.sidebar .nav-link.active').forEach(link => link.classList.remove('active'));
    document.querySelectorAll('.tab-pane.active.show').forEach(pane => pane.classList.remove('active', 'show'));

    // Activate the target sidebar link
    const tabLink = document.querySelector(`.sidebar .nav-link[data-bs-target="#${tabId}"]`);
    if (tabLink) {
        tabLink.classList.add('active');
    } else {
        console.warn(`Sidebar link for tab ${tabId} not found.`);
    }

    // Activate the target tab pane
    const tabPane = document.getElementById(tabId);
    if (tabPane) {
        tabPane.classList.add('active', 'show');
    } else {
        console.warn(`Tab pane for ${tabId} not found.`);
        // If it's a top-level page like 'explore', it might not have a local tab pane.
        // navigateToTab handles specific page loads like for 'explore.html'
    }
    
    window.app.state.navigation.activeTab = tabId;
    history.pushState({ tabId: tabId }, null, `#${tabId}`);

    if (triggerLoad) {
        if (typeof loadResourcesForTab === 'function') {
            loadResourcesForTab(tabId);
        } else {
            console.warn(`loadResourcesForTab function not found, cannot load content for ${tabId}.`);
        }
    }
}

// Function to load content/initialize based on the activated tab ID
function loadResourcesForTab(tabId) {
    console.log(`Routing load for tab: ${tabId}`);

    switch(tabId) {
        case 'home':
            if (typeof initializeHomePage === 'function') {
                initializeHomePage(); // Let home_page.js handle its specific logic and sub-tabs
            } else {
                console.warn('initializeHomePage function not found.');
            }
            break;
        case 'resources':
            if (typeof loadResourcesPage === 'function') {
                loadResourcesPage(); // Call the function from resource_explorer.js
            } else {
                console.warn('loadResourcesPage function not found.');
            }
            break;
        case 'cli':
            if (typeof initializeTerminal === 'function') {
                initializeTerminal(); // From terminal.js
            } else {
                 console.warn('initializeTerminal function not found.');
            }
            break;
        case 'yaml':
            if (typeof setupDropZone === 'function') {
                setupDropZone(); // From yaml_deploy.js
            } else {
                console.warn('setupDropZone function not found.');
            }
            break;
        case 'namespaces':
             if (typeof loadNamespacesViewData === 'function') {
                loadNamespacesViewData(); // From namespaces_view.js
            } else {
                 console.warn('loadNamespacesViewData function not found.');
            }
            break;
        case 'charts':
            if (typeof refreshCharts === 'function') {
                refreshCharts(); // From charts_page.js
            } else {
                console.warn('refreshCharts function not found.');
            }
            break;
        case 'settings':
            // Settings might load specific things like git status
            if (typeof checkGitAvailability === 'function') {
                checkGitAvailability(); // From settings.js
            } else {
                 console.warn('checkGitAvailability function not found.');
            }
             // Any other settings initializations...
            break;
        case 'events': // Assuming events tab is separate and handled by events_tab.js
             if (typeof fetchNamespacesForEventsTab === 'function') {
                fetchNamespacesForEventsTab();
            } else {
                 console.warn('fetchNamespacesForEventsTab function not found.');
            }
            break;
        // Add cases for direct resource tabs if they exist outside 'home' or 'resources' explorer
        case 'pods':
        case 'services':
        case 'deployments':
        case 'inferenceservices':
        case 'configmaps':
        case 'secrets':
             // If these can be top-level tabs, load their data directly
             // This might be redundant if they are only ever inside 'home' or 'resources'
             console.log(`Direct resource tab ${tabId} activated.`);
             if (typeof fetchResourceData === 'function') {
                 // Ensure the correct namespace context is used if needed
                 const nsSelector = document.getElementById(`${tabId}Namespace`);
                 const currentNamespace = nsSelector ? nsSelector.value : 'all';
                 fetchResourceData(tabId, currentNamespace, false, 1, true);
             }
             break;
        default:
            console.log(`No specific load action defined for tab: ${tabId}`);
    }
} 