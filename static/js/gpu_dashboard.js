// gpu_dashboard.js

window.gpuFilterActive = false; // Global state for GPU filter

// Initializes GPU filter functionality on the dashboard
function initializeGPUFilter() {
    console.log('Initializing GPU filter card interaction');
    window.gpuFilterActive = false; // Reset state on init

    const gpuCard = document.getElementById('gpuCard');
    const clearFilterBtn = document.getElementById('clearGPUFilter');
    const gpuFilterStatus = document.getElementById('gpuFilterStatus');

    if (gpuCard && clearFilterBtn && gpuFilterStatus) {
        gpuCard.addEventListener('click', function(e) {
            if (e.target.closest('#clearGPUFilter')) return; // Ignore clicks on the clear button itself
            
            window.gpuFilterActive = !window.gpuFilterActive;
            console.log('GPU filter toggled:', window.gpuFilterActive);
            applyGPUFilter();
            updateGpuFilterUI();
        });

        clearFilterBtn.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevent card click event
            window.gpuFilterActive = false;
            console.log('GPU filter cleared');
            clearGPUFilter(); 
            updateGpuFilterUI();
        });
        
        // Initial UI update
        updateGpuFilterUI();

    } else {
        console.warn('Could not find all required elements for GPU filter initialization (gpuCard, clearGPUFilter, gpuFilterStatus).');
    }
}

// Updates the UI elements of the GPU filter card based on its state
function updateGpuFilterUI() {
    const gpuCard = document.getElementById('gpuCard');
    const clearFilterBtn = document.getElementById('clearGPUFilter');
    const gpuFilterStatus = document.getElementById('gpuFilterStatus');

    if (!gpuCard || !clearFilterBtn || !gpuFilterStatus) return; // Elements not found

    gpuCard.classList.toggle('filter-active', window.gpuFilterActive);
    clearFilterBtn.style.display = window.gpuFilterActive ? 'inline-block' : 'none';
    gpuFilterStatus.innerHTML = window.gpuFilterActive 
        ? '<span class="badge bg-success"><i class="fas fa-filter"></i> Filtered</span>' 
        : 'Click to filter';
}

// Applies the GPU filter to the currently displayed pods table
function applyGPUFilter() {
    // Determine which pod table is relevant (home dashboard or resources page)
    let resourceType = 'pods';
    let tableContainerId = 'podsTableContainer'; // Default to home dashboard pods tab
    let sourceItems = [];

    if (window.app.state.navigation?.activeTab === 'resources') {
        tableContainerId = 'resourcesTableContainer';
        if (window.app.currentResourceType !== 'pods') {
            console.log('GPU filter applied, but current resource type is not pods.');
            // Optionally switch resource type to pods, or just ignore?
            // For now, assume filter only applies if pods are the active type on resources page.
            return;
        }
    }

    console.log(`Applying GPU filter (active: ${window.gpuFilterActive}) to container ${tableContainerId}`);

    // Get the original, unfiltered list of pods
    // Prefer originalItems if stored, otherwise use the current items as source
    const podState = window.app.state.resources?.pods;
    if (podState?.originalItems) {
        sourceItems = podState.originalItems;
    } else if (podState?.items) {
        sourceItems = podState.items;
        // Store current items as original if applying filter for the first time without originals
        if (!podState.originalItems) {
            podState.originalItems = [...podState.items];
        }
    } else {
        console.warn('No source items found for GPU filter.');
        return; // No data to filter
    }

    let filteredItems;
    if (window.gpuFilterActive) {
        filteredItems = sourceItems.filter(item => {
            const resources = typeof getResourceUsage === 'function' ? getResourceUsage(item) : {};
            return resources.gpu && resources.gpu !== '-' && parseInt(resources.gpu) > 0;
        });
    } else {
        filteredItems = [...sourceItems]; // Restore original items
    }

    // Update state for the pods resource type
    if (podState) {
        podState.items = filteredItems;
        podState.totalCount = filteredItems.length;
        podState.currentPage = 1;
        podState.loadedPages = [1]; // Only page 1 is relevant after filtering
        podState.totalPages = Math.ceil(filteredItems.length / (podState.pageSize || 50));
    } else {
        console.error('Pod state object not found when applying GPU filter.');
        return;
    }

    // Render the filtered/unfiltered items
    if (typeof renderCurrentPage === 'function') {
        renderCurrentPage('pods');
    }

    // Add/Remove visual filter indicator on the table
    const tableContainer = document.getElementById(tableContainerId);
    if (tableContainer) {
        let indicator = tableContainer.querySelector('.filter-indicator.gpu-filter');
        if (window.gpuFilterActive) {
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'filter-indicator gpu-filter alert alert-info d-flex align-items-center mb-3';
                tableContainer.insertBefore(indicator, tableContainer.firstChild);
            }
            indicator.innerHTML = `
                <i class="fas fa-filter me-2"></i>
                <div class="flex-grow-1">Showing only pods with GPU requests (${filteredItems.length} found)</div>
                <button class="btn btn-sm btn-outline-info ms-3" onclick="clearGPUFilter(); updateGpuFilterUI();"> 
                    <i class="fas fa-times me-1"></i> Clear Filter
                </button>
            `;
        } else if (indicator) {
            indicator.remove();
        }
    }
    
    // Handle case where filter yields no results
    if (window.gpuFilterActive && filteredItems.length === 0) {
        const tableBody = selectTableBody('pods'); // Use helper to get correct body
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-4">
                        <i class="fas fa-info-circle me-2 text-muted"></i>
                        No pods with GPU requests found matching the current filter.
                         <button class="btn btn-sm btn-outline-secondary ms-3" onclick="clearGPUFilter(); updateGpuFilterUI();">
                            <i class="fas fa-times me-1"></i> Clear GPU Filter
                        </button>
                    </td>
                </tr>
            `;
        }
    }
}

// Clears the GPU filter and restores the original pod list view
function clearGPUFilter() {
    window.gpuFilterActive = false; // Ensure state is updated
    console.log('Clearing GPU filter.');
    
    const podState = window.app.state.resources?.pods;
    if (podState && podState.originalItems) {
        // Restore items from the stored original list
        podState.items = [...podState.originalItems];
        podState.totalCount = podState.items.length;
        podState.currentPage = 1;
        podState.loadedPages = [1];
        podState.totalPages = Math.ceil(podState.totalCount / (podState.pageSize || 50));
        
        // Optionally clear the originalItems cache if you want subsequent filters to re-cache
        // delete podState.originalItems;
    } else {
        // If no originalItems backup, the best fallback is to re-fetch
        console.warn('Original pod list not found, re-fetching pods to clear filter.');
        const namespaceSelector = document.getElementById('podsNamespace');
        const currentNamespace = namespaceSelector ? namespaceSelector.value : 'all';
        fetchResourceData('pods', currentNamespace, false, 1, true);
        return; // Re-fetch will handle rendering
    }

    // Remove the visual filter indicator
    const tableContainer = document.getElementById('podsTableContainer') || document.getElementById('resourcesTableContainer');
    if (tableContainer) {
        const indicator = tableContainer.querySelector('.filter-indicator.gpu-filter');
        if (indicator) indicator.remove();
    }
    
    // Re-render the restored list
    if (typeof renderCurrentPage === 'function') {
        renderCurrentPage('pods');
    }
    
    // Ensure the UI elements reflect the cleared state
    updateGpuFilterUI();
}


// --- jQuery dependent parts for Dashboard GPU/Namespace Metrics --- 

$(document).ready(function() {
    // Check if the necessary elements exist before adding listeners
    if ($('#refreshGpuPods').length && typeof fetchGpuPods === 'function') {
        $('#refreshGpuPods').on('click', function() {
            fetchGpuPods();
        });
        // Initial fetch
        fetchGpuPods(); 
    }

    if ($('#refreshNamespaceMetrics').length && typeof fetchNamespaceMetrics === 'function') {
        $('#refreshNamespaceMetrics').on('click', function() {
            fetchNamespaceMetrics($('#namespaceMetricSelector').val() || 'gpu');
        });
        // Initial fetch
        fetchNamespaceMetrics($('#namespaceMetricSelector').val() || 'gpu');
    }

    if ($('#namespaceMetricSelector').length && typeof fetchNamespaceMetrics === 'function') {
        $('#namespaceMetricSelector').on('change', function() {
            fetchNamespaceMetrics(this.value);
        });
    }
    
    // Note: GPU Card click listener is now vanilla JS (initializeGPUFilter)
});

// Fetches pods with GPU (for the dashboard card table) - uses jQuery AJAX
function fetchGpuPods() {
    const tableContainer = $('#gpuPodsTableContainer');
    const loadingContainer = $('#gpuPodsLoading');
    const progressBar = $('#gpuPodsProgressBar');
    const loadingText = $('#gpuPodsLoadingText');
    
    if (!tableContainer.length || !loadingContainer.length) return; // Exit if elements don't exist

    loadingContainer.show();
    tableContainer.css('opacity', 0);
    progressBar.css('width', '0%').removeClass('bg-danger');
    loadingText.text('Loading GPU Pods...');

    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 5;
        if (progress > 90) clearInterval(progressInterval);
        progressBar.css('width', `${progress}%`);
    }, 100);

    const url = window.app.getRelativeUrl('/api/gpu-pods');
    $.ajax({
        url: url,
        method: 'GET',
        success: function(data) {
            clearInterval(progressInterval);
            progressBar.css('width', '100%');
            renderGpuPods(data);
            setTimeout(() => {
                loadingContainer.hide();
                tableContainer.css('opacity', 1);
            }, 300);
        },
        error: function(xhr, status, error) {
            clearInterval(progressInterval);
            console.error('Error fetching GPU pods:', error);
            loadingText.text('Error: ' + (xhr.responseJSON?.error || error));
            progressBar.css('width', '100%').addClass('bg-danger');
            setTimeout(() => {
                loadingContainer.hide();
                tableContainer.css('opacity', 1);
                renderGpuPods([]); // Show empty state on error
            }, 1000);
        }
    });
}

// Renders GPU pods in the dashboard table
function renderGpuPods(pods) {
    const tableBody = $('#gpuPodsTable tbody');
    if (!tableBody.length) return;
    tableBody.empty();

    if (!pods || pods.length === 0) {
        tableBody.html('<tr><td colspan="6" class="text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>No pods with GPU found</td></tr>');
        return;
    }

    pods.sort((a, b) => b.gpu_count - a.gpu_count); // Sort by GPU count desc

    pods.forEach(pod => {
        let statusClass = 'text-muted';
        if (pod.status === 'Running') statusClass = 'text-success';
        else if (pod.status === 'Pending') statusClass = 'text-warning';
        else if ([ 'Failed', 'Error' ].includes(pod.status)) statusClass = 'text-danger';
        
        const row = `
            <tr>
                <td>${pod.namespace}</td>
                <td>${pod.name}</td>
                <td><span class="${statusClass}"><i class="fas fa-circle me-1"></i>${pod.status}</span></td>
                <td class="text-center"><span class="badge bg-success">${pod.gpu_count}</span></td>
                <td>${pod.memory_usage ? formatMemorySize(pod.memory_usage) : '-'}</td> 
                <td class="text-center">
                    <div class="btn-group btn-group-sm">
                         <button class="btn btn-outline-primary" onclick="viewPodDetails('${pod.namespace}', '${pod.name}')" title="View Details">
                            <i class="fas fa-search"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
        tableBody.append(row);
    });
}

// Fetches namespace resource metrics (for dashboard card table) - uses jQuery AJAX
function fetchNamespaceMetrics(metricType = 'gpu') {
    const tableContainer = $('#namespaceMetricsTableContainer');
    const loadingContainer = $('#namespaceMetricsLoading');
    const progressBar = $('#namespaceMetricsProgressBar');
    const loadingText = $('#namespaceMetricsLoadingText');
    
    if (!tableContainer.length || !loadingContainer.length) return; // Exit if elements don't exist

    loadingContainer.show();
    tableContainer.css('opacity', 0);
    progressBar.css('width', '0%').removeClass('bg-danger');
    loadingText.text('Loading Namespace Metrics...');

    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 5;
        if (progress > 90) clearInterval(progressInterval);
        progressBar.css('width', `${progress}%`);
    }, 100);

    const url = window.app.getRelativeUrl(`/api/namespace-metrics?metric=${metricType}`);
    $.ajax({
        url: url,
        method: 'GET',
        success: function(data) {
            clearInterval(progressInterval);
            progressBar.css('width', '100%');
            renderNamespaceMetrics(data, metricType);
            setTimeout(() => {
                loadingContainer.hide();
                tableContainer.css('opacity', 1);
            }, 300);
        },
        error: function(xhr, status, error) {
            clearInterval(progressInterval);
            console.error('Error fetching namespace metrics:', error);
            loadingText.text('Error: ' + (xhr.responseJSON?.error || error));
            progressBar.css('width', '100%').addClass('bg-danger');
            setTimeout(() => {
                loadingContainer.hide();
                tableContainer.css('opacity', 1);
                renderNamespaceMetrics([], metricType); // Show empty state
            }, 1000);
        }
    });
}

// Renders namespace metrics in the dashboard table
function renderNamespaceMetrics(metrics, metricType = 'gpu') {
    const tableBody = $('#namespaceMetricsTable tbody');
    if (!tableBody.length) return;
    tableBody.empty();

    if (!metrics || metrics.length === 0) {
        let message = `No namespaces found with ${metricType} usage.`;
        tableBody.html(`<tr><td colspan="5" class="text-center p-3 text-muted"><i class="fas fa-info-circle me-2"></i>${message}</td></tr>`);
        return;
    }

    // Add rows for each namespace metric
    metrics.forEach(metric => {
        const cpuClass = metricType === 'cpu' ? 'fw-bold text-primary' : '';
        const gpuClass = metricType === 'gpu' ? 'fw-bold text-success' : '';
        const memClass = metricType === 'memory' ? 'fw-bold text-info' : '';
        
        const row = `
            <tr>
                <td><strong>${metric.namespace}</strong></td>
                <td class="text-center">${metric.pod_count || 0}</td>
                <td class="text-center ${cpuClass}">${metric.cpu_usage?.toFixed(2) || '0.00'}</td>
                <td class="text-center ${gpuClass}">${metric.gpu_usage || 0}</td>
                <td class="text-center ${memClass}">${formatMemorySize(metric.memory_usage || 0)}</td>
            </tr>
        `;
        tableBody.append(row);
    });
}

// Placeholder/Example: Action to view pod details (likely navigates or shows modal)
function viewPodDetails(namespace, name) {
    console.log(`Request to view details for pod: ${namespace}/${name}`);
    // Implementation depends on how details are shown (e.g., navigate to explorer page)
    // Example navigation:
    window.location.href = window.app.getRelativeUrl(`/explore/${namespace}/${name}#details`);
}

// Placeholder/Example: Action to delete a pod (shows confirmation)
function deletePod(namespace, name) {
    console.log(`Request to delete pod: ${namespace}/${name}`);
    if (!namespace || !name) {
        console.error('Invalid namespace or pod name for deletion.');
        return;
    }
    // Use SweetAlert or similar for confirmation
    Swal.fire({
        title: 'Delete Pod?',
        html: `Delete pod <strong>${name}</strong> in namespace <strong>${namespace}</strong>?`, 
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Yes, delete it!'
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire('Deleting...', `Sending request to delete ${name}...`, 'info');
            // Actual delete API call needed here
            const deleteUrl = window.app.getRelativeUrl(`/api/pods/delete?namespace=${namespace}&name=${name}`);
            $.ajax({
                url: deleteUrl,
                type: 'POST', // Or DELETE, depending on backend API
                success: function(response) {
                    Swal.fire('Deleted!', `Pod ${name} deleted.`, 'success');
                    fetchGpuPods(); // Refresh the dashboard GPU pods list
                    // Potentially refresh main pods list if visible
                    if (window.app.state.navigation?.activeTab === 'home' && $('#pods-tab').hasClass('active')) {
                         fetchResourceData('pods', $('#podsNamespace').val() || 'all', false, 1, true);
                    } else if (window.app.state.navigation?.activeTab === 'resources' && window.app.currentResourceType === 'pods'){
                         loadResourceType('pods'); // Refresh resources view if showing pods
                    }
                },
                error: function(xhr) {
                    Swal.fire('Error!', `Failed to delete pod: ${xhr.responseJSON?.error || xhr.statusText}`, 'error');
                }
            });
        }
    });
}

// Store chart instances
window.app.charts = {};

function updateDashboardMetrics(data) {
    const metrics = data.cluster_metrics || data; // Handle both nested and flat structures
    if (!metrics) {
        console.error("Invalid data received for dashboard metrics update: no metrics object found");
        return;
    }

    const now = new Date();
    const lastUpdated = metrics.last_updated_timestamp ? 
        new Date(metrics.last_updated_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) :
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const lastUpdatedElement = document.getElementById('last-updated-time');
    if (lastUpdatedElement) {
        lastUpdatedElement.textContent = lastUpdated;
    }

    // --- Helper to create or update chart ---
    const createOrUpdateChart = (chartId, percentage, centerText, label, color) => {
        const ctx = document.getElementById(chartId).getContext('2d');
        const chartData = {
            datasets: [{
                data: [percentage, 100 - percentage],
                backgroundColor: [color, 'rgba(0, 0, 0, 0.05)'],
                borderWidth: 0,
                cutout: '80%',
            }],
        };
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 500
            },
            tooltips: { enabled: false },
            hover: { mode: null },
            events: [],
        };

        if (window.app.charts[chartId]) {
            window.app.charts[chartId].data.datasets[0].data = [percentage, 100 - percentage];
            window.app.charts[chartId].data.datasets[0].backgroundColor = [color, 'rgba(0, 0, 0, 0.05)'];
            window.app.charts[chartId].update();
        } else {
            window.app.charts[chartId] = new Chart(ctx, { type: 'doughnut', data: chartData, options: options });
        }
        
        const centerTextEl = document.getElementById(`${chartId}-text`);
        if(centerTextEl) {
            centerTextEl.innerHTML = `<span class="percentage">${centerText}%</span><span class="label">${label}</span>`;
        }
    };
    
    // --- Helper to get color based on percentage ---
    const getColorForPercentage = (percentage) => {
        if (percentage > 90) return '#FF5A5A'; // hpe-error
        if (percentage > 75) return '#FFB800'; // hpe-warning
        return '#01A982'; // hpe-success
    };

    // --- Pods Card ---
    const runningPods = metrics.pods?.current_running ?? 0;
    const totalPods = metrics.pods?.total_allocatable ?? 0;
    const podPercentage = totalPods > 0 ? Math.round((runningPods / totalPods) * 100) : 0;
    createOrUpdateChart('pods-chart', podPercentage, podPercentage, 'Running', getColorForPercentage(podPercentage));
    document.getElementById('pods-details').textContent = `${runningPods} / ${totalPods}`;
    
    const podFooter = document.getElementById('pods-footer-info');
    if (podFooter) {
        podFooter.innerHTML = `
            <div class="status-breakdown">
                <div class="status-item"><span class="status-indicator" style="background-color: #01A982;"></span>Running: ${metrics.pods?.running ?? metrics.pods?.current_running ?? 0}</div>
                <div class="status-item"><span class="status-indicator" style="background-color: #FFB800;"></span>Pending: ${metrics.pods?.pending ?? 0}</div>
                <div class="status-item"><span class="status-indicator" style="background-color: #FF5A5A;"></span>Failed: ${metrics.pods?.failed ?? 0}</div>
            </div>`;
    }

    // --- CPU Card ---
    const usedCpu = Math.ceil(metrics.vcpu?.current_request_millicores ? (metrics.vcpu.current_request_millicores / 1000) : 0);
    const requestedCpu = Math.ceil(metrics.vcpu?.total_allocatable_millicores ? (metrics.vcpu.total_allocatable_millicores / 1000) : 0);
    const capacityCpu = Math.floor(metrics.vcpu?.total_capacity_millicores ? (metrics.vcpu.total_capacity_millicores / 1000) : 0);
    const cpuPercentage = requestedCpu > 0 ? Math.round((usedCpu / requestedCpu) * 100) : 0;
    createOrUpdateChart('cpu-chart', cpuPercentage, cpuPercentage, 'Utilized', getColorForPercentage(cpuPercentage));
    document.getElementById('cpu-details').textContent = `${usedCpu} / ${requestedCpu} Cores`;
    document.getElementById('cpu-capacity').textContent = `${capacityCpu} Cores`;

    // --- RAM Card ---
    const usedRam = Math.ceil(metrics.memory?.current_request_bytes ? (metrics.memory.current_request_bytes / 1024**3) : 0);
    const requestedRam = Math.ceil(metrics.memory?.total_allocatable_bytes ? (metrics.memory.total_allocatable_bytes / 1024**3) : 0);
    const capacityRam = Math.floor(metrics.memory?.total_capacity_bytes ? (metrics.memory.total_capacity_bytes / 1024**3) : 0);
    const ramPercentage = requestedRam > 0 ? Math.round((usedRam / requestedRam) * 100) : 0;
    createOrUpdateChart('ram-chart', ramPercentage, ramPercentage, 'Utilized', getColorForPercentage(ramPercentage));
    document.getElementById('ram-details').textContent = `${usedRam} / ${requestedRam} GB`;
    document.getElementById('ram-capacity').textContent = `${capacityRam} GB`;

    // --- GPU Card ---
    const runningGpuRequests = metrics.gpu?.running_gpu_request_units ?? 0;
    const totalGpu = metrics.gpu?.total_allocatable_units ?? 0;
    const pendingGpuRequests = metrics.gpu?.pending_gpu_request_units ?? 0;
    
    // Cap the assigned GPUs at the total available for the main display
    const assignedGpu = Math.min(runningGpuRequests, totalGpu);
    const gpuPercentage = totalGpu > 0 ? Math.round((assignedGpu / totalGpu) * 100) : 0;

    createOrUpdateChart('gpu-chart', gpuPercentage, gpuPercentage, 'Allocated', getColorForPercentage(gpuPercentage));
    document.getElementById('gpu-details').textContent = `${assignedGpu} / ${totalGpu} Units`;
    
    const gpuFooter = document.getElementById('gpu-footer-info');
    if (gpuFooter) {
        const failedGpuRequests = metrics.gpu?.failed_gpu_request_units ?? 0;
        gpuFooter.innerHTML = `
            <div class="requests-label" style="font-weight: 500; margin-bottom: 4px; text-align: center; font-size: 0.9em;">Requests</div>
            <div class="status-breakdown">
                <div class="status-item"><span class="status-indicator" style="background-color: #01A982;"></span>Running: ${runningGpuRequests}</div>
                <div class="status-item"><span class="status-indicator" style="background-color: #FFB800;"></span>Pending: ${pendingGpuRequests}</div>
                <div class="status-item"><span class="status-indicator" style="background-color: #FF5A5A;"></span>Failed: ${failedGpuRequests}</div>
            </div>`;
    }
} 

// GPU Dashboard Enhanced Features
// Manages the improved GPU-focused dashboard with comprehensive GPU insights

let currentGpuView = 'overview'; // 'overview', 'nodes', 'queue', 'pods'
let gpuRefreshInterval = null;

// Initialize GPU dashboard when page loads
function initializeGpuDashboard() {
    console.log('Initializing enhanced GPU dashboard...');
    
    // Check if GPU dashboard elements exist
    const gpuManagementSection = document.querySelector('.gpu-view-tabs');
    if (!gpuManagementSection) {
        console.log('GPU management section not found, skipping GPU dashboard initialization');
        return;
    }
    
    // Set up view switching
    setupGpuViewSwitching();
    
    // Load initial GPU overview
    loadGpuOverview();
    
    // Set up auto-refresh
    setupGpuAutoRefresh();
    
    // Load initial data
    loadAllGpuData();
}

function setupGpuViewSwitching() {
    // Add click handlers for GPU view tabs
    document.querySelectorAll('.gpu-view-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const view = this.dataset.view;
            switchGpuView(view);
        });
    });
}

function switchGpuView(view) {
    currentGpuView = view;
    
    // Update active tab
    document.querySelectorAll('.gpu-view-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });
    
    // Show/hide content sections
    document.querySelectorAll('.gpu-view-content').forEach(content => {
        content.style.display = content.dataset.view === view ? 'block' : 'none';
    });
    
    // Load data for the selected view
    switch(view) {
        case 'overview':
            loadGpuOverview();
            break;
        case 'nodes':
            loadGpuNodes();
            break;
        case 'queue':
            loadGpuQueue();
            break;
        case 'pods':
            fetchGpuPods();
            break;
    }
}

function setupGpuAutoRefresh() {
    // Clear any existing interval
    if (gpuRefreshInterval) {
        clearInterval(gpuRefreshInterval);
    }
    
    // Set up 30-second auto-refresh
    gpuRefreshInterval = setInterval(() => {
        if (currentGpuView === 'overview') {
            loadGpuOverview();
        } else if (currentGpuView === 'nodes') {
            loadGpuNodes();
        } else if (currentGpuView === 'queue') {
            loadGpuQueue();
        } else if (currentGpuView === 'pods') {
            fetchGpuPods();
        }
        
        // Always refresh namespace metrics
        fetchNamespaceMetrics('gpu');
    }, 30000);
}

function loadAllGpuData() {
    // Load all GPU data types
    loadGpuOverview();
    fetchGpuPods();
    fetchNamespaceMetrics('gpu');
}

// GPU Overview - Utilization Summary
function loadGpuOverview() {
    console.log('Loading GPU utilization overview...');
    
    fetch('/api/gpu-utilization')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                console.error('Error loading GPU utilization:', data.error);
                return;
            }
            
            renderGpuOverview(data);
        })
        .catch(error => {
            console.error('Error fetching GPU utilization:', error);
        });
}

function renderGpuOverview(data) {
    try {
        // Update GPU utilization cards
        updateGpuUtilizationCards(data);
        
        // Update GPU allocation chart with error handling
        updateGpuAllocationChart(data);
        
        // Update namespace GPU allocation table
        if (data.namespace_allocation) {
            updateNamespaceGpuTable(data.namespace_allocation);
        }
        
        // Update node GPU allocation table
        if (data.node_allocation) {
            updateNodeGpuTable(data.node_allocation);
        }
    } catch (error) {
        console.error('Error rendering GPU overview:', error);
        // Display fallback message if needed
        const overviewContainer = document.querySelector('.gpu-view-content[data-view="overview"]');
        if (overviewContainer) {
            // Could add fallback UI here if needed
        }
    }
}

function updateGpuUtilizationCards(data) {
    // Total GPU Capacity Card
    const capacityElement = document.getElementById('gpuTotalCapacity');
    if (capacityElement) {
        capacityElement.textContent = data.total_capacity;
    }
    
    // Running GPUs Card
    const runningElement = document.getElementById('gpuRunning');
    if (runningElement) {
        runningElement.textContent = data.allocated_gpus.running;
    }
    
    // Available GPUs Card
    const availableElement = document.getElementById('gpuAvailable');
    if (availableElement) {
        availableElement.textContent = data.available_gpus;
    }
    
    // Utilization Percentage
    const utilizationElement = document.getElementById('gpuUtilizationPercentage');
    if (utilizationElement) {
        utilizationElement.textContent = `${data.utilization_percentage}%`;
    }
    
    // Pending GPUs
    const pendingElement = document.getElementById('gpuPending');
    if (pendingElement) {
        pendingElement.textContent = data.allocated_gpus.pending;
    }
}

function updateGpuAllocationChart(data) {
    // Create or update a donut chart for GPU allocation
    const chartContainer = document.getElementById('gpuAllocationChart');
    if (!chartContainer) {
        console.warn('GPU allocation chart container not found');
        return;
    }
    
    // Check if Chart.js is available
    if (typeof Chart === 'undefined') {
        console.error('Chart.js library not loaded, cannot create GPU allocation chart');
        return;
    }
    
    const chartData = {
        labels: ['Running', 'Available', 'Pending'],
        datasets: [{
            data: [
                data.allocated_gpus?.running || 0,
                data.available_gpus || 0,
                data.allocated_gpus?.pending || 0
            ],
            backgroundColor: [
                '#01A982', // HPE Green for running
                '#CCCCCC', // Gray for available  
                '#FFB800'  // Warning yellow for pending
            ],
            borderWidth: 2,
            borderColor: '#ffffff'
        }]
    };
    
    try {
        // If chart already exists, update it; otherwise create new one
        if (window.gpuAllocationChart && typeof window.gpuAllocationChart.update === 'function') {
            window.gpuAllocationChart.data = chartData;
            window.gpuAllocationChart.update('none'); // Use 'none' animation mode for updates
        } else {
            // Destroy existing chart if it exists but is not properly initialized
            if (window.gpuAllocationChart && typeof window.gpuAllocationChart.destroy === 'function') {
                try {
                    window.gpuAllocationChart.destroy();
                } catch (destroyError) {
                    console.warn('Error destroying existing chart:', destroyError);
                }
            }
            // Clear the chart reference regardless
            window.gpuAllocationChart = null;
            
            const ctx = chartContainer.getContext('2d');
            window.gpuAllocationChart = new Chart(ctx, {
                type: 'doughnut',
                data: chartData,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                font: {
                                    family: 'MetricHPE'
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                                    return `${label}: ${value} GPUs (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error updating GPU allocation chart:', error);
        // Reset chart on error
        window.gpuAllocationChart = null;
    }
}

// GPU Nodes Overview
function loadGpuNodes() {
    console.log('Loading GPU nodes overview...');
    
    fetch('/api/gpu-nodes')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                console.error('Error loading GPU nodes:', data.error);
                return;
            }
            
            renderGpuNodes(data);
        })
        .catch(error => {
            console.error('Error fetching GPU nodes:', error);
        });
}

function renderGpuNodes(nodes) {
    const container = document.getElementById('gpuNodesContainer');
    if (!container) return;
    
    if (nodes.length === 0) {
        container.innerHTML = `
            <div class="alert alert-info">
                <i class="fas fa-info-circle me-2"></i>
                No GPU nodes found in the cluster.
            </div>
        `;
        return;
    }
    
    const nodesHtml = nodes.map(node => `
        <div class="col-md-6 col-lg-4 mb-4">
            <div class="card gpu-node-card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <h6 class="mb-0">
                        <i class="fas fa-server me-2"></i>
                        ${node.name}
                    </h6>
                    <span class="badge ${node.status === 'Ready' ? 'bg-success' : 'bg-danger'}">
                        ${node.status}
                    </span>
                </div>
                <div class="card-body">
                    <div class="row mb-3">
                        <div class="col-6">
                            <div class="text-center">
                                <div class="h3 mb-1 text-primary">${node.gpu_allocatable}</div>
                                <small class="text-muted">Available GPUs</small>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="text-center">
                                <div class="h3 mb-1 text-info">${node.gpu_capacity}</div>
                                <small class="text-muted">Total GPUs</small>
                            </div>
                        </div>
                    </div>
                    
                    <div class="gpu-node-details">
                        <div class="detail-row">
                            <span class="detail-label">GPU Model:</span>
                            <span class="detail-value">${node.gpu_model}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">CPU Cores:</span>
                            <span class="detail-value">${node.cpu_cores}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Memory:</span>
                            <span class="detail-value">${node.memory_gb} GB</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">Schedulable:</span>
                            <span class="detail-value">
                                <span class="badge ${node.schedulable ? 'bg-success' : 'bg-warning'}">
                                    ${node.schedulable ? 'Yes' : 'No'}
                                </span>
                            </span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">NVIDIA Driver:</span>
                            <span class="detail-value">${node.nvidia_driver}</span>
                        </div>
                    </div>
                </div>
                <div class="card-footer">
                    <small class="text-muted">
                        <i class="fas fa-clock me-1"></i>
                        Age: ${node.age || 'Unknown'}
                    </small>
                </div>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = nodesHtml;
}

// GPU Queue Monitoring
function loadGpuQueue() {
    console.log('Loading GPU queue information...');
    
    fetch('/api/gpu-queue')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                console.error('Error loading GPU queue:', data.error);
                return;
            }
            
            renderGpuQueue(data);
        })
        .catch(error => {
            console.error('Error fetching GPU queue:', error);
        });
}

function renderGpuQueue(queueData) {
    // Update queue summary cards
    updateQueueSummaryCards(queueData.queue_summary);
    
    // Update pending pods table
    updatePendingPodsTable(queueData.pending_pods);
}

function updateQueueSummaryCards(summary) {
    // Total Pending
    const pendingElement = document.getElementById('queueTotalPending');
    if (pendingElement) {
        pendingElement.textContent = summary.total_pending;
    }
    
    // Total GPU Requests
    const requestsElement = document.getElementById('queueTotalRequests');
    if (requestsElement) {
        requestsElement.textContent = summary.total_gpu_requests;
    }
    
    // Average Wait Time
    const avgWaitElement = document.getElementById('queueAvgWait');
    if (avgWaitElement) {
        avgWaitElement.textContent = formatDuration(summary.average_wait_time);
    }
    
    // Longest Wait Time
    const longestWaitElement = document.getElementById('queueLongestWait');
    if (longestWaitElement) {
        longestWaitElement.textContent = formatDuration(summary.longest_wait_time);
    }
}

function updatePendingPodsTable(pendingPods) {
    const tableBody = document.getElementById('pendingPodsTableBody');
    if (!tableBody) return;
    
    if (pendingPods.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-4">
                    <i class="fas fa-check-circle text-success me-2"></i>
                    No pods waiting for GPU resources
                </td>
            </tr>
        `;
        return;
    }
    
    const rowsHtml = pendingPods.map(pod => `
        <tr>
            <td>
                <strong>${pod.name}</strong>
                <br>
                <small class="text-muted">${pod.namespace}</small>
            </td>
            <td class="text-center">
                <span class="badge bg-warning">${pod.gpu_request}</span>
            </td>
            <td>${pod.wait_time_human}</td>
            <td>
                <span class="badge bg-info">${pod.reason}</span>
                ${pod.message ? `<br><small class="text-muted">${pod.message}</small>` : ''}
            </td>
            <td>${pod.owner}</td>
            <td>${pod.priority_class || 'Default'}</td>
            <td>
                <div class="dropdown">
                    <button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <ul class="dropdown-menu">
                        <li><a class="dropdown-item" href="#" onclick="describePod('${pod.namespace}', '${pod.name}')">
                            <i class="fas fa-info-circle me-2"></i>Describe
                        </a></li>
                        <li><a class="dropdown-item" href="#" onclick="viewPodLogs('${pod.namespace}', '${pod.name}')">
                            <i class="fas fa-file-alt me-2"></i>Logs
                        </a></li>
                        <li><a class="dropdown-item text-danger" href="#" onclick="deletePod('${pod.namespace}', '${pod.name}')">
                            <i class="fas fa-trash-alt me-2"></i>Delete
                        </a></li>
                    </ul>
                </div>
            </td>
        </tr>
    `).join('');
    
    tableBody.innerHTML = rowsHtml;
}

function formatDuration(seconds) {
    if (!seconds || seconds < 60) {
        return `${Math.round(seconds || 0)}s`;
    } else if (seconds < 3600) {
        return `${Math.round(seconds / 60)}m`;
    } else if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.round((seconds % 3600) / 60);
        return `${hours}h${minutes}m`;
    } else {
        const days = Math.floor(seconds / 86400);
        const hours = Math.round((seconds % 86400) / 3600);
        return `${days}d${hours}h`;
    }
}

// Enhanced namespace and node allocation tables
function updateNamespaceGpuTable(namespaceAllocation) {
    const container = document.getElementById('namespaceGpuAllocation');
    if (!container) return;
    
    const entries = Object.entries(namespaceAllocation);
    if (entries.length === 0) {
        container.innerHTML = '<div class="text-muted">No GPU allocations found</div>';
        return;
    }
    
    const tableHtml = `
        <table class="table table-sm">
            <thead>
                <tr>
                    <th>Namespace</th>
                    <th class="text-end">GPUs</th>
                </tr>
            </thead>
            <tbody>
                ${entries.map(([namespace, gpus]) => `
                    <tr>
                        <td>${namespace}</td>
                        <td class="text-end"><span class="badge bg-primary">${gpus}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHtml;
}

function updateNodeGpuTable(nodeAllocation) {
    const container = document.getElementById('nodeGpuAllocation');
    if (!container) return;
    
    const entries = Object.entries(nodeAllocation);
    if (entries.length === 0) {
        container.innerHTML = '<div class="text-muted">No GPU allocations found</div>';
        return;
    }
    
    const tableHtml = `
        <table class="table table-sm">
            <thead>
                <tr>
                    <th>Node</th>
                    <th class="text-end">GPUs</th>
                </tr>
            </thead>
            <tbody>
                ${entries.map(([node, gpus]) => `
                    <tr>
                        <td>${node}</td>
                        <td class="text-end"><span class="badge bg-success">${gpus}</span></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHtml;
} 