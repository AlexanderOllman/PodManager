#!/bin/bash
set -e

# Log startup information
echo "Starting application at $(date)"
echo "Environment: $NODE_ENV"

# Make sure log directory exists and is writable
mkdir -p /app/logs
chmod 777 /app/logs

# Give direct access to logs through a simple HTTP server
python -m http.server 8081 --directory /app/logs &

# Start diagnostic server
echo "Starting diagnostic server on port 8081"
echo "Access logs at http://localhost:8081/app.log"

# Redirect stdout and stderr to file
exec python /app/app.py > /app/logs/startup.log 2>&1 