/**
 * Refreshes the list of Helm charts from the ChartMuseum API.
 * Handles potential port-forwarding delays and retries.
 */
function refreshCharts(retryCount = 0) {
    const MAX_RETRIES = 2;
    const loadingContainer = document.getElementById('chartsLoading');
    const progressBar = document.getElementById('chartsProgressBar');
    const warning = document.getElementById('chartsWarning');
    const tableBody = document.querySelector('#chartsTable tbody'); // More specific selector

    if (!loadingContainer || !progressBar || !warning || !tableBody) {
        console.error('Required elements for chart refresh not found.');
        return;
    }

    loadingContainer.style.display = 'block';
    warning.style.display = 'none';
    progressBar.style.width = '10%'; // Initial progress
    tableBody.innerHTML = ''; // Clear previous results

    const url = window.app.getRelativeUrl('/api/charts/list');
    fetch(url)
        .then(response => response.json())
        .then(data => {
            progressBar.style.width = '75%'; // Indicate processing
            if (!data.success) {
                // Handle port forwarding retry logic
                if (data.error && data.error.includes('Port forwarding') && retryCount < MAX_RETRIES) {
                    Swal.fire({
                        title: 'Setting up connection...',
                        html: `Attempting to connect to ChartMuseum (Attempt ${retryCount + 1} of ${MAX_RETRIES + 1})`,
                        timer: 3000,
                        timerProgressBar: true,
                        didOpen: () => { Swal.showLoading(); }
                    }).then(() => {
                        console.log(`Retrying chart refresh after port forwarding attempt ${retryCount + 1}...`);
                        refreshCharts(retryCount + 1);
                    });
                    return; // Stop processing this response, wait for retry
                } else if (retryCount >= MAX_RETRIES) {
                    Swal.fire('Connection Failed', 'Failed to connect to ChartMuseum after multiple attempts.', 'error');
                }
                warning.textContent = data.error || 'Failed to list charts.';
                warning.style.display = 'block';
                progressBar.classList.add('bg-danger');
            } else {
                // Populate table
                if (data.charts && Object.keys(data.charts).length > 0) {
                    Object.entries(data.charts).forEach(([chartName, versions]) => {
                        versions.forEach(version => {
                            const row = tableBody.insertRow();
                            row.innerHTML = `
                                <td>${chartName}</td>
                                <td>${version.version}</td>
                                <td>${version.description || 'N/A'}</td>
                                <td>${new Date(version.created).toLocaleString()}</td>
                                <td>${version.appVersion || 'N/A'}</td>
                                <td class="text-center">
                                    <button class="btn btn-sm btn-danger" title="Delete Chart Version" onclick="deleteChart('${chartName}', '${version.version}')">
                                        <i class="fas fa-trash"></i>
                                    </button>
                                </td>
                            `;
                        });
                    });
                } else {
                    tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No charts found in the library.</td></tr>';
                }
                progressBar.classList.remove('bg-danger');
            }
            progressBar.style.width = '100%';
        })
        .catch(error => {
            console.error('Error fetching charts:', error);
            Swal.fire('Error', 'Failed to fetch charts. Please try again.', 'error');
            warning.textContent = `Failed to fetch charts: ${error.message}`;
            warning.style.display = 'block';
            progressBar.style.width = '100%';
            progressBar.classList.add('bg-danger');
        })
        .finally(() => {
            setTimeout(() => {
                loadingContainer.style.display = 'none';
            }, 500);
        });
}

/**
 * Initiates the deletion process for a specific chart version or all versions of a chart.
 */
function deleteChart(chartName, version) {
    Swal.fire({
        title: 'Delete Chart?',
        html: version
            ? `Delete version <strong>${version}</strong> of chart <strong>${chartName}</strong>?`
            : `Delete <strong>all versions</strong> of chart <strong>${chartName}</strong>?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Yes, delete it!',
        reverseButtons: true
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({ title: 'Deleting...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

            const formData = new FormData();
            formData.append('chart_name', chartName);
            if (version) {
                formData.append('version', version);
            }

            const url = window.app.getRelativeUrl('/api/charts/delete');
            fetch(url, { method: 'POST', body: formData })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        Swal.fire('Deleted!', data.message || 'Chart deleted.', 'success');
                        refreshCharts(); // Refresh the list after deletion
                    } else {
                        Swal.fire('Error!', data.error || 'Failed to delete chart', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error deleting chart:', error);
                    Swal.fire('Error!', 'Request failed during chart deletion.', 'error');
                });
        }
    });
}

// Initialize charts functionality when the tab is shown
document.addEventListener('DOMContentLoaded', function() {
    const chartsTab = document.querySelector('a[data-bs-target="#charts"]');
    if (chartsTab) {
        chartsTab.addEventListener('shown.bs.tab', function (e) {
            console.log('Charts tab shown, refreshing charts...');
            refreshCharts();
        });
        // Also load if the tab is active on initial page load
        if (chartsTab.classList.contains('active')) {
             refreshCharts();
        }
    }
}); 