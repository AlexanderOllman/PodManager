// settings.js

// Checks git availability on the server and updates the UI accordingly
function checkGitAvailability() {
    const githubSettings = document.getElementById('githubSettings');
    if (!githubSettings) return; // Only run if the settings section exists

    const url = window.app.getRelativeUrl('/git_status');
    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (!data.available) {
                githubSettings.innerHTML = `
                    <div class="alert alert-warning">
                        <strong>Git functionality is not available.</strong> 
                        <p>The "Update from GitHub" feature requires git to be installed on the server. 
                        Please install git or contact your administrator if you need this feature.</p>
                    </div>
                `;
            } else {
                // Optionally, show a confirmation that git is available or enable features
                console.log("Git is available on the server.");
            }
        })
        .catch(error => {
            console.error('Error checking git status:', error);
            githubSettings.innerHTML = `
                <div class="alert alert-danger">
                    Could not check Git status. Refresh functionality may be affected.
                </div>
            `;
        });
}

// Initiates the application refresh process from the settings page
function refreshApplication() {
    const refreshLog = document.getElementById('refreshLog');
    const statusDiv = document.getElementById('updateStatus');
    const logContainer = document.getElementById('refreshLogContainer');

    if (!refreshLog || !statusDiv || !logContainer) {
        console.error('Required UI elements for application refresh not found.');
        Swal.fire('UI Error', 'Could not find necessary elements to display refresh progress.', 'error');
        return;
    }

    logContainer.style.display = 'block';
    statusDiv.style.display = 'block';
    refreshLog.innerHTML = ''; // Clear previous logs

    if (typeof logMessage === 'function') logMessage(refreshLog, 'Starting refresh process...', 'info');
    else console.log('Starting refresh process...');
    
    statusDiv.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Refreshing application... Please wait.</div>';

    const url = window.app.getRelativeUrl('/refresh_application');
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: undefined }) // Backend uses default/env var
    })
    .then(response => {
        if (response.ok) {
            // If server responds with OK, it might mean refresh is handled async via sockets
            // or it completed very quickly without restart. Check response JSON.
            return response.json().then(data => {
                 if (data && data.status === 'success' && data.message && data.message.includes('restart')) {
                     if (typeof logMessage === 'function') logMessage(refreshLog, 'Refresh successful, application restart initiated.', 'success');
                     else console.log('Refresh successful, application restart initiated.');
                     statusDiv.innerHTML = '<div class="alert alert-info">Application is restarting... Waiting for it to come back online.</div>';
                     waitForApplicationRestart(statusDiv, refreshLog);
                 } else if (data && data.status === 'success'){
                    if (typeof logMessage === 'function') logMessage(refreshLog, data.message || 'Refresh completed successfully.', 'success');
                    else console.log(data.message || 'Refresh completed successfully.');
                     statusDiv.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle"></i> ${data.message || 'Refresh complete.'}</div>`;
                 } else {
                     // Handle cases where response is ok but operation didn't trigger restart as expected
                     const msg = data?.error || data?.message || 'Refresh finished with unexpected status.';
                     if (typeof logMessage === 'function') logMessage(refreshLog, msg, data?.error ? 'error' : 'warning');
                     else console.warn(msg);
                     statusDiv.innerHTML = `<div class="alert ${data?.error ? 'alert-danger' : 'alert-warning'}">${msg}</div>`;
                 }
            });
        } else {
            // Non-ok response often means restart is happening (e.g., 502 during restart)
             if (typeof logMessage === 'function') logMessage(refreshLog, 'Application restart likely initiated (server unresponsive). Waiting...', 'info');
             else console.log('Application restart likely initiated (server unresponsive). Waiting...');
             statusDiv.innerHTML = '<div class="alert alert-info">Application is restarting. Waiting for it to come back online...</div>';
             waitForApplicationRestart(statusDiv, refreshLog);
             // Throw a specific error or return a specific value to stop the promise chain here if needed
             throw new Error('restart_likely_in_progress'); 
        }
    })
    .catch(error => {
        if (error.message !== 'restart_likely_in_progress') {
            console.error('Error during application refresh request:', error);
             if (typeof logMessage === 'function') logMessage(refreshLog, `Error: ${error.message}`, 'error');
             else console.error(`Error: ${error.message}`);
             statusDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> Error: ${error.message}</div>`;
        }
    });
}

// Polls the server to detect when the application has restarted successfully
function waitForApplicationRestart(statusDiv, refreshLog = null) {
    const MAX_ATTEMPTS = 45; // Try for up to ~45 seconds
    let attempts = 0;

    if (statusDiv) {
        statusDiv.innerHTML = `
            <div class="alert alert-info">
                <div class="d-flex align-items-center">
                    <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                    Waiting for application to restart...
                </div>
                <div class="progress mt-2" style="height: 5px;">
                    <div class="progress-bar progress-bar-striped progress-bar-animated" 
                         role="progressbar" style="width: 0%"></div>
                </div>
            </div>
        `;
    }
    if (refreshLog && typeof logMessage === 'function') {
        logMessage(refreshLog, "Waiting for application to come back online...", "info");
    } else {
        console.log("Waiting for application to come back online...");
    }

    const checkServer = function() {
        attempts++;
        if (statusDiv) {
            const progressBar = statusDiv.querySelector('.progress-bar');
            if (progressBar) progressBar.style.width = `${Math.min((attempts / MAX_ATTEMPTS) * 100, 100)}%`;
        }

        const healthCheckUrl = window.app.getRelativeUrl('/health_check');
        fetch(healthCheckUrl, { 
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } 
        })
        .then(response => {
            if (response.ok) {
                // Server is back!
                if (statusDiv) {
                    statusDiv.innerHTML = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Application restarted successfully! Reloading page...</div>';
                }
                if (refreshLog && typeof logMessage === 'function') {
                    logMessage(refreshLog, "Application back online! Reloading page in 3 seconds...", "success");
                } else {
                     console.log("Application back online! Reloading page in 3 seconds...");
                }
                setTimeout(() => window.location.reload(), 3000);
            } else {
                 // Server responded but not OK (might still be starting)
                if (attempts < MAX_ATTEMPTS) {
                    setTimeout(checkServer, 1000);
                } else {
                    handleRestartTimeout(statusDiv, refreshLog);
                }
            }
        })
        .catch(error => {
            // Network error likely means server is still down
            if (attempts < MAX_ATTEMPTS) {
                setTimeout(checkServer, 1000);
            } else {
                handleRestartTimeout(statusDiv, refreshLog);
            }
        });
    };

    // Start polling after a brief delay
    setTimeout(checkServer, 2000);
}

// Handles the case where the application restart times out
function handleRestartTimeout(statusDiv, refreshLog) {
    const timeoutMessage = "Application restart took longer than expected. Please refresh the page manually.";
    if (statusDiv) {
        statusDiv.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i> ${timeoutMessage}
                <button class="btn btn-sm btn-primary mt-2 ms-2" onclick="window.location.reload()">Refresh Now</button>
            </div>
        `;
    }
    if (refreshLog && typeof logMessage === 'function') {
        logMessage(refreshLog, timeoutMessage, "warning");
    } else {
        console.warn(timeoutMessage);
    }
}

// Clears the refresh log in the settings UI
function clearRefreshLog() {
    const refreshLog = document.getElementById('refreshLog');
    if (refreshLog) {
        refreshLog.innerHTML = '<div class="text-muted fst-italic">-- Log appears here during refresh --</div>';
    }
}

// ============================================================================
// MODAL-BASED UPDATE FUNCTIONALITY
// ============================================================================

// Shows the update modal and starts the update process
function showUpdateModal() {
    const modal = document.getElementById('updateModal');
    if (!modal) {
        console.error('Update modal not found');
        Swal.fire('Error', 'Update interface not available. Please try refreshing the page.', 'error');
        return;
    }
    
    // Reset modal state
    resetUpdateModal();
    
    // Show the modal
    const bootstrapModal = new bootstrap.Modal(modal, {
        backdrop: 'static',
        keyboard: false
    });
    bootstrapModal.show();
    
    // Start the update process after a brief delay
    setTimeout(() => {
        startApplicationUpdate();
    }, 1000);
}

// Resets the update modal to initial state
function resetUpdateModal() {
    // Reset progress bar
    const progressFill = document.getElementById('updateProgressFill');
    const progressText = document.getElementById('updateProgressText');
    const progressDetails = document.getElementById('updateProgressDetails');
    
    if (progressFill) {
        progressFill.style.width = '0%';
        progressFill.classList.add('indeterminate');
    }
    if (progressText) progressText.textContent = 'Initializing update process...';
    if (progressDetails) progressDetails.textContent = 'Please wait while we prepare the update...';
    
    // Reset all steps to pending
    const steps = ['preparing', 'stopping', 'pulling', 'installing', 'restarting'];
    steps.forEach(step => {
        const stepElement = document.getElementById(`step-${step}`);
        const iconElement = document.getElementById(`step-${step}-icon`);
        
        if (stepElement) {
            stepElement.classList.remove('active', 'completed');
        }
        if (iconElement) {
            iconElement.classList.remove('active', 'completed');
            iconElement.classList.add('pending');
        }
    });
    
    // Reset status indicator
    const statusIndicator = document.getElementById('updateStatusIndicator');
    const statusText = document.getElementById('updateStatusText');
    if (statusIndicator) {
        statusIndicator.className = 'update-status-indicator running';
    }
    if (statusText) statusText.textContent = 'Update in progress...';
    
    // Reset CLI output
    const cliContent = document.getElementById('cliOutputContent');
    if (cliContent) cliContent.textContent = 'Starting update process...';
}

// Starts the application update process with modal progress
function startApplicationUpdate() {
    updateProgress(10, 'Connecting to server...', 'Establishing connection for update process');
    updateStep('preparing', 'active');
    appendCliOutput('[INFO] Starting application update process...');
    
    const url = window.app.getRelativeUrl('/refresh_application');
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo_url: undefined })
    })
    .then(response => {
        updateProgress(25, 'Server response received...', 'Processing update request');
        updateStep('preparing', 'completed');
        updateStep('stopping', 'active');
        appendCliOutput('[INFO] Update request sent to server');
        
        if (response.ok) {
            return response.json().then(data => {
                if (data && data.status === 'success' && data.message && data.message.includes('restart')) {
                    appendCliOutput('[SUCCESS] Server confirmed restart initiation');
                    updateProgress(50, 'Application stopping...', 'Gracefully shutting down services');
                    updateStep('stopping', 'completed');
                    updateStep('pulling', 'active');
                    waitForApplicationRestartModal();
                } else if (data && data.status === 'success') {
                    appendCliOutput(`[SUCCESS] ${data.message || 'Update completed successfully'}`);
                    updateProgress(100, 'Update completed', 'Application updated successfully');
                    updateAllStepsCompleted();
                    showUpdateSuccess();
                } else {
                    const msg = data?.error || data?.message || 'Update finished with unexpected status';
                    appendCliOutput(`[WARNING] ${msg}`);
                    showUpdateError(msg);
                }
            });
        } else {
            appendCliOutput('[INFO] Server became unresponsive (restart likely initiated)');
            updateProgress(50, 'Application restarting...', 'Server is restarting with latest code');
            updateStep('stopping', 'completed');
            updateStep('pulling', 'active');
            waitForApplicationRestartModal();
        }
    })
    .catch(error => {
        if (error.message.includes('restart_likely_in_progress')) {
            appendCliOutput('[INFO] Application restart detected');
            waitForApplicationRestartModal();
        } else {
            appendCliOutput(`[ERROR] ${error.message}`);
            showUpdateError(error.message);
        }
    });
}

// Updates the progress bar and text
function updateProgress(percentage, text, details) {
    const progressFill = document.getElementById('updateProgressFill');
    const progressText = document.getElementById('updateProgressText');
    const progressDetails = document.getElementById('updateProgressDetails');
    
    if (progressFill) {
        progressFill.style.width = `${percentage}%`;
        if (percentage > 0) {
            progressFill.classList.remove('indeterminate');
        }
    }
    if (progressText) progressText.textContent = text;
    if (progressDetails) progressDetails.textContent = details;
}

// Updates a specific step state
function updateStep(stepName, state) {
    const stepElement = document.getElementById(`step-${stepName}`);
    const iconElement = document.getElementById(`step-${stepName}-icon`);
    
    if (!stepElement || !iconElement) return;
    
    // Remove all state classes
    stepElement.classList.remove('active', 'completed');
    iconElement.classList.remove('pending', 'active', 'completed');
    
    // Add new state
    stepElement.classList.add(state);
    iconElement.classList.add(state);
    
    // Update icon based on state
    const iconImg = iconElement.querySelector('i');
    if (iconImg) {
        if (state === 'active') {
            iconImg.className = 'fas fa-spinner fa-spin';
        } else if (state === 'completed') {
            iconImg.className = 'fas fa-check';
        }
    }
}

// Marks all steps as completed
function updateAllStepsCompleted() {
    const steps = ['preparing', 'stopping', 'pulling', 'installing', 'restarting'];
    steps.forEach(step => updateStep(step, 'completed'));
}

// Appends text to CLI output
function appendCliOutput(text) {
    const cliContent = document.getElementById('cliOutputContent');
    if (cliContent) {
        const timestamp = new Date().toLocaleTimeString();
        cliContent.innerHTML += `\n[${timestamp}] ${text}`;
        
        // Auto-scroll to bottom if CLI is expanded
        const cliBody = document.getElementById('cliOutputBody');
        if (cliBody && cliBody.classList.contains('expanded')) {
            cliBody.scrollTop = cliBody.scrollHeight;
        }
    }
}

// Toggles CLI output visibility
function toggleCliOutput() {
    const cliBody = document.getElementById('cliOutputBody');
    const toggle = document.getElementById('cliOutputToggle');
    
    if (cliBody && toggle) {
        cliBody.classList.toggle('expanded');
        toggle.classList.toggle('expanded');
        
        // Auto-scroll to bottom when expanding
        if (cliBody.classList.contains('expanded')) {
            setTimeout(() => {
                cliBody.scrollTop = cliBody.scrollHeight;
            }, 300);
        }
    }
}

// Waits for application restart with modal updates
function waitForApplicationRestartModal() {
    const MAX_ATTEMPTS = 45;
    let attempts = 0;
    
    updateProgress(60, 'Pulling latest code...', 'Downloading updates from repository');
    updateStep('pulling', 'completed');
    updateStep('installing', 'active');
    appendCliOutput('[INFO] Waiting for application to come back online...');
    
    const checkServer = function() {
        attempts++;
        const progressPercentage = 60 + (attempts / MAX_ATTEMPTS) * 35; // 60% to 95%
        
        if (attempts < 15) {
            updateProgress(Math.min(progressPercentage, 75), 'Installing dependencies...', `Attempt ${attempts}/${MAX_ATTEMPTS}`);
        } else if (attempts < 30) {
            updateStep('installing', 'completed');
            updateStep('restarting', 'active');
            updateProgress(Math.min(progressPercentage, 90), 'Restarting application...', `Attempt ${attempts}/${MAX_ATTEMPTS}`);
        } else {
            updateProgress(Math.min(progressPercentage, 95), 'Finalizing startup...', `Attempt ${attempts}/${MAX_ATTEMPTS}`);
        }
        
        const healthCheckUrl = window.app.getRelativeUrl('/health_check');
        fetch(healthCheckUrl, { 
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } 
        })
        .then(response => {
            if (response.ok) {
                updateProgress(100, 'Update completed successfully!', 'Application is back online');
                updateAllStepsCompleted();
                appendCliOutput('[SUCCESS] Application back online! Reloading page in 3 seconds...');
                showUpdateSuccess();
                setTimeout(() => window.location.reload(), 3000);
            } else {
                if (attempts < MAX_ATTEMPTS) {
                    setTimeout(checkServer, 1000);
                } else {
                    handleModalRestartTimeout();
                }
            }
        })
        .catch(error => {
            if (attempts < MAX_ATTEMPTS) {
                setTimeout(checkServer, 1000);
            } else {
                handleModalRestartTimeout();
            }
        });
    };
    
    setTimeout(checkServer, 2000);
}

// Handles restart timeout in modal
function handleModalRestartTimeout() {
    appendCliOutput('[WARNING] Application restart took longer than expected');
    showUpdateError('Application restart took longer than expected. Please refresh the page manually.');
}

// Shows update success state
function showUpdateSuccess() {
    const statusIndicator = document.getElementById('updateStatusIndicator');
    const statusText = document.getElementById('updateStatusText');
    
    if (statusIndicator) {
        statusIndicator.className = 'update-status-indicator success';
        statusIndicator.innerHTML = '<i class="fas fa-check-circle"></i><span>Update completed successfully!</span>';
    }
}

// Shows update error state
function showUpdateError(message) {
    const statusIndicator = document.getElementById('updateStatusIndicator');
    const statusText = document.getElementById('updateStatusText');
    
    if (statusIndicator) {
        statusIndicator.className = 'update-status-indicator error';
        statusIndicator.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>Update failed: ${message}</span>`;
    }
    
    appendCliOutput(`[ERROR] Update failed: ${message}`);
}

// ============================================================================
// VERSION MANAGEMENT FUNCTIONALITY
// ============================================================================

// Loads and displays current version information
function loadVersionInfo() {
    const versionBadge = document.getElementById('currentVersionBadge');
    if (!versionBadge) return;
    
    fetch('/api/version')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                versionBadge.textContent = 'Unknown';
                versionBadge.className = 'badge bg-warning';
                console.error('Error loading version:', data.error);
                return;
            }
            
            versionBadge.textContent = `v${data.version}`;
            versionBadge.className = 'badge';
            versionBadge.id = 'currentVersionBadge'; // Ensure the ID is preserved
            
            // Store version data globally for release notes
            window.versionData = data;
        })
        .catch(error => {
            console.error('Error fetching version info:', error);
            versionBadge.textContent = 'Error';
            versionBadge.className = 'badge bg-danger';
        });
}

// Shows the release notes modal
function showReleaseNotes() {
    const modal = document.getElementById('releaseNotesModal');
    if (!modal) {
        console.error('Release notes modal not found');
        return;
    }
    
    const loadingDiv = document.getElementById('releaseNotesLoading');
    const contentDiv = document.getElementById('releaseNotesContent');
    const errorDiv = document.getElementById('releaseNotesError');
    
    // Reset modal state
    if (loadingDiv) loadingDiv.style.display = 'block';
    if (contentDiv) {
        contentDiv.style.display = 'none';
        contentDiv.innerHTML = '';
    }
    if (errorDiv) errorDiv.style.display = 'none';
    
    // Show modal
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    // Load release notes
    loadReleaseNotes();
}

// Loads and renders release notes
function loadReleaseNotes() {
    fetch('/api/version')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showReleaseNotesError('Failed to load version information');
                return;
            }
            
            renderReleaseNotes(data);
        })
        .catch(error => {
            console.error('Error loading release notes:', error);
            showReleaseNotesError('Network error while loading release notes');
        });
}

// Renders the release notes content
function renderReleaseNotes(versionData) {
    const loadingDiv = document.getElementById('releaseNotesLoading');
    const contentDiv = document.getElementById('releaseNotesContent');
    
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (!contentDiv) return;
    
    const releases = versionData.releases || [];
    
    const html = `
        <div class="release-notes-container">
            <!-- Current Version Header -->
            <div class="version-header">
                <div class="version-number">v${versionData.version}</div>
                <div class="version-codename">${versionData.codename}</div>
                <div class="version-date">Build Date: ${versionData.buildDate}</div>
            </div>
            
            <!-- Release History -->
            ${releases.map(release => renderReleaseItem(release)).join('')}
        </div>
    `;
    
    contentDiv.innerHTML = html;
    contentDiv.style.display = 'block';
}

// Renders a single release item
function renderReleaseItem(release) {
    const typeClass = release.type || 'patch';
    const features = release.features || [];
    const bugfixes = release.bugfixes || [];
    const technical = release.technical || [];
    const highlights = release.highlights || [];
    
    return `
        <div class="release-item">
            <div class="release-header">
                <div>
                    <div class="release-version">v${release.version}</div>
                    <div class="release-title">${release.title}</div>
                </div>
                <div class="text-end">
                    <div class="release-type-badge ${typeClass}">${typeClass}</div>
                    <div class="release-date mt-1">${formatReleaseDate(release.date)}</div>
                </div>
            </div>
            
            ${highlights.length > 0 ? `
                <div class="highlights-section">
                    <h6 class="section-title">
                        <i class="fas fa-star"></i>
                        Key Highlights
                    </h6>
                    <ul class="highlights-list">
                        ${highlights.map(highlight => `<li>${highlight}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${features.length > 0 ? `
                <div class="features-section">
                    <h6 class="section-title">
                        <i class="fas fa-plus-circle"></i>
                        New Features
                    </h6>
                    ${features.map(category => `
                        <div class="feature-category">
                            <div class="feature-category-title">${category.category}</div>
                            <ul class="feature-list">
                                ${category.items.map(item => `<li>${item}</li>`).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            ${bugfixes.length > 0 ? `
                <div class="bugfixes-section">
                    <h6 class="section-title">
                        <i class="fas fa-bug"></i>
                        Bug Fixes
                    </h6>
                    <ul class="simple-list">
                        ${bugfixes.map(fix => `<li>${fix}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${technical.length > 0 ? `
                <div class="technical-section">
                    <h6 class="section-title">
                        <i class="fas fa-cogs"></i>
                        Technical Changes
                    </h6>
                    <ul class="simple-list">
                        ${technical.map(change => `<li>${change}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `;
}

// Formats a release date for display
function formatReleaseDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch (error) {
        return dateString;
    }
}

// Shows error state in release notes modal
function showReleaseNotesError(message) {
    const loadingDiv = document.getElementById('releaseNotesLoading');
    const contentDiv = document.getElementById('releaseNotesContent');
    const errorDiv = document.getElementById('releaseNotesError');
    
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (contentDiv) contentDiv.style.display = 'none';
    if (errorDiv) {
        errorDiv.style.display = 'block';
        const errorSpan = errorDiv.querySelector('span');
        if (errorSpan) {
            errorSpan.textContent = message;
        }
    }
}

// Initialize version loading when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Load version info if we're on the settings page
    const settingsSection = document.getElementById('githubSettings');
    if (settingsSection) {
        loadVersionInfo();
    }
}); 