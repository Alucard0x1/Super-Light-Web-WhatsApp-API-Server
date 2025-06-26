const winston = require('winston');
const config = require('../config');

// Create logger instance
const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Add file transport if enabled
if (config.logging.fileLogging) {
    logger.add(new winston.transports.File({
        filename: `${config.storage.logsDir}/error.log`,
        level: 'error',
        maxsize: config.logging.maxFileSize,
        maxFiles: config.logging.maxFiles
    }));
    
    logger.add(new winston.transports.File({
        filename: `${config.storage.logsDir}/combined.log`,
        maxsize: config.logging.maxFileSize,
        maxFiles: config.logging.maxFiles
    }));
}

class ErrorHandler {
    static logger = logger;

    // Custom error classes
    static ValidationError = class extends Error {
        constructor(message, details = null) {
            super(message);
            this.name = 'ValidationError';
            this.statusCode = 400;
            this.details = details;
        }
    };

    static AuthenticationError = class extends Error {
        constructor(message) {
            super(message);
            this.name = 'AuthenticationError';
            this.statusCode = 401;
        }
    };

    static AuthorizationError = class extends Error {
        constructor(message) {
            super(message);
            this.name = 'AuthorizationError';
            this.statusCode = 403;
        }
    };

    static NotFoundError = class extends Error {
        constructor(message) {
            super(message);
            this.name = 'NotFoundError';
            this.statusCode = 404;
        }
    };

    static ConflictError = class extends Error {
        constructor(message) {
            super(message);
            this.name = 'ConflictError';
            this.statusCode = 409;
        }
    };

    static WhatsAppError = class extends Error {
        constructor(message, sessionId = null) {
            super(message);
            this.name = 'WhatsAppError';
            this.statusCode = 502;
            this.sessionId = sessionId;
        }
    };

    static handleAsync(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    static logError(error, req = null) {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            name: error.name,
            statusCode: error.statusCode || 500,
            timestamp: new Date().toISOString()
        };

        if (req) {
            errorInfo.request = {
                method: req.method,
                url: req.url,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                body: req.body,
                params: req.params,
                query: req.query
            };
        }

        if (error.sessionId) {
            errorInfo.sessionId = error.sessionId;
        }

        logger.error('Application Error', errorInfo);
    }

    static globalErrorHandler() {
        return (error, req, res, next) => {
            // Log the error
            ErrorHandler.logError(error, req);

            // Don't leak sensitive information in production
            const isDevelopment = config.server.environment === 'development';

            let response = {
                status: 'error',
                message: error.message || 'Internal Server Error',
                code: error.name || 'INTERNAL_ERROR',
                timestamp: new Date().toISOString()
            };

            // Add additional error details in development
            if (isDevelopment) {
                response.stack = error.stack;
                response.details = error.details || null;
            }

            // Set status code
            const statusCode = error.statusCode || 500;

            // Send response
            res.status(statusCode).json(response);
        };
    }

    static notFoundHandler() {
        return (req, res, next) => {
            const error = new ErrorHandler.NotFoundError(`Route ${req.method} ${req.path} not found`);
            next(error);
        };
    }

    // WhatsApp specific error handling
    static handleWhatsAppError(error, sessionId) {
        let whatsappError;
        
        if (error.output && error.output.statusCode) {
            const statusCode = error.output.statusCode;
            
            switch (statusCode) {
                case 401:
                    whatsappError = new ErrorHandler.AuthenticationError(
                        `WhatsApp authentication failed for session ${sessionId}. Please scan QR code again.`
                    );
                    break;
                case 403:
                    whatsappError = new ErrorHandler.AuthorizationError(
                        `WhatsApp authorization failed for session ${sessionId}. Account may be banned.`
                    );
                    break;
                case 408:
                    whatsappError = new ErrorHandler.WhatsAppError(
                        `WhatsApp connection timeout for session ${sessionId}`, sessionId
                    );
                    break;
                case 429:
                    whatsappError = new ErrorHandler.WhatsAppError(
                        `WhatsApp rate limit exceeded for session ${sessionId}`, sessionId
                    );
                    break;
                case 500:
                    whatsappError = new ErrorHandler.WhatsAppError(
                        `WhatsApp server error for session ${sessionId}`, sessionId
                    );
                    break;
                case 515:
                    whatsappError = new ErrorHandler.WhatsAppError(
                        `WhatsApp stream error for session ${sessionId} - will retry`, sessionId
                    );
                    break;
                default:
                    whatsappError = new ErrorHandler.WhatsAppError(
                        `WhatsApp error (${statusCode}) for session ${sessionId}: ${error.message}`, sessionId
                    );
            }
        } else {
            whatsappError = new ErrorHandler.WhatsAppError(
                `WhatsApp connection error for session ${sessionId}: ${error.message}`, sessionId
            );
        }

        ErrorHandler.logError(whatsappError);
        return whatsappError;
    }

    // Validation error formatting
    static formatValidationError(joiError) {
        const details = joiError.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context.value
        }));

        return new ErrorHandler.ValidationError(
            'Validation failed',
            details
        );
    }

    // Health check for error monitoring
    static getErrorStats() {
        return {
            logLevel: logger.level,
            transports: logger.transports.length,
            environment: config.server.environment,
            fileLogging: config.logging.fileLogging
        };
    }
}

module.exports = ErrorHandler; 