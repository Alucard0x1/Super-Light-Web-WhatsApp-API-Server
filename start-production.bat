@echo off
REM Production start script for Windows/cPanel deployment
REM This script optimizes Node.js for limited memory environments

REM Set production environment
set NODE_ENV=production

REM Memory optimization flags
set NODE_OPTIONS=--max-old-space-size=1024 --optimize-for-size --gc-interval=100

REM Enable garbage collection
set NODE_ARGS=--expose-gc

REM Create required directories if they don't exist
if not exist logs mkdir logs
if not exist sessions mkdir sessions
if not exist media mkdir media
if not exist auth_info_baileys mkdir auth_info_baileys
if not exist activity_logs mkdir activity_logs

REM Check if PM2 is available
where pm2 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Starting with PM2...
    pm2 start ecosystem.config.js
) else (
    echo Starting with Node.js directly...
    echo Consider installing PM2 for better process management
    node --expose-gc --max-old-space-size=1024 --optimize-for-size index.js
) 