// namespaces_view.js

window.namespacesData = []; // Store fetched namespace data for filtering/sorting

// Initialize event listeners for the Namespaces tab (jQuery based)
$(document).ready(function() {
    // Load namespaces when the tab is shown
    $('a[data-bs-toggle="tab"][data-bs-target="#namespaces"]').on('shown.bs.tab', function (e) {
        loadNamespacesViewData(); // Renamed to avoid conflict
    });

    // Refresh button
    $('#refreshNamespaces').on('click', function() {
        loadNamespacesViewData();
    });

    // Filter input
    $('#namespaceSearchInput').on('keyup', function() {
        filterNamespacesView(); // Renamed
    });

    // Sort options
    $('.sort-option').on('click', function(e) {
        e.preventDefault();
        const sortBy = $(this).data('sort');
        sortNamespacesView(sortBy); // Renamed
    });

    // Namespace action buttons (using event delegation)
    $(document).on('click', '.namespace-action', function() {
        const action = $(this).data('action');
        const namespace = $(this).data('namespace');
        handleNamespaceAction(namespace, action);
    });

    // Save changes button in modal
    $('#saveNamespaceChanges').on('click', function() {
        saveNamespaceChanges();
    });

    // Delete confirmation input
    $('#namespaceDeleteConfirm').on('input', function() {
        const namespaceName = $('#currentNamespaceName').text();
        $('#confirmNamespaceDelete').prop('disabled', $(this).val() !== namespaceName);
    });
    
    // Confirm delete button
    $('#confirmNamespaceDelete').on('click', function() {
        deleteNamespace();
    });

    // New Namespace button
    $('#newNamespaceBtn').on('click', function() {
        openNewNamespaceModal();
    });

    // Create namespace button
    $('#createNamespaceBtn').on('click', function() {
        createNamespace();
    });

    // Namespace name input - update metadata name label
    $('#namespaceName').on('input', function() {
        const namespaceName = $(this).val();
        const metadataValue = namespaceName || '<namespace name>';
        $('#metadataNameValue').text(metadataValue);
    });

    // Add custom label button
    $('#addCustomLabel').on('click', function() {
        addCustomLabelRow();
    });

    // Handle removal of custom labels (event delegation)
    $(document).on('click', '.remove-custom-label', function() {
        $(this).closest('.custom-label-row').remove();
    });

    // Modal tab switching (to show/hide save button)
    $('#namespaceDetailTabs button').on('shown.bs.tab', function (e) {
        const isEditTab = $(e.target).attr('id') === 'edit-tab';
        $('#saveNamespaceChanges').toggle(isEditTab);
    });
    
     // Initial load if the tab is already active
    if ($('#namespaces').hasClass('active')) {
        loadNamespacesViewData();
    }
});

// Load detailed namespaces data for the dedicated view
function loadNamespacesViewData() {
    $('#namespacesLoading').show();
    $('#namespacesTableCard').hide();
    $('#noNamespacesMessage').hide();

    const url = window.app.getRelativeUrl('/get_namespace_details');
    $.ajax({
        url: url,
        type: 'GET',
        success: function(response) {
            if (response && Array.isArray(response.namespaces)) {
                window.namespacesData = response.namespaces;
                renderNamespacesView(window.namespacesData);
            } else {
                console.error("Invalid data received for namespace details:", response);
                showNoNamespacesView('Error loading namespaces: Invalid data format');
            }
        },
        error: function(xhr, status, error) {
             console.error('Failed to fetch namespace details:', status, error);
            showNoNamespacesView('Failed to fetch namespaces data');
        },
        complete: function() {
            $('#namespacesLoading').hide();
        }
    });
}

// Render the namespaces table in the dedicated view
function renderNamespacesView(namespaces) {
    const tableBody = $('#namespacesTableBody');
    tableBody.empty();

    if (!namespaces || namespaces.length === 0) {
        showNoNamespacesView();
        return;
    }

    namespaces.forEach(function(ns) {
        const status = getNamespaceStatus(ns); // Assuming getNamespaceStatus is available
        const creationTime = getNamespaceCreationTime(ns);
        const resources = ns.resources || { cpu: '-', gpu: '-', memory: '-' }; // Default if missing
        const podCount = ns.podCount !== undefined ? ns.podCount : '-';
        
        const row = `
            <tr>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="avatar-sm rounded bg-secondary me-3">
                             <span class="avatar-title rounded fs-5">
                                 <i class="fas fa-folder text-white"></i>
                             </span>
                        </div>
                        <div>
                            <h6 class="mb-0">${ns.name}</h6>
                            <small class="text-muted">${creationTime}</small>
                        </div>
                    </div>
                </td>
                <td class="text-center"><span class="fw-bold">${podCount}</span></td>
                <td class="text-center resource-cell cpu-cell">
                     <span class="fw-bold">${resources.cpu}</span> vCPUs
                 </td>
                <td class="text-center resource-cell gpu-cell">
                    <span class="fw-bold">${resources.gpu}</span> GPUs
                </td>
                <td class="text-center resource-cell memory-cell">
                    <span class="fw-bold">${resources.memory}</span> MB
                 </td>
                <td class="text-center"><span class="badge bg-${status.color}">${status.text}</span></td>
                <td class="text-center">
                    <div class="dropdown action-dropdown">
                        <button class="btn btn-sm dropdown-toggle" type="button" id="ns-dd-${ns.name}" data-bs-toggle="dropdown" aria-expanded="false">
                             <i class="fas fa-ellipsis-v"></i>
                         </button>
                        <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="ns-dd-${ns.name}">
                            <li><a class="dropdown-item namespace-action" href="#" data-action="events" data-namespace="${ns.name}"><i class="fas fa-list-alt text-info me-2"></i>Events</a></li>
                            <li><a class="dropdown-item namespace-action" href="#" data-action="describe" data-namespace="${ns.name}"><i class="fas fa-info-circle text-primary me-2"></i>Describe</a></li>
                            <li><a class="dropdown-item namespace-action" href="#" data-action="edit" data-namespace="${ns.name}"><i class="fas fa-edit text-warning me-2"></i>Edit YAML</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item namespace-action" href="#" data-action="delete" data-namespace="${ns.name}"><i class="fas fa-trash-alt text-danger me-2"></i>Delete</a></li>
                        </ul>
                    </div>
                </td>
            </tr>
        `;
        tableBody.append(row);
    });

    $('#namespacesTableCard').show();
    $('#noNamespacesMessage').hide();
    
    // Reinitialize dropdowns for the newly added rows
    initializeNamespaceDropdowns();
}

// Filter namespaces in the dedicated view
function filterNamespacesView() {
    const searchTerm = $('#namespaceSearchInput').val().toLowerCase();
    if (!window.namespacesData) return;
    const filtered = window.namespacesData.filter(ns => ns.name.toLowerCase().includes(searchTerm));
    renderNamespacesView(filtered);
}

// Sort namespaces in the dedicated view
function sortNamespacesView(sortBy) {
    if (!window.namespacesData) return;
    const sorted = [...window.namespacesData]; // Create a copy
    
    sorted.sort((a, b) => {
        let valA, valB;
        switch (sortBy) {
            case 'name': valA = a.name; valB = b.name; break;
            case 'name-desc': valA = b.name; valB = a.name; break; // Reversed for desc
            case 'pods': valA = b.podCount || 0; valB = a.podCount || 0; break; // Descending pod count
            case 'cpu': valA = b.resources?.cpu || 0; valB = a.resources?.cpu || 0; break;
            case 'gpu': valA = b.resources?.gpu || 0; valB = a.resources?.gpu || 0; break;
            case 'memory': valA = b.resources?.memory || 0; valB = a.resources?.memory || 0; break;
            default: return 0;
        }
        
        if (typeof valA === 'string') return valA.localeCompare(valB);
        return valA - valB; // Numeric comparison (handles descending for pods/resources)
    });
    
    renderNamespacesView(sorted);
}

// Show message when no namespaces are found in the dedicated view
function showNoNamespacesView(message = 'No namespaces found') {
    $('#namespacesTableCard').hide();
    $('#noNamespacesMessage').show().find('h5').text(message);
}

// Get formatted creation time for a namespace
function getNamespaceCreationTime(namespace) {
    if (namespace.metadata?.creationTimestamp) {
        try {
            return `Created ${new Date(namespace.metadata.creationTimestamp).toLocaleDateString()}`;
        } catch (e) { return 'Invalid date'; }
    }
    return 'Creation time unknown';
}

// Get status text and color for a namespace
function getNamespaceStatus(namespace) {
    const phase = namespace.status?.phase || 'Active'; // Default to Active if unknown
    switch (phase) {
        case 'Active': return { text: 'Active', color: 'success' };
        case 'Terminating': return { text: 'Terminating', color: 'warning' };
        default: return { text: phase, color: 'secondary' };
    }
}

// Handles actions triggered from the namespace table (Events, Describe, Edit, Delete)
function handleNamespaceAction(namespace, action) {
    console.log(`Namespace action: ${action} for ${namespace}`);
    const modal = new bootstrap.Modal(document.getElementById('namespaceEditModal'));
    
    $('#currentNamespaceName').text(namespace);
    $('#deleteNamespaceConfirmName').text(namespace); // For delete confirmation placeholder
    $('#namespaceDeleteConfirm').val(''); // Clear delete input
    $('#confirmNamespaceDelete').prop('disabled', true); // Disable delete button initially

    // Reset modal content areas and show loading indicators
    $('#namespaceEventsOutput, #namespaceDescribeOutput, #namespaceEditContent').hide();
    $('#namespaceEventsLoading, #namespaceDescribeLoading, #namespaceEditLoading').show();
    $('#saveNamespaceChanges').hide(); // Hide save button initially

    // Activate the target tab and load data
    const targetTab = $(`#${action}-tab`);
    if (targetTab.length) {
        targetTab.tab('show');
        modal.show();
        
        // Load data for all tabs in the background
        if (typeof loadNamespaceEvents === 'function') loadNamespaceEvents(namespace);
        if (typeof loadNamespaceDescribe === 'function') loadNamespaceDescribe(namespace);
        if (typeof loadNamespaceEditData === 'function') loadNamespaceEditData(namespace);
    } else {
        console.error(`Tab for action ${action} not found.`);
    }
}

// Load events for the namespace modal
function loadNamespaceEvents(namespace) {
    const url = window.app.getRelativeUrl('/api/namespace/events');
    $.ajax({
        url: url, type: 'POST', data: { namespace: namespace },
        success: res => $('#namespaceEventsOutput').text(res.output || `Error: ${res.error}`).show(),
        error: () => $('#namespaceEventsOutput').text('Failed to fetch events.').show(),
        complete: () => $('#namespaceEventsLoading').hide()
    });
}

// Load description for the namespace modal
function loadNamespaceDescribe(namespace) {
    const url = window.app.getRelativeUrl('/api/namespace/describe');
     $.ajax({
        url: url, type: 'POST', data: { namespace: namespace },
        success: res => $('#namespaceDescribeOutput').text(res.output || `Error: ${res.error}`).show(),
        error: () => $('#namespaceDescribeOutput').text('Failed to fetch description.').show(),
        complete: () => $('#namespaceDescribeLoading').hide()
    });
}

// Load YAML content for the namespace modal editor
function loadNamespaceEditData(namespace) {
    const url = window.app.getRelativeUrl('/api/namespace/edit');
    $.ajax({
        url: url, type: 'POST', data: { namespace: namespace },
        success: res => {
            $('#namespaceYamlEditor').val(res.yaml || `Error: ${res.error}`);
            $('#namespaceEditContent').show();
        },
        error: () => {
             $('#namespaceYamlEditor').val('Failed to fetch YAML.');
             $('#namespaceEditContent').show();
        },
        complete: () => $('#namespaceEditLoading').hide()
    });
}

// Save YAML changes for the namespace
function saveNamespaceChanges() {
    const namespace = $('#currentNamespaceName').text();
    const yaml = $('#namespaceYamlEditor').val();
    
    $('#saveNamespaceChanges').prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Saving...');
    $('#namespaceEditLoading').show(); // Show loading overlay

    const url = window.app.getRelativeUrl('/api/namespace/update');
    $.ajax({
        url: url, type: 'POST', data: { namespace: namespace, yaml: yaml },
        success: function(response) {
            if (response.output) {
                Swal.fire('Success', 'Namespace updated successfully.', 'success');
                // Refresh data in modal and main view
                loadNamespaceEditData(namespace);
                loadNamespaceDescribe(namespace);
                loadNamespacesViewData(); 
            } else {
                Swal.fire('Error', response.error || 'Unknown error updating namespace.', 'error');
            }
        },
        error: function(xhr) {
             Swal.fire('Error', `Failed to update namespace: ${xhr.responseJSON?.error || xhr.statusText}`, 'error');
        },
        complete: function() {
            $('#saveNamespaceChanges').prop('disabled', false).html('Save Changes');
            $('#namespaceEditLoading').hide();
        }
    });
}

// Delete the currently selected namespace
function deleteNamespace() {
    const namespace = $('#currentNamespaceName').text();
    
    // Double-check confirmation (already done by input enabling button, but good practice)
    if ($('#namespaceDeleteConfirm').val() !== namespace) {
        Swal.fire('Incorrect Input', 'Please type the namespace name correctly to confirm deletion.', 'warning');
        return;
    }
    
    $('#confirmNamespaceDelete').prop('disabled', true).html('<span class="spinner-border spinner-border-sm"></span> Deleting...');

    const url = window.app.getRelativeUrl('/api/namespace/delete');
    $.ajax({
        url: url, type: 'POST', data: { namespace: namespace },
        success: function(response) {
            if (response.output || response.success) {
                Swal.fire('Deleted!', `Namespace "${namespace}" deleted.`, 'success');
                $('#namespaceEditModal').modal('hide');
                loadNamespacesViewData(); // Refresh the main list
            } else {
                Swal.fire('Error', response.error || 'Unknown error deleting namespace.', 'error');
                 $('#confirmNamespaceDelete').prop('disabled', false).html('<i class="fas fa-trash-alt me-2"></i> Confirm Delete');
            }
        },
        error: function(xhr) {
            console.error("Error deleting namespace:", xhr.responseText);
            alert("Error deleting namespace: " + xhr.responseText);
        }
    });
}

// New Namespace Functions

function openNewNamespaceModal() {
    // Reset the form
    $('#newNamespaceForm')[0].reset();
    
    // Reset metadata name value
    $('#metadataNameValue').text('<namespace name>');
    
    // Clear any custom labels
    $('#customLabelsContainer').empty();
    
    // Reset all default labels to checked
    $('.form-check-pill input[type="checkbox"]:not(#label-metadata-name)').prop('checked', true);
    
    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('newNamespaceModal'));
    modal.show();
}

function addCustomLabelRow() {
    const customLabelsContainer = $('#customLabelsContainer');
    const rowId = 'custom-label-' + Date.now();
    
    const labelRow = $(`
        <div class="custom-label-row" id="${rowId}">
            <input type="text" class="form-control" placeholder="Label key (e.g., environment)" name="customLabelKey">
            <input type="text" class="form-control" placeholder="Label value (e.g., production)" name="customLabelValue">
            <button type="button" class="btn btn-outline-danger btn-sm remove-custom-label">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `);
    
    customLabelsContainer.append(labelRow);
}

function validateNamespaceName(name) {
    // DNS-1123 label validation
    const dnsLabelRegex = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
    
    if (!name) {
        return { valid: false, message: "Namespace name is required" };
    }
    
    if (name.length > 63) {
        return { valid: false, message: "Namespace name must be 63 characters or less" };
    }
    
    if (!dnsLabelRegex.test(name)) {
        return { valid: false, message: "Namespace name must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen" };
    }
    
    return { valid: true };
}

function createNamespace() {
    const namespaceName = $('#namespaceName').val().trim();
    const namespaceDescription = $('#namespaceDescription').val().trim();
    
    // Validate namespace name
    const validation = validateNamespaceName(namespaceName);
    if (!validation.valid) {
        alert(validation.message);
        $('#namespaceName').focus();
        return;
    }
    
    // Collect selected default labels
    const defaultLabels = {};
    
    // Always include metadata name
    defaultLabels['kubernetes.io/metadata.name'] = namespaceName;
    
    // Check which default labels are selected
    const labelMappings = {
        'label-part-of': { key: 'app.kubernetes.io/part-of', value: 'kubeflow-profile' },
        'label-ezmodels': { key: 'hpe-ezua/ezmodels', value: 'true' },
        'label-cluster': { key: 'hpe.com/cluster', value: 'none' },
        'label-istio': { key: 'istio-injection', value: 'enabled' },
        'label-katib': { key: 'katib.kubeflow.org/metrics-collector-injection', value: 'enabled' },
        'label-pipelines': { key: 'pipelines.kubeflow.org/enabled', value: 'true' },
        'label-serving': { key: 'serving.kubeflow.org/inferenceservice', value: 'enabled' }
    };
    
    Object.keys(labelMappings).forEach(checkboxId => {
        if ($('#' + checkboxId).is(':checked')) {
            const mapping = labelMappings[checkboxId];
            defaultLabels[mapping.key] = mapping.value;
        }
    });
    
    // Collect custom labels
    const customLabels = {};
    $('.custom-label-row').each(function() {
        const key = $(this).find('input[name="customLabelKey"]').val().trim();
        const value = $(this).find('input[name="customLabelValue"]').val().trim();
        
        if (key && value) {
            customLabels[key] = value;
        }
    });
    
    // Combine all labels
    const allLabels = { ...defaultLabels, ...customLabels };
    
    // Add description as annotation if provided
    const annotations = {};
    if (namespaceDescription) {
        annotations['description'] = namespaceDescription;
    }
    
    // Prepare the namespace YAML
    const namespaceYaml = `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespaceName}
  labels:
${Object.entries(allLabels).map(([key, value]) => `    ${key}: "${value}"`).join('\n')}
${Object.keys(annotations).length > 0 ? `  annotations:
${Object.entries(annotations).map(([key, value]) => `    ${key}: "${value}"`).join('\n')}` : ''}`;
    
    // Show loading state
    $('#newNamespaceModal').addClass('creating-namespace');
    $('#createNamespaceBtn').html('<i class="fas fa-spinner fa-spin me-1"></i>Creating...');
    
    // Send the request to create the namespace
    $.ajax({
        url: '/api/namespace/create',
        type: 'POST',
        data: {
            yaml: namespaceYaml,
            name: namespaceName
        },
        success: function(response) {
            if (response.error) {
                alert('Error creating namespace: ' + response.error);
                return;
            }
            
            // Success - close modal and refresh namespaces list
            const modal = bootstrap.Modal.getInstance(document.getElementById('newNamespaceModal'));
            modal.hide();
            
            // Show success message
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Namespace Created!',
                    text: `Namespace "${namespaceName}" has been created successfully.`,
                    timer: 3000,
                    showConfirmButton: false
                });
            } else {
                alert(`Namespace "${namespaceName}" has been created successfully.`);
            }
            
            // Refresh the namespaces list
            loadNamespacesViewData();
        },
        error: function(xhr, status, error) {
            console.error('Error creating namespace:', xhr.responseText);
            alert('Error creating namespace: ' + (xhr.responseJSON?.error || error));
        },
        complete: function() {
            // Reset loading state
            $('#newNamespaceModal').removeClass('creating-namespace');
            $('#createNamespaceBtn').html('<i class="fas fa-plus me-1"></i>Create Namespace');
        }
    });
}

// Initialize Bootstrap dropdowns specifically for the namespaces table
function initializeNamespaceDropdowns() {
     var dropdownElementList = [].slice.call(document.querySelectorAll('#namespacesTableCard .action-dropdown .dropdown-toggle'));
     dropdownElementList.map(function (dropdownToggleEl) {
         // Get or create a new instance
         var instance = bootstrap.Dropdown.getInstance(dropdownToggleEl);
         if (!instance) {
             return new bootstrap.Dropdown(dropdownToggleEl);
         }
         return instance; 
     });
}

// Separate initialization for jQuery-dependent namespace functions
function initializeNamespaceFunctionality() {
    console.log('Initializing namespace tab jQuery functionality');
    // The event listeners are already set up in $(document).ready block above
    // We just need to ensure this function exists to be called by app_init.js
} 