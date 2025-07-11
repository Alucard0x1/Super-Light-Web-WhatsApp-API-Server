module.exports = {
  apps: [{
    name: 'whatsapp-api',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    env_production: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 3000,
    // Restart on file changes (disable in production)
    ignore_watch: ['node_modules', 'logs', 'media', 'auth_info_baileys', '.git'],
    // Auto restart if app crashes
    min_uptime: '10s',
    max_restarts: 10,
    // Log date format
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
}; 