#!/bin/bash

echo "Pulling latest..."
git pull

echo "Building image..."
docker build -t fheonix/pod-manager:0.0.2 .

echo "Pushing image..."
docker push fheonix/pod-manager:0.0.2

echo "Done."


