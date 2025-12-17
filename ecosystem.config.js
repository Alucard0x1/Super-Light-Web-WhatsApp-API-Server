module.exports = {
  apps: [{
    name: 'wa',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024 --optimize-for-size --gc-interval=100',
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=1024'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Graceful shutdown
    kill_timeout: 5000,
    // Crash recovery
    min_uptime: '10s',
    max_restarts: 10,
    // Memory optimization
    instance_var: 'INSTANCE_ID',
    exec_mode: 'fork'
  }]
}; 