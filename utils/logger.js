const winston = require('winston');
const config = require('../config');

// Create a winston logger
const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ level, message, timestamp, stack, sessionId, ...meta }) => {
            const sessionInfo = sessionId ? `[${sessionId}]` : '';
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            const stackStr = stack ? `\n${stack}` : '';
            return `${timestamp} [${level.toUpperCase()}] ${sessionInfo} ${message} ${metaStr}${stackStr}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp, sessionId, ...meta }) => {
                    const sessionInfo = sessionId ? `[${sessionId}]` : '';
                    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
                    return `${timestamp} [${level.toUpperCase()}] ${sessionInfo} ${message} ${metaStr}`;
                })
            )
        })
    ]
});

// Add file transports if file logging is enabled
if (config.logging.fileLogging) {
    // Error log
    logger.add(new winston.transports.File({
        filename: `${config.storage.logsDir}/error.log`,
        level: 'error',
        maxsize: config.logging.maxFileSize,
        maxFiles: config.logging.maxFiles,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        )
    }));

    // Combined log
    logger.add(new winston.transports.File({
        filename: `${config.storage.logsDir}/combined.log`,
        maxsize: config.logging.maxFileSize,
        maxFiles: config.logging.maxFiles,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        )
    }));

    // Session-specific logs
    logger.add(new winston.transports.File({
        filename: `${config.storage.logsDir}/sessions.log`,
        level: 'info',
        maxsize: config.logging.maxFileSize,
        maxFiles: config.logging.maxFiles,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp, sessionId, ...meta }) => {
                if (!sessionId) return '';
                return JSON.stringify({ timestamp, level, sessionId, message, ...meta });
            })
        )
    }));
}

class Logger {
    static info(message, sessionId = null, meta = {}) {
        logger.info(message, { sessionId, ...meta });
    }

    static error(message, error = null, sessionId = null, meta = {}) {
        const errorMeta = error ? {
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            }
        } : {};
        logger.error(message, { sessionId, ...errorMeta, ...meta });
    }

    static warn(message, sessionId = null, meta = {}) {
        logger.warn(message, { sessionId, ...meta });
    }

    static debug(message, sessionId = null, meta = {}) {
        logger.debug(message, { sessionId, ...meta });
    }

    static session(sessionId, message, level = 'info', meta = {}) {
        logger.log(level, message, { sessionId, ...meta });
    }

    static api(req, res, next) {
        const start = Date.now();
        
        res.on('finish', () => {
            const duration = Date.now() - start;
            const logData = {
                method: req.method,
                url: req.url,
                status: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            };
            
            if (res.statusCode >= 400) {
                logger.warn('API Request', logData);
            } else {
                logger.info('API Request', logData);
            }
        });
        
        if (next) next();
    }

    static webhook(url, payload, response, error = null) {
        const logData = {
            url,
            payloadSize: JSON.stringify(payload).length,
            success: !error,
            responseStatus: response?.status,
            error: error?.message
        };
        
        if (error) {
            logger.error('Webhook delivery failed', error, null, logData);
        } else {
            logger.info('Webhook delivered successfully', null, logData);
        }
    }

    static performance(operation, duration, sessionId = null, meta = {}) {
        logger.info(`Performance: ${operation}`, sessionId, {
            operation,
            duration: `${duration}ms`,
            ...meta
        });
    }

    static security(event, details, ip = null) {
        logger.warn(`Security Event: ${event}`, null, {
            event,
            ip,
            timestamp: new Date().toISOString(),
            ...details
        });
    }

    // Get logger stats for monitoring
    static getStats() {
        return {
            level: logger.level,
            transports: logger.transports.map(t => ({
                name: t.constructor.name,
                level: t.level || 'all'
            })),
            fileLogging: config.logging.fileLogging
        };
    }
}

module.exports = Logger; 