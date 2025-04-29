FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    apt-transport-https \
    ca-certificates \
    gnupg \
    && curl -fsSLo /usr/share/keyrings/kubernetes-apt-keyring.gpg https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key \
    && echo 'deb [signed-by=/usr/share/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /' | tee /etc/apt/sources.list.d/kubernetes.list \
    && apt-get update \
    && apt-get install -y kubectl \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory for database
RUN mkdir -p /data && chmod 777 /data

# Initialize database
RUN python init_db.py

# Set environment variables
ENV FLASK_APP=app.py
ENV FLASK_ENV=production
ENV DB_PATH=/data/kubernetes_cache.db

# Expose port
EXPOSE 8080

# Start the application
CMD ["python", "app.py"]