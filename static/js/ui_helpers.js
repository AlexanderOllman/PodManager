// ui_helpers.js

// Show loading indicator for a resource type
function showLoading(resourceType) {
    const loadingContainer = document.getElementById(`${resourceType}Loading`);
    const tableContainer = document.getElementById(`${resourceType}TableContainer`);
    const progressBar = document.getElementById(`${resourceType}ProgressBar`);
    const loadingText = document.getElementById(`${resourceType}LoadingText`);

    if (loadingContainer) loadingContainer.style.display = 'flex';
    if (tableContainer) tableContainer.style.opacity = '0';
    if (progressBar) {
        progressBar.style.width = '5%';
        progressBar.style.background = 'linear-gradient(to right, #f5f5f5, #01a982)';
        // Animate progress bar
        setTimeout(() => {
            progressBar.style.width = '30%';
            setTimeout(() => {
                progressBar.style.width = '60%';
            }, 500);
        }, 200);
    }
    if (loadingText) loadingText.textContent = 'Loading data...';
}

// Hide loading indicator for a resource type
function hideLoading(resourceType) {
    const loadingContainer = document.getElementById(`${resourceType}Loading`);
    const progressBar = document.getElementById(`${resourceType}ProgressBar`);

    if (progressBar) {
        progressBar.style.width = '100%';
        setTimeout(() => {
            if (loadingContainer) loadingContainer.style.display = 'none';
            if (progressBar) progressBar.style.width = '0%';
        }, 500);
    }
    // Note: Table container opacity is handled in renderCurrentPage or renderResourcePage
}

// Update loading step with animation (if used, otherwise can be removed)
function updateLoadingStep(resourceType, stepIndex) {
    const steps = [
        { text: 'Initializing...', percentage: 5 },
        { text: 'Fetching data...', percentage: 30 },
        { text: 'Processing...', percentage: 60 },
        { text: 'Finalizing...', percentage: 90 },
        { text: 'Complete', percentage: 100 }
    ];
    const progressBar = document.getElementById(`${resourceType}ProgressBar`);
    const loadingText = document.getElementById(`${resourceType}LoadingText`);

    if (progressBar && stepIndex < steps.length) {
        progressBar.style.width = `${steps[stepIndex].percentage}%`;
    }
    if (loadingText && stepIndex < steps.length) {
        loadingText.textContent = steps[stepIndex].text;
    }
}

// Helper to create action buttons for resource tables
function createActionButton(resourceType, namespace, name) {
    const dropdownId = `dropdown-${namespace}-${name}`.replace(/[^a-zA-Z0-9-_]/g, '-'); // Sanitize ID
    let actionsHtml = '';

    if (resourceType === 'pods') {
        actionsHtml = `
            <li><a class="dropdown-item explore-pod-link" href="/explore/${namespace}/${name}#details" data-namespace="${namespace}" data-pod-name="${name}">
                <i class="fas fa-search text-primary"></i> View Details
            </a></li>
            <li><a class="dropdown-item" href="/explore/${namespace}/${name}#describe" data-namespace="${namespace}" data-pod-name="${name}">
                <i class="fas fa-info-circle text-info"></i> Describe
            </a></li>
            <li><a class="dropdown-item" href="/explore/${namespace}/${name}#logs" data-namespace="${namespace}" data-pod-name="${name}">
                <i class="fas fa-file-alt text-success"></i> Logs
            </a></li>
            <li><a class="dropdown-item" href="/explore/${namespace}/${name}#access" data-namespace="${namespace}" data-pod-name="${name}">
                <i class="fas fa-terminal text-warning"></i> Access
            </a></li>
            <li><hr class="dropdown-divider"></li>
        `;
    } else {
        actionsHtml = `
            <li><a class="dropdown-item" href="#" onclick="runAction('describe', '${resourceType}', '${namespace}', '${name}')">
                <i class="fas fa-info-circle text-info"></i> Describe
            </a></li>
            <li><hr class="dropdown-divider"></li>
        `;
    }

    return `
        <div class="resource-actions">
            <div class="action-dropdown dropdown text-center">
                <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" id="${dropdownId}" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="${dropdownId}">
                    ${actionsHtml}
                    <li><a class="dropdown-item" href="#" onclick="runAction('delete', '${resourceType}', '${namespace}', '${name}')">
                        <i class="fas fa-trash-alt text-danger"></i> Delete
                    </a></li>
                </ul>
            </div>
        </div>
    `;
}

// Get status icon based on phase
function getStatusIcon(phase) {
    if (!phase) return '<i class="fas fa-question-circle text-muted me-1"></i>'; // Default for undefined phase
    phase = String(phase).toLowerCase(); // Ensure phase is a string and lowercase
    switch (phase) {
        case 'running':
        case 'true': // Common for boolean-like statuses
        case 'active': // For namespaces or other active states
        case 'available': // For deployments
            return '<i class="fas fa-check-circle text-success me-1"></i>';
        case 'succeeded':
            return '<i class="fas fa-check-square text-primary me-1"></i>';
        case 'pending':
        case 'progressing': // For deployments
            return '<i class="fas fa-clock text-warning me-1"></i>';
        case 'failed':
        case 'false': // Common for boolean-like statuses
        case 'error':
            return '<i class="fas fa-times-circle text-danger me-1"></i>';
        case 'terminating':
             return '<i class="fas fa-hourglass-end text-warning me-1"></i>';
        case 'unknown':
            return '<i class="fas fa-question-circle text-muted me-1"></i>';
        default:
            return '<i class="fas fa-info-circle text-info me-1"></i>'; // Generic info for other statuses
    }
}

// Capitalize first letter helper
function capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Add refresh alert container after loading container
function addRefreshAlert(resourceType) {
    const container = document.getElementById(`${resourceType}TableContainer`);
    if (!container) return null;

    let alertDiv = container.querySelector('.refresh-alert');
    if (alertDiv) {
        alertDiv.style.display = 'flex'; // Ensure it's visible if it exists
        return alertDiv;
    }

    alertDiv = document.createElement('div');
    alertDiv.className = 'refresh-alert alert alert-warning d-flex align-items-center mb-3';
    alertDiv.style.display = 'none'; // Initially hidden
    alertDiv.innerHTML = `
        <i class="fas fa-exclamation-circle me-2"></i>
        <div class="flex-grow-1">
            This data is more than ${Math.floor((window.app.state.cache.STALE_THRESHOLD || 120000) / 60000)} minutes old and may be outdated.
        </div>
        <button class="btn btn-sm btn-warning ms-3" onclick="forceRefreshResourceData('${resourceType}')">
            <i class="fas fa-sync-alt me-1"></i> Refresh Now
        </button>
    `;
    // Insert as the first child of the container
    if (container.firstChild) {
        container.insertBefore(alertDiv, container.firstChild);
    } else {
        container.appendChild(alertDiv);
    }
    return alertDiv;
}

// Function to explicitly refresh resource data, bypassing cache for the alert button
function forceRefreshResourceData(resourceType) {
    console.log(`Force refreshing ${resourceType} data due to stale alert.`);
    const namespaceSelector = document.getElementById(`${resourceType}Namespace`);
    const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
    
    // Clear cache for this specific resource/namespace combo before fetching
    const cacheKey = `${resourceType}-${currentNamespace}-full-1`; // Or construct based on current page
    if (window.app.state.cache.lastFetch[cacheKey]) {
        delete window.app.state.cache.lastFetch[cacheKey];
    }
    if (window.app.state.cache.resources[cacheKey]) {
        delete window.app.state.cache.resources[cacheKey];
    }
    if (window.app.state.resources[resourceType]) {
         window.app.state.resources[resourceType].loadedPages = []; // Reset loaded pages for this type
    }

    // Hide the alert
    const alertDiv = document.querySelector(`#${resourceType}TableContainer .refresh-alert`);
    if (alertDiv) {
        alertDiv.style.display = 'none';
    }

    fetchResourceData(resourceType, currentNamespace, false, 1, true); // Fetch page 1 and reset data
}

// Helper to log messages to a specific log element (e.g., refresh log in settings)
function logMessage(logElement, message, status) {
    if (!logElement) return;
    
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    
    if (status === 'error') logEntry.className = 'text-danger';
    else if (status === 'warning') logEntry.className = 'text-warning';
    else if (status === 'success') logEntry.className = 'text-success';
    else logEntry.className = 'text-info'; // Default
    
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    logElement.appendChild(logEntry);
    logElement.scrollTop = logElement.scrollHeight; // Auto-scroll
}

// Formats memory size from bytes to a human-readable string
function formatMemorySize(bytes) {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '-'; // Handle invalid input
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    // Ensure i is within the bounds of the sizes array
    if (i < 0 || i >= sizes.length) return bytes + ' B'; 

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
} 