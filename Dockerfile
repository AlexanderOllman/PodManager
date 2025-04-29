FROM python:3.9-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    kubectl \
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