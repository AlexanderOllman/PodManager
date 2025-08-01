# HPE Private Cloud AI Resource Manager

A comprehensive **Kubernetes resource management platform** designed for AI/ML workloads in private cloud environments. Built with modern web technologies, this tool provides administrators with real-time visibility, intelligent resource allocation, and streamlined cluster management capabilities.

![Version](https://img.shields.io/badge/version-2.3.1-brightgreen)
![Python](https://img.shields.io/badge/python-3.8+-blue)
![Flask](https://img.shields.io/badge/flask-2.0+-lightgrey)
![Kubernetes](https://img.shields.io/badge/kubernetes-1.20+-326ce5)

## 🚀 Features

### **Comprehensive Resource Management**
- **Real-time Dashboard**: Live monitoring of pods, CPU, memory, and GPU allocation
- **GPU Intelligence**: Advanced GPU resource tracking with memory detection and hardware specifications
- **Resource Explorer**: Interactive browser for all Kubernetes resources with advanced filtering
- **Node Hardware Monitoring**: Detailed hardware specifications and capacity analysis

### **Advanced GPU Management**
- **Multi-view GPU Dashboard**: Overview, nodes, queue monitoring, and workload analysis
- **Intelligent Memory Detection**: Automatic GPU memory inference from hardware models
- **Queue Analytics**: Real-time GPU scheduling queue with wait time analysis
- **Hardware Recognition**: Support for Tesla, A100, H100, and consumer GPU models

### **Operational Tools**
- **Interactive Terminal**: Full kubectl CLI access with command history
- **YAML Deployment**: Drag-and-drop YAML file deployment
- **Namespace Management**: Complete namespace lifecycle with custom labeling
- **Chart Library**: Helm chart management and deployment

### **Modern User Experience**
- **Premium Design**: HPE-branded interface with smooth animations and gradients
- **Auto-refresh**: Real-time data updates every 5 minutes
- **Smart Loading**: Progressive loading with detailed status indicators
- **Responsive Layout**: Mobile-friendly design with collapsible navigation

## 🛠 Technology Stack

- **Backend**: Python Flask with SQLite database
- **Frontend**: Bootstrap 5, Chart.js, Xterm.js for terminal
- **Communication**: WebSocket for real-time updates
- **Kubernetes**: kubectl integration for cluster management
- **Styling**: CSS3 with advanced animations and gradients

## 📦 Installation

### Prerequisites
- Kubernetes cluster (v1.20+)
- Python 3.8+
- kubectl configured for cluster access
- Helm 3.x (optional, for chart management)

### Deployment via Helm

1. **Upload the Helm chart** (.tgz file) through the 'Import Framework' workflow
2. **Configure deployment**:
   - Use the included icon
   - Recommended namespace: `pod-manager`
   - For HPE networks: Set proxy to "enable" in values.yaml

3. **Initial setup**:
   ```bash
   # Verify deployment
   kubectl get pods -n pod-manager
   
   # Access the application
   kubectl port-forward -n pod-manager svc/pod-manager 5000:5000
   ```

4. **First-time configuration**:
   - Navigate to Settings
   - Click "Refresh Database" to populate initial data
   - Use "Update Application" for latest version

### Manual Deployment

```bash
# Clone repository
git clone <repository-url>
cd podmanager

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export FLASK_APP=app.py
export FLASK_ENV=production

# Run application
python app.py
```

## 🎯 Usage

### Dashboard Overview
Access the main dashboard to view:
- **Pod Allocation**: Real-time pod utilization across worker nodes
- **CPU & Memory**: Cluster-wide resource consumption
- **GPU Management**: Comprehensive GPU resource tracking
- **Top Namespaces**: Resource usage by namespace

### GPU Resource Management
Navigate to the GPU Resource Management section for:
- **Overview**: Total GPU capacity and utilization metrics
- **GPU Nodes**: Hardware specifications and driver information
- **Queue Monitor**: Pending GPU requests and wait times
- **GPU Workloads**: Active pods with GPU memory details

### Resource Operations
- **Resource Explorer**: Browse all Kubernetes resources with search and filtering
- **Terminal**: Execute kubectl commands directly in the browser
- **YAML Deploy**: Upload and deploy Kubernetes manifests
- **Namespace Management**: Create, edit, and manage namespaces

## 🔧 Configuration

### Environment Variables
```bash
FLASK_HOST=0.0.0.0          # Application host
FLASK_PORT=5000             # Application port
FLASK_DEBUG=False           # Debug mode
DATABASE_PATH=cluster.db    # SQLite database location
```

### Application Settings
- **Auto-refresh Interval**: 5 minutes (configurable in settings)
- **GPU Memory Detection**: Automatic based on node labels and hardware
- **Background Updates**: Kubernetes resource synchronization

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### **Getting Started**
1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes**
4. **Test thoroughly**
5. **Submit a pull request**

### **Development Setup**
```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/podmanager.git
cd podmanager

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install development dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt  # If available

# Run in development mode
export FLASK_ENV=development
python app.py
```

### **Code Standards**
- **Python**: Follow PEP 8 style guidelines
- **JavaScript**: Use ES6+ features, consistent indentation
- **CSS**: Use CSS3 features, maintain consistent naming
- **Comments**: Write clear, descriptive comments
- **Testing**: Add tests for new features

### **Pull Request Guidelines**
- **Description**: Clearly describe the changes and motivation
- **Testing**: Include test results and screenshots for UI changes
- **Documentation**: Update README if needed
- **Version**: Update `version.json` with release notes
- **Review**: Be responsive to feedback during code review

### **Bug Reports**
When reporting bugs, include:
- Application version and environment details
- Steps to reproduce the issue
- Expected vs actual behavior
- Screenshots or error logs
- Kubernetes cluster information (version, provider)

### **Feature Requests**
For new features:
- Describe the use case and business value
- Provide mockups or examples if applicable
- Consider implementation complexity
- Discuss potential impact on existing features

### **Commit Message Format**
```
type(scope): brief description

Detailed explanation of changes (if needed)

Fixes #123
```

**Types**: feat, fix, docs, style, refactor, test, chore

## 🎨 Customization

### Theming
The application uses HPE branding with customizable:
- **Color Scheme**: CSS variables in `static/css/main.css`
- **Gradients**: HPE-branded color gradients
- **Icons**: FontAwesome icon library
- **Animations**: CSS3 transitions and keyframes

### Dashboard Configuration
- **Metric Cards**: Configurable in `static/js/gpu_dashboard.js`
- **Chart Types**: Chart.js configuration for visualizations
- **Update Intervals**: Adjustable refresh rates

## 🚀 Roadmap

- [ ] **Multi-cluster Support**: Manage multiple Kubernetes clusters
- [ ] **RBAC Integration**: Role-based access control
- [ ] **Custom Metrics**: User-defined monitoring dashboards
- [ ] **API Extensions**: RESTful API for external integrations
- [ ] **Mobile App**: Native mobile application for monitoring

## 📸 Screenshots

*Dashboard Overview*
![Dashboard](docs/images/dashboard.png)

*GPU Resource Management*
![GPU Management](docs/images/gpu-dashboard.png)

*Resource Explorer*
![Resource Explorer](docs/images/resource-explorer.png)

## 🆘 Support

For support and questions:
- **Issues**: Create a GitHub issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for general questions
- **Email**: Provide feedback directly through the application

---

**Built with ❤️ by Alex Ollman**
