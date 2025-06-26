const path = require('path');
const crypto = require('crypto');

// Generate a random JWT secret if not provided
const generateSecret = () => crypto.randomBytes(32).toString('hex');

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || 'localhost',
        environment: process.env.NODE_ENV || 'development'
    },

    // Security Configuration
    security: {
        jwtSecret: process.env.JWT_SECRET || generateSecret(),
        adminUser: process.env.ADMIN_USER || 'admin',
        adminPass: process.env.ADMIN_PASS || 'secure_password_change_me',
        sessionTimeout: process.env.SESSION_TIMEOUT || '24h',
        rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
        rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100 // requests per window
    },

    // WhatsApp Configuration
    whatsapp: {
        qrTimeout: parseInt(process.env.QR_TIMEOUT) || 30000,
        retryCount: parseInt(process.env.RETRY_COUNT) || 3,
        reconnectDelay: parseInt(process.env.RECONNECT_DELAY) || 5000,
        browser: process.env.WA_BROWSER || 'WhatsApp Gateway',
        generateHighQualityPreviews: process.env.HIGH_QUALITY_PREVIEWS === 'true'
    },

    // Storage Configuration
    storage: {
        authDir: path.join(__dirname, 'auth_info_baileys'),
        mediaDir: path.join(__dirname, 'media'),
        tokensFile: path.join(__dirname, 'session_tokens.json'),
        logsDir: path.join(__dirname, 'logs')
    },

    // Webhook Configuration
    webhook: {
        url: process.env.WEBHOOK_URL || '',
        timeout: parseInt(process.env.WEBHOOK_TIMEOUT) || 5000,
        retries: parseInt(process.env.WEBHOOK_RETRIES) || 3
    },

    // Logging Configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        fileLogging: process.env.FILE_LOGGING === 'true',
        maxFileSize: process.env.LOG_MAX_SIZE || '10MB',
        maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
    }
};

// Validation
if (config.security.adminPass === 'secure_password_change_me' && config.server.environment === 'production') {
    console.warn('⚠️  WARNING: Using default admin password in production! Set ADMIN_PASS environment variable.');
}

if (!process.env.JWT_SECRET) {
    console.warn('⚠️  WARNING: JWT_SECRET not set. Generated random secret (sessions will not persist across restarts).');
}

module.exports = config; 