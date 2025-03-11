/**
 * HPE Private Cloud AI Resource Manager
 * Main JavaScript file
 */

// Basic utility functions that don't depend on external libraries
function getStatusIcon(status) {
    switch (status.toLowerCase()) {
        case 'running':
            return '<i class="fas fa-check-circle status-icon status-running"></i>';
        case 'pending':
            return '<i class="fas fa-clock status-icon status-pending"></i>';
        case 'failed':
            return '<i class="fas fa-times-circle status-icon status-failed"></i>';
        default:
            return '<i class="fas fa-question-circle status-icon status-unknown"></i>';
    }
}

// Script loading utilities 
function loadScript(url, callback) {
    const script = document.createElement('script');
    script.onload = callback;
    script.onerror = function() {
        console.error('Failed to load script:', url);
        if (callback) callback(new Error(`Failed to load script: ${url}`));
    };
    script.src = url;
    document.body.appendChild(script);
}

// Track loaded scripts - set Socket.IO and Terminal to true since we're loading them directly
window.appLoaded = {
    socketio: true,
    terminal: true
};

// Global app state
window.app = {
    socket: null,
    terminal: null,
    init: false
};

// Initialize Socket.IO connection when document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Socket.IO connection
    try {
        window.app.socket = io();
        console.log('Socket.IO connected');
    } catch (err) {
        console.error('Failed to connect Socket.IO:', err);
    }
    
    // Hide loading overlay since we're loading scripts directly
    document.getElementById('loading-overlay').style.display = 'none';
    
    // Intercept clicks on pod explore links
    document.body.addEventListener('click', function(e) {
        const target = e.target.closest('a[href^="/explore/"]');
        if (target) {
            e.preventDefault();
            const href = target.getAttribute('href');
            navigateToExplore(href);
        }
    });
    
    // Handle back navigation from the explore page
    const homeLink = document.getElementById('homeLink');
    if (homeLink) {
        homeLink.addEventListener('click', function(e) {
            e.preventDefault();
            navigateToHome();
        });
    }
    
    // Initialize sidebar toggle functionality
    initSidebarToggle();
});

// Navigation functions
function navigateToExplore(url) {
    fetch(url)
        .then(response => response.text())
        .then(html => {
            // Extract the content from the explore page
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const content = doc.querySelector('#main-content').innerHTML;
            
            // Store the current page state in history
            const currentState = document.getElementById('main-content').innerHTML;
            window.history.pushState({content: currentState, page: 'home'}, '', '/');
            
            // Update the page content and history
            document.getElementById('main-content').innerHTML = content;
            window.history.pushState({content: content, page: 'explore'}, '', url);
            
            // Initialize the explore page components
            if (typeof initializeExplorePage === 'function') {
                initializeExplorePage();
            }
        })
        .catch(error => {
            console.error('Error:', error);
        });
}

function navigateToHome() {
    fetch('/')
        .then(response => response.text())
        .then(html => {
            // Extract the content from the home page
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const content = doc.querySelector('#main-content').innerHTML;
            
            // Update the page content and history
            document.getElementById('main-content').innerHTML = content;
            window.history.pushState({content: content, page: 'home'}, '', '/');
            
            // Initialize the home page components
            if (typeof initializeHomePage === 'function') {
                initializeHomePage();
            }
        })
        .catch(error => {
            console.error('Error:', error);
        });
}

// Handle browser back/forward buttons
window.addEventListener('popstate', function(event) {
    if (event.state) {
        document.getElementById('main-content').innerHTML = event.state.content;
        if (event.state.page === 'home' && typeof initializeHomePage === 'function') {
            initializeHomePage();
        } else if (event.state.page === 'explore' && typeof initializeExplorePage === 'function') {
            initializeExplorePage();
        }
    }
});

// Action handling functionality
function runAction(action, resourceType, namespace, name) {
    const actionModal = new bootstrap.Modal(document.getElementById('actionModal'));
    actionModal.show();
    
    document.getElementById('actionLoading').style.display = 'flex';
    document.getElementById('actionResult').style.display = 'none';
    
    // Add a title to the modal based on the action
    let actionTitle = '';
    switch(action) {
        case 'describe':
            actionTitle = `Describing ${resourceType}/${name} in namespace ${namespace}`;
            break;
        case 'logs':
            actionTitle = `Logs for ${resourceType}/${name} in namespace ${namespace}`;
            break;
        case 'exec':
            actionTitle = `Process list for ${resourceType}/${name} in namespace ${namespace}`;
            break;
        case 'delete':
            actionTitle = `Deleting ${resourceType}/${name} in namespace ${namespace}`;
            break;
        default:
            actionTitle = `Action: ${action} for ${resourceType}/${name}`;
    }
    
    document.getElementById('actionModalLabel').textContent = actionTitle;

    fetch('/run_action', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `action=${action}&resource_type=${resourceType}&namespace=${namespace}&resource_name=${name}`
    })
    .then(response => response.json())
    .then(data => {
        const actionResult = document.getElementById('actionResult');
        // Use pre element to preserve formatting
        actionResult.innerHTML = `<pre>${data.output}</pre>`;
        document.getElementById('actionLoading').style.display = 'none';
        actionResult.style.display = 'block';
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('actionLoading').style.display = 'none';
        document.getElementById('actionResult').style.display = 'block';
        document.getElementById('actionResult').textContent = 'An error occurred while performing the action.';
    });
}

// Sidebar toggle functionality
function initSidebarToggle() {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    
    // Function to toggle sidebar
    function toggleSidebar() {
        sidebar.classList.toggle('sidebar-collapsed');
        mainContent.classList.toggle('expanded');
        
        // Save state to localStorage
        const isSidebarCollapsed = sidebar.classList.contains('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', isSidebarCollapsed);
    }
    
    // Add click event to toggle button
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }
    
    // Check localStorage for saved state
    const isSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isSidebarCollapsed) {
        sidebar.classList.add('sidebar-collapsed');
        mainContent.classList.add('expanded');
    }
    
    // Add responsive behavior for small screens
    function checkScreenSize() {
        if (window.innerWidth < 768) {
            sidebar.classList.add('sidebar-collapsed');
            mainContent.classList.add('expanded');
        } else if (localStorage.getItem('sidebarCollapsed') !== 'true') {
            sidebar.classList.remove('sidebar-collapsed');
            mainContent.classList.remove('expanded');
        }
    }
    
    // Check on page load and when window is resized
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
} 