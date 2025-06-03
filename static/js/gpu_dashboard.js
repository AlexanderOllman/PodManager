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
                    <button class="btn btn-sm btn-outline-secondary" onclick="viewPodDetails('${pod.namespace}', '${pod.name}')" title="View More">
                        <i class="fas fa-ellipsis-h"></i>
                    </button>
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
    window.location.href = window.app.getRelativeUrl(`/explore/${namespace}/${name}`);
    // alert(`Implement view details for ${namespace}/${name}`);
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