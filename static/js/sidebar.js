document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('main-content');
    const sidebarToggler = document.getElementById('sidebarToggler');

    if (!sidebar || !mainContent || !sidebarToggler) {
        console.error('Sidebar, main content, or toggler not found');
        return;
    }

    // Function to toggle sidebar
    function toggleSidebar(isInitialization = false) {
        // If it's not initialization, toggle the class for animation
        if (!isInitialization) {
            sidebar.classList.toggle('collapsed');
            mainContent.classList.toggle('collapsed');
        }

        const currentlyCollapsed = sidebar.classList.contains('collapsed');
        const icon = sidebarToggler.querySelector('i');

        if (currentlyCollapsed) {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
            if (!isInitialization) localStorage.setItem('sidebarState', 'collapsed');
        } else {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
            if (!isInitialization) localStorage.setItem('sidebarState', 'expanded');
        }
    }

    // Event listener for the toggler
    sidebarToggler.addEventListener('click', () => toggleSidebar(false));

    // Check for saved state in localStorage and apply it on load
    const savedState = localStorage.getItem('sidebarState');
    if (savedState === 'collapsed') {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('collapsed');
    }
    
    // Set initial state for icon and localStorage without triggering animation
    toggleSidebar(true);
}); 