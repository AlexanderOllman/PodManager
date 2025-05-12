// Cleaned and modularized version of home_page.js

// Utility function to log messages
const log = (message) => console.log(`[Home Page]: ${message}`);

// Utility function to fetch data with error handling
const fetchData = async (url, onSuccess, onError) => {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        onSuccess(data);
    } catch (error) {
        onError(error);
    }
};

// Update resource metrics
const updateMetrics = (elementId, value, total) => {
    const element = document.getElementById(elementId);
    if (element) element.textContent = `${value} / ${total}`;
};

// Update progress bar
const updateProgressBar = (elementId, percent) => {
    const bar = document.getElementById(elementId);
    if (bar) {
        bar.style.width = `${percent}%`;
        bar.setAttribute('aria-valuenow', percent);
    }
};

// Update cluster resource cards
const updateClusterResourceCards = (data) => {
    updateMetrics('podsCount', data.active_pods, data.max_pods);
    updateMetrics('vcpuCount', data.used_vcpu, data.total_vcpu);
    updateMetrics('ramCount', data.used_ram, data.total_ram);
    updateMetrics('gpuCount', data.used_gpu, data.total_gpu);

    updateProgressBar('podsProgressBar', data.pods_percent);
    updateProgressBar('vcpuProgressBar', data.vcpu_percent);
    updateProgressBar('ramProgressBar', data.ram_percent);
    updateProgressBar('gpuProgressBar', data.gpu_percent);
};

// Fetch and render cluster capacity
const fetchAndRenderClusterCapacity = () => {
    fetchData('/get_cluster_capacity', updateClusterResourceCards, (err) => log(`Failed to fetch cluster capacity: ${err}`));
};

// Event listener for page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchAndRenderClusterCapacity);
} else {
    fetchAndRenderClusterCapacity();
}

log('Home page initialized.');
