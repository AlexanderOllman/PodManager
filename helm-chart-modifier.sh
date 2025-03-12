#!/bin/bash

# helm-chart-modifier.sh
# Script to unpack a Helm chart, modify it for a specific Kubernetes cluster, and repack it

set -e

print_usage() {
    echo "Usage: $0 input_chart.tgz domain_name [options]"
    echo "Example: $0 mychart-1.0.0.tgz example.com --gateway istio-system/my-gateway --service-name my-service --service-port 8080"
    echo ""
    echo "Options:"
    echo "  --gateway VALUE       Istio gateway to use (default: istio-system/ezaf-gateway)"
    echo "  --service-name VALUE  Service name to expose (default: derived from Chart.yaml name)"
    echo "  --service-port VALUE  Service port to expose (default: 8000)"
    echo "  --path VALUE          URL path prefix (default: /)"
    echo "  --rewrite VALUE       URL rewrite path (default: /)"
    echo "  --cert-image VALUE    Image to use for certificate copying (default: curlimages/curl:7.86.0)"
    echo "  --namespace VALUE     Namespace override (default: uses Helm release.namespace)"
}

# Check if minimum args were provided
if [ "$#" -lt 2 ]; then
    print_usage
    exit 1
fi

INPUT_CHART="$1"
DOMAIN_NAME="$2"
shift 2

# Default values
ISTIO_GATEWAY="istio-system/ezaf-gateway"
SERVICE_NAME=""  # Will be derived from Chart.yaml
SERVICE_PORT="8000"
PATH_PREFIX="/"
PATH_REWRITE="/"
CERT_IMAGE="curlimages/curl:7.86.0"
NAMESPACE_OVERRIDE=""

# Parse additional arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        --gateway)
            ISTIO_GATEWAY="$2"
            shift 2
            ;;
        --service-name)
            SERVICE_NAME="$2"
            shift 2
            ;;
        --service-port)
            SERVICE_PORT="$2"
            shift 2
            ;;
        --path)
            PATH_PREFIX="$2"
            shift 2
            ;;
        --rewrite)
            PATH_REWRITE="$2"
            shift 2
            ;;
        --cert-image)
            CERT_IMAGE="$2"
            shift 2
            ;;
        --namespace)
            NAMESPACE_OVERRIDE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            print_usage
            exit 1
            ;;
    esac
done

CHART_NAME=$(basename "$INPUT_CHART" .tgz)
TEMP_DIR="/tmp/helm-modifier-$(date +%s)"
OUTPUT_CHART="${CHART_NAME}-modified.tgz"

echo "===== Modifying Helm chart: $INPUT_CHART ====="
echo "Target domain: $DOMAIN_NAME"
echo "Output will be saved as: $OUTPUT_CHART"

# Create temporary directory
mkdir -p "$TEMP_DIR"
echo "Created temporary directory: $TEMP_DIR"

# Extract the chart
echo "Extracting chart..."
tar -xzf "$INPUT_CHART" -C "$TEMP_DIR"
CHART_DIR=$(find "$TEMP_DIR" -maxdepth 1 -type d -not -path "$TEMP_DIR")
CHART_DIR_NAME=$(basename "$CHART_DIR")

# Read the chart name from Chart.yaml if service name not specified
if [ -z "$SERVICE_NAME" ]; then
    if [ -f "$CHART_DIR/Chart.yaml" ]; then
        # Try to extract the chart name from Chart.yaml
        if command -v yq &> /dev/null; then
            # If yq is available, use it to parse YAML properly
            SERVICE_NAME=$(yq eval '.name' "$CHART_DIR/Chart.yaml")
        else
            # Fallback to grep for simple extraction
            SERVICE_NAME=$(grep "^name:" "$CHART_DIR/Chart.yaml" | awk '{print $2}' | tr -d '"'"'")
        fi
        echo "Extracted service name from Chart.yaml: $SERVICE_NAME"
    fi
    
    # If still empty, use chart directory name as fallback
    if [ -z "$SERVICE_NAME" ]; then
        SERVICE_NAME="$CHART_DIR_NAME"
        echo "Using chart directory name as service name: $SERVICE_NAME"
    fi
fi

# Create ezua templates directory
echo "Creating ezua templates directory..."
mkdir -p "$CHART_DIR/templates/ezua"

# Create virtualservice.yaml with more generic references
echo "Creating virtualservice.yaml..."
NAMESPACE_TEMPLATE="{{ .Release.Namespace }}"
if [ -n "$NAMESPACE_OVERRIDE" ]; then
    NAMESPACE_TEMPLATE="$NAMESPACE_OVERRIDE"
fi

cat > "$CHART_DIR/templates/ezua/virtualservice.yaml" << EOF
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: {{ .Chart.Name }}-vs
  namespace: $NAMESPACE_TEMPLATE
spec:
  gateways:
  - {{ .Values.ezua.virtualService.istioGateway | required ".Values.ezua.virtualService.istioGateway is required !\n" }}
  hosts:
  - {{ .Values.ezua.virtualService.endpoint | required ".Values.ezua.virtualService.endpoint is required !\n" }}
  http:
    - match:
        - uri:
            prefix: {{ .Values.ezua.virtualService.path | default "$PATH_PREFIX" }}
      rewrite:
        uri: {{ .Values.ezua.virtualService.rewrite | default "$PATH_REWRITE" }}

      route:
      - destination:
          host: {{ .Values.ezua.virtualService.serviceName | default "$SERVICE_NAME" }}.$NAMESPACE_TEMPLATE.svc.cluster.local
          port:
            number: {{ .Values.ezua.virtualService.servicePort | default $SERVICE_PORT }}
EOF

# Create cert-copy.yaml with configurable image
echo "Creating cert-copy.yaml..."
cat > "$CHART_DIR/templates/ezua/cert-copy.yaml" << EOF
{{- if .Values.ezua.selfSignedCerts -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: ssl-cert-configmap
  namespace: $NAMESPACE_TEMPLATE
data:
  ca.crt: |-
{{ .Files.Get "ca.crt" | indent 4 }}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: copy-certs
  namespace: $NAMESPACE_TEMPLATE
spec:
  template:
    spec:
      serviceAccountName: default
      containers:
      - name: copy-certs
        image: {{ .Values.ezua.certCopyImage | default "$CERT_IMAGE" }}
        command: ["/bin/sh", "-c"]
        args:
        - cp /etc/ssl/certs/ca.crt /ssl-cert/ca.crt
        volumeMounts:
        - name: ssl-cert
          mountPath: /ssl-cert
      restartPolicy: Never
      volumes:
      - name: ssl-cert
        configMap:
          name: ssl-cert-configmap
  backoffLimit: 4
{{- end -}}
EOF

# Update values.yaml to include ezua configuration
echo "Updating values.yaml..."
if grep -q "ezua:" "$CHART_DIR/values.yaml"; then
    echo "ezua section already exists in values.yaml"
else
    # Add ezua configuration with more parameters
    cat >> "$CHART_DIR/values.yaml" << EOF

ezua:
  # Use these options to configure the application endpoint
  virtualService:
    endpoint: "$SERVICE_NAME.$DOMAIN_NAME"
    istioGateway: "$ISTIO_GATEWAY"
    path: "$PATH_PREFIX"
    rewrite: "$PATH_REWRITE"
    serviceName: "$SERVICE_NAME"
    servicePort: $SERVICE_PORT
  # If your cluster has self-signed certs, and you're using an MLIS endpoint, set this to true
  selfSignedCerts: false
  # Image to use for certificate copying job
  certCopyImage: "$CERT_IMAGE"
EOF
    echo "Added ezua configuration to values.yaml"
fi

# Package the modified chart
echo "Packaging modified chart..."
helm package "$CHART_DIR" -d "$(pwd)" --name "${CHART_NAME%-*}" --version "${CHART_NAME##*-}" > /dev/null

# Rename the output file if necessary
if [ -f "${CHART_DIR_NAME}.tgz" ] && [ "${CHART_DIR_NAME}.tgz" != "$OUTPUT_CHART" ]; then
    mv "${CHART_DIR_NAME}.tgz" "$OUTPUT_CHART"
fi

# Clean up
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

echo "===== Modification complete ====="
echo "Modified chart saved as: $OUTPUT_CHART"
echo "You may need to update the specific values.yaml parameters after installation." 