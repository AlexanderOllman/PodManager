// yaml_deploy.js

// Sets up the drag and drop zone for YAML file uploads
function setupDropZone() {
    document.querySelectorAll(".drop-zone__input").forEach((inputElement) => {
        const dropZoneElement = inputElement.closest(".drop-zone");
        if (!dropZoneElement) return;

        // Clicking the zone triggers the hidden file input
        dropZoneElement.addEventListener("click", (e) => {
            // Prevent triggering click if clicking on the thumbnail's remove button or deploy button
            if (e.target.closest('.drop-zone__thumb-remove') || e.target.closest('#deployButton')) {
                return;
            }
            inputElement.click();
        });

        // Update thumbnail on file selection
        inputElement.addEventListener("change", (e) => {
            if (inputElement.files.length) {
                updateThumbnail(dropZoneElement, inputElement.files[0]);
                toggleDeployButton(true);
            }
        });

        // Dragover styling
        dropZoneElement.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZoneElement.classList.add("drop-zone--over");
        });

        // Dragleave/dragend styling reset
        ["dragleave", "dragend"].forEach((type) => {
            dropZoneElement.addEventListener(type, (e) => {
                dropZoneElement.classList.remove("drop-zone--over");
            });
        });

        // Handle dropped files
        dropZoneElement.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZoneElement.classList.remove("drop-zone--over");

            if (e.dataTransfer.files.length) {
                // Ensure only one file is handled, preferably a YAML file
                const yamlFile = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.yaml') || f.name.endsWith('.yml'));
                if (yamlFile) {
                     inputElement.files = createFileList(yamlFile); // Update input element's files
                    updateThumbnail(dropZoneElement, yamlFile);
                    toggleDeployButton(true);
                } else {
                    // Handle case where non-YAML file is dropped (optional: show error)
                    console.warn('Dropped file is not a YAML file.');
                    updateThumbnail(dropZoneElement, null); // Clear thumbnail
                    toggleDeployButton(false);
                    // Show error message in drop zone (optional)
                }
            }
        });
    });
}

// Updates the thumbnail preview in the drop zone
function updateThumbnail(dropZoneElement, file) {
    let thumbnailElement = dropZoneElement.querySelector(".drop-zone__thumb");
    const promptElement = dropZoneElement.querySelector(".drop-zone__prompt");

    if (promptElement) promptElement.style.display = file ? 'none' : 'block'; // Hide prompt if file exists

    if (!file) { // Clear thumbnail if no file
        if (thumbnailElement) thumbnailElement.remove();
        return;
    }

    if (!thumbnailElement) {
        thumbnailElement = document.createElement("div");
        thumbnailElement.classList.add("drop-zone__thumb");
        // Add a remove button to the thumbnail
        thumbnailElement.innerHTML = `
            <div class="drop-zone__thumb-details"></div>
            <button class="btn btn-sm btn-danger drop-zone__thumb-remove" title="Remove file">&times;</button>
        `;
        dropZoneElement.appendChild(thumbnailElement);

        // Add event listener for the remove button
        thumbnailElement.querySelector('.drop-zone__thumb-remove').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent drop zone click event
            const inputElement = dropZoneElement.querySelector('.drop-zone__input');
            if (inputElement) inputElement.value = ''; // Clear file input
            updateThumbnail(dropZoneElement, null); // Remove thumbnail
            toggleDeployButton(false);
            document.getElementById('yamlOutput').textContent = ''; // Clear output
        });
    }
    
    const thumbDetails = thumbnailElement.querySelector('.drop-zone__thumb-details');
    thumbDetails.textContent = file.name;
    // You could add more details like file size here
    // Example: thumbDetails.innerHTML = `${file.name}<br><small>${formatFileSize(file.size)}</small>`;
}

// Toggles the visibility and disabled state of the deploy button
function toggleDeployButton(show) {
    const deployButton = document.getElementById('deployButton');
    if (deployButton) {
        deployButton.style.display = show ? 'inline-block' : 'none';
        deployButton.disabled = !show;
    }
}

// Deploys the selected YAML file to the server
function deployYaml() {
    const fileInput = document.querySelector('.drop-zone__input');
    const file = fileInput?.files?.[0];
    const outputElement = document.getElementById('yamlOutput');
    const deployButton = document.getElementById('deployButton');

    if (!file) {
        if (outputElement) outputElement.textContent = 'Please select or drop a YAML file first.';
        return;
    }
    if (!outputElement) {
        console.error('YAML output element not found.');
        return;
    }

    if (deployButton) {
        deployButton.disabled = true;
        deployButton.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Deploying...';
    }
    outputElement.textContent = 'Deploying YAML...';
    outputElement.className = 'text-info';

    const formData = new FormData();
    formData.append('file', file);
    const url = window.app.getRelativeUrl('/upload_yaml');

    fetch(url, { method: 'POST', body: formData })
        .then(response => response.json())
        .then(data => {
            if (data.success !== false && (data.output || data.message)) {
                outputElement.textContent = data.output || data.message;
                outputElement.className = 'text-success';
            } else if (data.error) {
                 outputElement.textContent = `Error: ${data.error}`;
                 outputElement.className = 'text-danger';
            } else {
                 outputElement.textContent = 'Deployment finished with unknown status.';
                 outputElement.className = 'text-warning';
            }
        })
        .catch(error => {
            console.error('Error deploying YAML:', error);
            outputElement.textContent = `An error occurred: ${error.message}`;
            outputElement.className = 'text-danger';
        })
        .finally(() => {
             if (deployButton) {
                 deployButton.disabled = false; // Re-enable, even on error
                 deployButton.innerHTML = '<i class="fas fa-rocket me-1"></i> Deploy YAML';
             }
        });
}

// Helper to create a FileList object (needed for setting inputElement.files)
function createFileList(file) {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  return dataTransfer.files;
} 