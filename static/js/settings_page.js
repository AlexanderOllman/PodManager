document.addEventListener('DOMContentLoaded', function() {

    function injectTimestampElement() {
        // Check if the element already exists
        if (document.getElementById('db-last-updated-time')) {
            return; // Already injected
        }

        const settingsView = document.getElementById('settings-view');
        if (!settingsView) return;

        // Find the h4 element with the text "Database Management"
        const h4Elements = settingsView.getElementsByTagName('h4');
        let dbManagementHeader = null;
        for (let h4 of h4Elements) {
            if (h4.textContent.trim() === 'Database Management') {
                dbManagementHeader = h4;
                break;
            }
        }

        if (dbManagementHeader) {
            const p = document.createElement('p');
            p.className = 'text-muted small mb-2';
            p.innerHTML = 'Last refreshed: <span id="db-last-updated-time">Loading...</span>';
            dbManagementHeader.parentNode.insertBefore(p, dbManagementHeader.nextSibling);
        }
    }

    function updateDatabaseTimestamp() {
        const timestampSpan = document.getElementById('db-last-updated-time');
        if (!timestampSpan) {
            // Element might not be injected yet, try to inject it now
            injectTimestampElement();
            // And try to find it again
            const newTimestampSpan = document.getElementById('db-last-updated-time');
            if(!newTimestampSpan) {
                console.log("Could not find or create element #db-last-updated-time.");
                return;
            }
            updateTimestamp(newTimestampSpan);
        } else {
             updateTimestamp(timestampSpan);
        }
    }
    
    function updateTimestamp(element) {
        element.textContent = 'Loading...';
        fetch('/api/database/last_updated')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.error) {
                    console.error('Error fetching database timestamp:', data.error);
                    element.textContent = 'Error';
                    return;
                }

                const lastUpdatedDate = new Date(data.last_updated_iso);
                const options = {
                    year: 'numeric', month: 'long', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: true
                };
                element.textContent = lastUpdatedDate.toLocaleString(undefined, options);
            })
            .catch(error => {
                console.error('Failed to fetch or parse database timestamp:', error);
                element.textContent = 'Unavailable';
            });
    }

    function handleSettingsViewVisible() {
        injectTimestampElement();
        updateDatabaseTimestamp();
    }

    const settingsView = document.getElementById('settings-view');
    if (settingsView) {
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (settingsView.style.display !== 'none') {
                        handleSettingsViewVisible();
                    }
                }
            });
        });

        observer.observe(settingsView, { attributes: true });

        if (settingsView.style.display !== 'none') {
            handleSettingsViewVisible();
        }
    }

    const settingsNavLink = document.querySelector('a.nav-link[data-target="settings-view"], a.nav-link[data-bs-target="#settings"]');
    if (settingsNavLink) {
        settingsNavLink.addEventListener('click', function() {
            setTimeout(handleSettingsViewVisible, 50);
        });
    }
}); 