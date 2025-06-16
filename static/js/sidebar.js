document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const sidebarToggler = document.getElementById('sidebarToggler');

    if (!sidebar || !mainContent || !sidebarToggler) {
        console.error('Sidebar, main content, or toggler not found');
        return;
    }

    const brandText = document.querySelector('.sidebar-brand .brand-text');
    const sidebarBrand = document.querySelector('.sidebar-brand');

    // Function to toggle sidebar
    function toggleSidebar(isInitialization = false) {
        const isCollapsed = sidebar.classList.contains('collapsed');

        // If it's not initialization, toggle the class
        if (!isInitialization) {
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('collapsed');
        }

        const currentlyCollapsed = sidebar.classList.contains('collapsed');
        const icon = sidebarToggler.querySelector('i');

        if (currentlyCollapsed) {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
            if (brandText) brandText.style.opacity = '0';
            if (sidebarBrand) sidebarBrand.style.pointerEvents = 'none';
            if (!isInitialization) localStorage.setItem('sidebarState', 'collapsed');
        } else {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
            if (brandText) brandText.style.opacity = '1';
            if (sidebarBrand) sidebarBrand.style.pointerEvents = 'auto';
            if (!isInitialization) localStorage.setItem('sidebarState', 'expanded');
        }
    }

    // Event listener for the toggler
    sidebarToggler.addEventListener('click', () => toggleSidebar(false));

    // Check for saved state in localStorage and apply it
    const savedState = localStorage.getItem('sidebarState');
    if (savedState === 'collapsed') {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('collapsed');
    }
    
    // Set initial state without toggling
    toggleSidebar(true);

    // Ensure the sidebar state is correct on resize, especially for smaller screens
    window.addEventListener('resize', () => {
        if (window.innerWidth <= 768 && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            mainContent.classList.add('collapsed');
            toggleSidebar(true); // Update icon and state
        }
    });
}); 