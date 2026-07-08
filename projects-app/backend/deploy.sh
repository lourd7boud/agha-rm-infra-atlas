#!/bin/bash

# BTP Backend Deployment Script v3
# This script uploads all updated files to the server

echo "========================================="
echo "BTP Backend Deployment Script v3"
echo "========================================="

SERVER="your-server-ip"
USER="your-username"
REMOTE_PATH="/path/to/backend"

# Files to upload
echo "Uploading source files..."

# Upload src folder
scp -r src/ $USER@$SERVER:$REMOTE_PATH/

# Upload dist folder (compiled)
echo "Uploading compiled files..."
scp -r dist/ $USER@$SERVER:$REMOTE_PATH/

# Upload package.json and other config files
echo "Uploading config files..."
scp package.json $USER@$SERVER:$REMOTE_PATH/
scp tsconfig.json $USER@$SERVER:$REMOTE_PATH/

echo ""
echo "========================================="
echo "Deployment completed!"
echo "========================================="
echo ""
echo "Now connect to your server and run:"
echo "  cd $REMOTE_PATH"
echo "  npm install"
echo "  pm2 restart btp-api  (or whatever your process name is)"
