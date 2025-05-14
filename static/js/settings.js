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

// Manually refreshes the database by calling the backend API
function refreshDatabase() {
    const statusDiv = document.getElementById('databaseRefreshStatus');
    if (!statusDiv) {
        console.error('databaseRefreshStatus element not found.');
        Swal.fire('UI Error', 'Could not find status display element.', 'error');
        return;
    }

    statusDiv.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin"></i> Refreshing database... Please wait.</div>';
    statusDiv.style.display = 'block';

    const url = window.app.getRelativeUrl('/api/refresh-database');
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            statusDiv.innerHTML = `<div class="alert alert-success"><i class="fas fa-check-circle"></i> ${data.message || 'Database refreshed successfully!'}</div>`;
            // Dispatch event for other components to listen to (e.g., dashboard cards)
            document.dispatchEvent(new CustomEvent('databaserefreshcomplete'));
            console.log('Dispatched databaserefreshcomplete event.');
        } else {
            statusDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> Error: ${data.error || 'Unknown error refreshing database.'}</div>`;
        }
    })
    .catch(error => {
        console.error('Error calling refreshDatabase API:', error);
        statusDiv.innerHTML = `<div class="alert alert-danger"><i class="fas fa-exclamation-circle"></i> Network or server error: ${error.message}</div>`;
    })
    .finally(() => {
        // Optionally hide the status message after a few seconds
        setTimeout(() => {
            if (statusDiv) statusDiv.style.display = 'none';
        }, 5000); 
    });
}

// Make sure to call checkGitAvailability if it's relevant for the settings page initialization
// document.addEventListener('DOMContentLoaded', checkGitAvailability); 
// This is usually handled by app_init.js calling specific init functions for tabs. 