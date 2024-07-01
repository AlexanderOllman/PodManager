FROM ubuntu:latest

# Set the working directory
WORKDIR /app

# Install necessary dependencies
RUN apt-get update && apt-get install -y \
    apt-transport-https \
    gnupg2 \
    curl \
    wget \
    python3 \
    python3-pip

# Install kubectl
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.28/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.28/deb/ /" | tee /etc/apt/sources.list.d/kubernetes.list && \
    apt-get update && \
    apt-get install -y kubectl



# Copy the current directory contents into the container at /app
COPY . /app

# Install any needed dependencies specified in requirements.txt
RUN pip3 install --no-cache-dir -r requirements.txt

# Make port 80 available to the world outside this container
EXPOSE 80
EXPOSE 8080
# Run app.py when the container launches
CMD ["python3", "app.py"]