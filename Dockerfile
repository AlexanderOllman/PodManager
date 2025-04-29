FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y curl git && \
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" && \
    install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && \
    rm kubectl && \
    rm -rf /var/lib/apt/lists/*

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

# Create startup script
RUN echo '#!/bin/bash\npython background_tasks.py & python app.py' > start.sh && \
    chmod +x start.sh

# Expose port
EXPOSE 8080

# Start the application using the startup script
CMD ["./start.sh"]