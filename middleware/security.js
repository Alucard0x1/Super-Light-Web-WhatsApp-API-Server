const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const config = require('../config');

class SecurityMiddleware {
    static setupSecurity(app) {
        // Security headers
        app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "fonts.googleapis.com"],
                    fontSrc: ["'self'", "fonts.gstatic.com", "cdn.jsdelivr.net"],
                    scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'", "ws:", "wss:"]
                }
            }
        }));

        // CORS configuration
        const corsOptions = {
            origin: function (origin, callback) {
                // Allow requests with no origin (mobile apps, etc.)
                if (!origin) return callback(null, true);
                
                // In development, allow all origins
                if (config.server.environment === 'development') {
                    return callback(null, true);
                }
                
                // In production, you should specify allowed origins
                const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
                    process.env.ALLOWED_ORIGINS.split(',') : [
                        `http://localhost:${config.server.port}`,
                        `https://localhost:${config.server.port}`
                    ];
                
                if (allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error('Not allowed by CORS'));
                }
            },
            credentials: true,
            optionsSuccessStatus: 200
        };
        app.use(cors(corsOptions));

        // Rate limiting
        const limiter = rateLimit({
            windowMs: config.security.rateLimitWindow,
            max: config.security.rateLimitMax,
            message: {
                status: 'error',
                message: 'Too many requests, please try again later.'
            },
            standardHeaders: true,
            legacyHeaders: false,
        });
        app.use('/api', limiter);

        // Specific rate limiting for auth endpoints
        const authLimiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 5, // limit each IP to 5 requests per windowMs
            message: {
                status: 'error',
                message: 'Too many login attempts, please try again later.'
            }
        });
        app.use('/admin/login', authLimiter);
    }

    static validateInput(schema) {
        return (req, res, next) => {
            const { error } = schema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Validation error',
                    details: error.details.map(detail => detail.message)
                });
            }
            next();
        };
    }

    static async logRequest(req, res, next) {
        const start = Date.now();
        
        res.on('finish', () => {
            const duration = Date.now() - start;
            const logData = {
                method: req.method,
                url: req.url,
                status: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            };
            
            // Log to console in development
            if (config.server.environment === 'development') {
                console.log(`${logData.method} ${logData.url} ${logData.status} ${logData.duration}`);
            }
        });
        
        next();
    }
}

module.exports = SecurityMiddleware; 