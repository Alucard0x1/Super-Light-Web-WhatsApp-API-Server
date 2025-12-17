#!/bin/bash

# Production start script for cPanel deployment
# This script optimizes Node.js for limited memory environments

# Set production environment
export NODE_ENV=production

# Memory optimization flags
export NODE_OPTIONS="--max-old-space-size=1024 --optimize-for-size --gc-interval=100"

# Enable garbage collection
export NODE_ARGS="--expose-gc"

# Create required directories if they don't exist
mkdir -p logs
mkdir -p sessions
mkdir -p media
mkdir -p auth_info_baileys
mkdir -p activity_logs

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Check if PM2 is available
if command -v pm2 &> /dev/null
then
    echo "Starting application with PM2..."
    pm2 start ecosystem.config.js
else
    echo "PM2 not found. Starting with Node.js directly..."
    echo "Recommendation: Install PM2 for better process management"
    
    # Start directly with Node.js using memory optimization flags
    # Note: NODE_OPTIONS are automatically picked up by Node.js
    node $NODE_ARGS index.js
fi

# Show PM2 status
echo ""
echo "Application started! Check status with: pm2 status"
echo "View logs with: pm2 logs"
echo "Monitor with: pm2 monit" 