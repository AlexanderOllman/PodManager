FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies and kubectl
RUN apt-get update && \
    apt-get install -y curl procps && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements file separately to leverage Docker caching
COPY requirements.txt /app/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code to the container
COPY . /app

# Create a log directory with proper permissions
RUN mkdir -p /app/logs && chmod 777 /app/logs

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV LOG_FILE=/app/logs/app.log

# Make ports available
EXPOSE 8080
EXPOSE 80

# Add health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Add a startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]