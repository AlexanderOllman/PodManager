// navigation_listeners.js

// Global click listener for navigation, specifically handling pod explorer links
document.addEventListener('click', function(e) {
    // Handle clicks on explore pod links using event delegation
    const exploreLink = e.target.closest('.explore-pod-link');
    if (exploreLink) {
        e.preventDefault(); // Prevent default link behavior
        const namespace = exploreLink.dataset.namespace;
        const podName = exploreLink.dataset.podName;
        
        if (!namespace || !podName) {
            console.error('Missing namespace or pod name on explore link:', exploreLink);
            return;
        }

        // Determine the target URL, including any hash for specific sections
        let targetUrl = exploreLink.getAttribute('href'); 
        if (!targetUrl || !targetUrl.startsWith('/explore/')) {
            // Fallback if href is missing or invalid
             targetUrl = window.app.getRelativeUrl(`/explore/${namespace}/${podName}`);
            console.warn('Using fallback URL for explore link:', targetUrl);
        }
        
        console.log(`Navigating to pod explorer via link: ${targetUrl}`);
        
        // Set a flag for the home page initialization to know we came from a pod view
        sessionStorage.setItem('returning_from_pod_view', 'true'); 
        
        // Perform full page navigation to the explorer page
        window.location.href = targetUrl;
    }
    
    // Add other global navigation click handlers here if needed
    // e.g., handling clicks on describe actions that might open modals or navigate
    const actionLink = e.target.closest('a[onclick^="runAction(']');
    if (actionLink) {
        // Optionally intercept or enhance these actions here
        // console.log('Action link clicked:', actionLink.getAttribute('onclick'));
    }
});

// Placeholder for runAction if it needs to be globally available
// This function might be better placed in a dedicated action_handler.js file
function runAction(action, resourceType, namespace, name) {
    console.log(`Action triggered: ${action} on ${resourceType} ${namespace}/${name}`);
    // Implement logic based on action (e.g., show modal for describe/delete)
    // This likely involves calling functions defined in other modules (e.g., namespaces_view.js for its modal)
    // or potentially a generic modal handler.
    
    if (action === 'delete') {
        // Example: Use a generic confirmation dialog
        Swal.fire({
            title: `Delete ${resourceType}?`,
            html: `Are you sure you want to delete <strong>${name}</strong> in namespace <strong>${namespace}</strong>?`, 
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'Yes, delete it!'
        }).then((result) => {
            if (result.isConfirmed) {
                Swal.fire('Deleting...', `Sending request...`, 'info');
                // Call appropriate API endpoint based on resourceType
                // Example API call structure (replace with actual endpoint):
                const deleteUrl = window.app.getRelativeUrl(`/api/${resourceType}/delete?namespace=${namespace}&name=${name}`);
                fetch(deleteUrl, { method: 'POST' }) // Use POST or DELETE as per API design
                    .then(response => response.json())
                    .then(data => {
                        if (data.success || data.output) {
                            Swal.fire('Deleted!', `${resourceType} ${name} deleted.`, 'success');
                            // Refresh the relevant view
                            if (window.app.state.navigation?.activeTab === 'resources') {
                                if (typeof loadResourceType === 'function') loadResourceType(resourceType); // Reload current view in explorer
                            } else {
                                // Refresh the specific table on the home dashboard
                                const nsSelector = document.getElementById(`${resourceType}Namespace`);
                                const currentNamespace = nsSelector ? nsSelector.value : 'all';
                                if (typeof fetchResourceData === 'function') fetchResourceData(resourceType, currentNamespace, false, 1, true);
                            }
                        } else {
                             Swal.fire('Error', `Failed: ${data.error || 'Unknown error'}`, 'error');
                        }
                    })
                    .catch(err => {
                        Swal.fire('Error', `Request failed: ${err}`, 'error');
                    });
            }
        });
    } else if (action === 'describe') {
        // Example: Fetch description and show in a generic modal or dedicated view
         Swal.fire('Describe', `Implement describe action for ${resourceType} ${namespace}/${name}`, 'info');
         // Fetch describe info via API and display...
    } else {
         console.warn('Unhandled action:', action);
    }
} 