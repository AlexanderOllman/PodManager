// events_tab.js

// Fetch namespaces specifically for the events tab selector
function fetchNamespacesForEventsTab() {
    const namespaceSelect = document.getElementById('namespaceSelect');
    if (!namespaceSelect) {
        console.log('Namespace select dropdown for events tab not found.');
        return;
    }

    // Clear current options and show loading state
    namespaceSelect.innerHTML = '<option value="">Loading namespaces...</option>';
    namespaceSelect.disabled = true;

    const url = window.app.getRelativeUrl('/get_namespaces');
    fetch(url)
        .then(response => response.json())
        .then(data => {
            namespaceSelect.innerHTML = '<option value="">Select a namespace</option>'; // Reset default option
            if (data.namespaces && Array.isArray(data.namespaces)) {
                data.namespaces.forEach(namespace => {
                    const option = document.createElement('option');
                    option.value = namespace;
                    option.textContent = namespace;
                    namespaceSelect.appendChild(option);
                });
                namespaceSelect.disabled = false; // Enable selector
                // Add event listener only after successful population
                 if (!namespaceSelect.dataset.listenerAttached) { // Prevent multiple listeners
                    namespaceSelect.addEventListener('change', handleEventNamespaceChange);
                    namespaceSelect.dataset.listenerAttached = 'true';
                 }
            } else {
                console.error('Error fetching namespaces for events tab:', data.error || 'Invalid data format');
                namespaceSelect.innerHTML = '<option value="">Error loading namespaces</option>'; 
            }
        })
        .catch(error => {
            console.error('Error fetching namespaces for events tab:', error);
            namespaceSelect.innerHTML = '<option value="">Error loading namespaces</option>';
        });
}

// Handles the change event for the namespace selector on the Events tab
function handleEventNamespaceChange() {
    const selectedNamespace = this.value;
    const eventsOutput = document.getElementById('eventsOutput');
    if (!eventsOutput) return;

    if (selectedNamespace) {
        fetchEvents(selectedNamespace);
    } else {
        eventsOutput.textContent = 'Please select a namespace to view events.';
        eventsOutput.className = 'text-muted';
    }
}

// Fetch events for the selected namespace
function fetchEvents(namespace) {
    const eventsOutput = document.getElementById('eventsOutput');
    if (!eventsOutput) return;
    
    eventsOutput.textContent = 'Loading events...';
    eventsOutput.className = 'text-info';
    
    const url = window.app.getRelativeUrl('/get_events');
    const formData = new FormData();
    formData.append('namespace', namespace);

    fetch(url, {
        method: 'POST',
        // headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, // FormData sets content type
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
        })
    .then(data => {
        if (data.output) {
            eventsOutput.textContent = data.output;
            eventsOutput.className = 'text-monospace'; // Use monospace for pre-formatted text
        } else if (data.error) {
            eventsOutput.textContent = `Error fetching events: ${data.error}`;
            eventsOutput.className = 'text-danger';
        } else {
             eventsOutput.textContent = 'No events found in this namespace.';
             eventsOutput.className = 'text-muted';
        }
    })
    .catch(error => {
        console.error('Error fetching events:', error);
        eventsOutput.textContent = `An error occurred: ${error.message}`;
        eventsOutput.className = 'text-danger';
    });
}

// Initialize event tab functionality when the tab becomes visible
document.addEventListener('DOMContentLoaded', () => {
    const eventsTab = document.getElementById('events-tab'); // Assuming the trigger is #events-tab
    if (eventsTab) {
        eventsTab.addEventListener('shown.bs.tab', function (event) {
            console.log('Events tab shown, fetching namespaces...');
            fetchNamespacesForEventsTab();
            // Clear previous output when tab is shown
            const eventsOutput = document.getElementById('eventsOutput');
            if (eventsOutput) {
                eventsOutput.textContent = 'Select a namespace to view events.';
                eventsOutput.className = 'text-muted';
            }
        });
    }
     // Also call fetchNamespaces if the events tab is already active on load (e.g. deep link)
    if (document.getElementById('events')?.classList.contains('active')) {
        fetchNamespacesForEventsTab();
    }
}); 