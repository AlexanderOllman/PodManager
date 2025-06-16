document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const contentWrapper = document.getElementById('content-wrapper');
    const sidebarToggler = document.getElementById('sidebarToggler');

    if (!sidebar || !contentWrapper || !sidebarToggler) {
        console.error('Sidebar, content wrapper, or toggler not found');
        return;
    }

    // Function to toggle sidebar
    function toggleSidebar(isInitialization = false) {
        // If it's a user click, toggle the classes
        if (!isInitialization) {
            sidebar.classList.toggle('collapsed');
            contentWrapper.classList.toggle('collapsed');
        }

        const isCollapsed = sidebar.classList.contains('collapsed');
        const icon = sidebarToggler.querySelector('i');

        // Only try to change the icon if it exists
        if (icon) {
            if (isCollapsed) {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            } else {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            }
        }
        
        // Save state only on user interaction
        if (!isInitialization) {
            localStorage.setItem('sidebarState', isCollapsed ? 'collapsed' : 'expanded');
        }
    }

    // Event listener for the toggler
    sidebarToggler.addEventListener('click', () => toggleSidebar(false));

    // Check for saved state in localStorage and apply it. Default to collapsed.
    const savedState = localStorage.getItem('sidebarState');
    if (savedState === 'expanded') {
        sidebar.classList.remove('collapsed');
        contentWrapper.classList.remove('collapsed');
    } else {
        sidebar.classList.add('collapsed');
        contentWrapper.classList.add('collapsed');
    }
    
    // Set initial icon state without toggling classes again
    toggleSidebar(true);

    // Ensure the sidebar state is correct on resize, especially for smaller screens
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 768 && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            contentWrapper.classList.add('collapsed');
            toggleSidebar(true); // Update icon and state
        }
    });
}); 