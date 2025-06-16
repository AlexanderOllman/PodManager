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
        // If it's not initialization, toggle the class
        if (!isInitialization) {
            sidebar.classList.toggle('collapsed');
            contentWrapper.classList.toggle('collapsed');
        }

        const currentlyCollapsed = sidebar.classList.contains('collapsed');
        const icon = sidebarToggler.querySelector('i');

        if (icon) {
            if (currentlyCollapsed) {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            } else {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            }
        }

        if (currentlyCollapsed) {
            if (!isInitialization) localStorage.setItem('sidebarState', 'collapsed');
        } else {
            if (!isInitialization) localStorage.setItem('sidebarState', 'expanded');
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
    
    // Set initial state without toggling
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