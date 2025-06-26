const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    isJidBroadcast,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { randomUUID } = require('crypto');

// Import new modules
const config = require('./config');
const AuthMiddleware = require('./middleware/auth');
const SecurityMiddleware = require('./middleware/security');
const ValidationSchemas = require('./middleware/validation');
const ErrorHandler = require('./middleware/errorHandler');
const Logger = require('./utils/logger');
const { initializeApi, getWebhookUrl } = require('./api_v1');
const { initializeLegacyApi } = require('./legacy_api');

const sessions = new Map();
const retries = new Map();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const logger = pino({ level: config.logging.level });

let sessionTokens = new Map();

function saveTokens() {
    try {
        const tokensToSave = Object.fromEntries(sessionTokens);
        fs.writeFileSync(config.storage.tokensFile, JSON.stringify(tokensToSave, null, 2), 'utf-8');
        Logger.debug('Session tokens saved successfully');
    } catch (error) {
        Logger.error('Failed to save session tokens', error);
        throw new ErrorHandler.WhatsAppError('Failed to save session tokens');
    }
}

function loadTokens() {
    try {
        if (fs.existsSync(config.storage.tokensFile)) {
            const tokensFromFile = JSON.parse(fs.readFileSync(config.storage.tokensFile, 'utf-8'));
            sessionTokens.clear();
            for (const [key, value] of Object.entries(tokensFromFile)) {
                sessionTokens.set(key, value);
            }
            Logger.info(`Loaded ${sessionTokens.size} session tokens`);
        }
    } catch (error) {
        Logger.error('Error loading tokens file', error);
        sessionTokens.clear();
    }
}

// Ensure required directories exist
const requiredDirs = [config.storage.mediaDir, config.storage.authDir, config.storage.logsDir];
requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        Logger.info(`Created directory: ${dir}`);
    }
});

// Setup security middleware
SecurityMiddleware.setupSecurity(app);

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(Logger.api);

// Trust proxy for rate limiting behind reverse proxies
app.set('trust proxy', 1);

// Admin authentication endpoints
app.post('/admin/login', 
    SecurityMiddleware.validateInput(ValidationSchemas.adminLogin),
    ErrorHandler.handleAsync(async (req, res) => {
        const { username, password } = req.body;
        const result = await AuthMiddleware.loginAdmin(username, password);
        
        if (result.success) {
            Logger.security('Admin login successful', { username }, req.ip);
            res.status(200).json({
                status: 'success',
                message: result.message,
                token: result.token
            });
        } else {
            Logger.security('Admin login failed', { username, reason: result.message }, req.ip);
            throw new ErrorHandler.AuthenticationError(result.message);
        }
    })
);

app.post('/admin/verify', AuthMiddleware.adminAuth, (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Token is valid',
        admin: req.admin.username
    });
});

// Static file serving
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/media', express.static(config.storage.mediaDir));

// Add auth check script to dashboard
app.get('/admin/dashboard.html', (req, res) => {
    try {
        const dashboardPath = path.join(__dirname, 'admin', 'dashboard.html');
        let dashboardContent = fs.readFileSync(dashboardPath, 'utf-8');
        
        // Inject auth check script before closing head tag
        const authScript = `
            <script>
                ${AuthMiddleware.checkAdminAccess()}
            </script>
        `;
        dashboardContent = dashboardContent.replace('</head>', `${authScript}</head>`);
        
        res.send(dashboardContent);
    } catch (error) {
        Logger.error('Failed to serve dashboard', error);
        res.status(500).send('Internal Server Error');
    }
});

// API routes
const v1ApiRouter = initializeApi(sessions, sessionTokens, createSession, getSessionsDetails, deleteSession);
const legacyApiRouter = initializeLegacyApi(sessions);
app.use('/api/v1', v1ApiRouter);
app.use('/api', legacyApiRouter);

// Health check endpoint
app.get('/health', (req, res) => {
    try {
        const healthData = {
            status: 'healthy',
            version: require('./package.json').version,
            uptime: Math.floor(process.uptime()),
            sessions: sessions.size,
            environment: config.server.environment,
            memory: process.memoryUsage(),
            logging: Logger.getStats(),
            errors: ErrorHandler.getErrorStats()
        };
        
        res.status(200).json(healthData);
    } catch (error) {
        Logger.error('Health check failed', error);
        res.status(500).json({
            status: 'unhealthy',
            error: 'Health check failed'
        });
    }
});

// Ping endpoint for testing
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

function broadcast(data) {
    const clientCount = wss.clients.size;
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            try {
                client.send(JSON.stringify(data));
            } catch (error) {
                Logger.error('Failed to broadcast to client', error);
            }
        }
    });
    
    if (clientCount > 0) {
        Logger.debug(`Broadcasted to ${clientCount} WebSocket clients`, null, { type: data.type });
    }
}

function log(message, sessionId = 'SYSTEM') {
    Logger.info(message, sessionId);
    
    broadcast({
        type: 'log',
        sessionId,
        message,
        timestamp: new Date().toISOString()
    });
}

async function postToWebhook(data) {
    const webhookUrl = getWebhookUrl();
    if (!webhookUrl) return;

    const startTime = Date.now();
    try {
        const response = await axios.post(webhookUrl, data, {
            headers: { 'Content-Type': 'application/json' },
            timeout: config.webhook.timeout
        });
        
        const duration = Date.now() - startTime;
        Logger.webhook(webhookUrl, data, response);
        Logger.performance('webhook_delivery', duration);
        return response;
    } catch (error) {
        const duration = Date.now() - startTime;
        Logger.webhook(webhookUrl, data, null, error);
        Logger.performance('webhook_delivery_failed', duration);
        throw error;
    }
}

function updateSessionState(sessionId, status, detail, qr, reason) {
    try {
        const oldSession = sessions.get(sessionId) || {};
        const newSession = {
            ...oldSession,
            sessionId: sessionId,
            status,
            detail,
            qr,
            reason,
            lastUpdate: new Date().toISOString()
        };
        sessions.set(sessionId, newSession);

        Logger.session(sessionId, `Status updated: ${status} - ${detail}`);
        broadcast({ type: 'session-update', data: getSessionsDetails() });

        postToWebhook({
            event: 'session-status',
            sessionId,
            status,
            detail,
            reason,
            timestamp: new Date().toISOString()
        }).catch(err => {
            Logger.error('Webhook delivery failed for session update', err, sessionId);
        });
    } catch (error) {
        Logger.error('Failed to update session state', error, sessionId);
    }
}

async function connectToWhatsApp(sessionId) {
    const startTime = Date.now();
    
    try {
        updateSessionState(sessionId, 'CONNECTING', 'Initializing session...', '', '');
        Logger.session(sessionId, 'Starting WhatsApp connection');

        const sessionDir = path.join(config.storage.authDir, sessionId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        Logger.session(sessionId, `Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS(config.whatsapp.browser),
            generateHighQualityLinkPreview: config.whatsapp.generateHighQualityPreviews,
            shouldIgnoreJid: (jid) => isJidBroadcast(jid),
            qrTimeout: config.whatsapp.qrTimeout,
        });
        
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.key.fromMe) {
                    Logger.session(sessionId, `Received message from ${msg.key.remoteJid}`);
                    
                    const messageData = {
                        event: 'new-message',
                        sessionId,
                        from: msg.key.remoteJid,
                        messageId: msg.key.id,
                        timestamp: msg.messageTimestamp,
                        data: msg
                    };
                    
                    await postToWebhook(messageData).catch(err => {
                        Logger.error('Failed to deliver message webhook', err, sessionId);
                    });
                }
            } catch (error) {
                Logger.error('Error processing incoming message', error, sessionId);
            }
        });

        sock.ev.on('connection.update', (update) => {
            try {
                const { connection, lastDisconnect, qr } = update;
                const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;

                Logger.session(sessionId, `Connection update: ${connection}, status code: ${statusCode}`);

                if (qr) {
                    Logger.session(sessionId, 'QR code generated');
                    updateSessionState(sessionId, 'GENERATING_QR', 'QR code available.', qr, '');
                }

                if (connection === 'close') {
                    const error = lastDisconnect?.error;
                    const whatsappError = ErrorHandler.handleWhatsAppError(error, sessionId);
                    const shouldReconnect = statusCode !== 401 && statusCode !== 403;
                    
                    Logger.session(sessionId, `Connection closed. Reconnecting: ${shouldReconnect}`, 'warn');
                    updateSessionState(sessionId, 'DISCONNECTED', 'Connection closed.', '', whatsappError.message);

                    if (shouldReconnect) {
                        setTimeout(() => connectToWhatsApp(sessionId), config.whatsapp.reconnectDelay);
                    } else {
                        Logger.session(sessionId, 'Not reconnecting due to fatal error. Session data will be cleared.', 'error');
                        const sessionDir = path.join(config.storage.authDir, sessionId);
                        if (fs.existsSync(sessionDir)) {
                            fs.rmSync(sessionDir, { recursive: true, force: true });
                            Logger.session(sessionId, 'Session data cleared');
                        }
                    }
                } else if (connection === 'open') {
                    const duration = Date.now() - startTime;
                    Logger.session(sessionId, `Connection established successfully in ${duration}ms`);
                    Logger.performance('whatsapp_connection', duration, sessionId);
                    updateSessionState(sessionId, 'CONNECTED', `Connected as ${sock.user?.name || 'Unknown'}`, '', '');
                }
            } catch (error) {
                Logger.error('Error handling connection update', error, sessionId);
            }
        });

        sessions.get(sessionId).sock = sock;
    } catch (error) {
        Logger.error('Failed to initialize WhatsApp session', error, sessionId);
        updateSessionState(sessionId, 'ERROR', 'Failed to initialize', '', error.message);
        throw new ErrorHandler.WhatsAppError(`Failed to initialize session ${sessionId}: ${error.message}`, sessionId);
    }
}

function getSessionsDetails() {
    try {
        return Array.from(sessions.values()).map(s => ({
            sessionId: s.sessionId,
            status: s.status,
            detail: s.detail,
            qr: s.qr,
            lastUpdate: s.lastUpdate,
            token: sessionTokens.get(s.sessionId) || null
        }));
    } catch (error) {
        Logger.error('Failed to get sessions details', error);
        throw new ErrorHandler.WhatsAppError('Failed to retrieve sessions details');
    }
}

// API Endpoints
app.get('/sessions', ErrorHandler.handleAsync(async (req, res) => {
    const sessions = getSessionsDetails();
    res.json(sessions);
}));

async function createSession(sessionId) {
    try {
        if (sessions.has(sessionId)) {
            throw new ErrorHandler.ConflictError('Session already exists');
        }
        
        const token = randomUUID();
        sessionTokens.set(sessionId, token);
        saveTokens();
        
        sessions.set(sessionId, { 
            sessionId: sessionId, 
            status: 'CREATING', 
            detail: 'Session is being created.',
            lastUpdate: new Date().toISOString()
        });
        
        Logger.info(`Creating new session: ${sessionId}`);
        connectToWhatsApp(sessionId);
        return { status: 'success', message: `Session ${sessionId} created.`, token };
    } catch (error) {
        Logger.error(`Failed to create session ${sessionId}`, error);
        throw error;
    }
}

app.get('/sessions/:sessionId/qr', ErrorHandler.handleAsync(async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        throw new ErrorHandler.NotFoundError('Session not found');
    }
    
    Logger.session(sessionId, 'QR code requested by user');
    updateSessionState(sessionId, 'GENERATING_QR', 'QR code requested by user.', '', '');
    res.status(200).json({ message: 'QR generation triggered.' });
}));

async function deleteSession(sessionId) {
    try {
        const session = sessions.get(sessionId);
        if (session && session.sock) {
            try {
                await session.sock.logout();
                Logger.session(sessionId, 'WhatsApp logout completed');
            } catch (error) {
                Logger.error('Error during WhatsApp logout', error, sessionId);
            }
        }
        
        sessions.delete(sessionId);
        sessionTokens.delete(sessionId);
        saveTokens();
        
        const sessionDir = path.join(config.storage.authDir, sessionId);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
        
        Logger.info(`Session ${sessionId} deleted and data cleared`);
        broadcast({ type: 'session-update', data: getSessionsDetails() });
    } catch (error) {
        Logger.error(`Failed to delete session ${sessionId}`, error);
        throw new ErrorHandler.WhatsAppError(`Failed to delete session ${sessionId}: ${error.message}`);
    }
}

// Error handlers (must be last)
app.use(ErrorHandler.notFoundHandler());
app.use(ErrorHandler.globalErrorHandler());

async function initializeExistingSessions() {
    try {
        if (fs.existsSync(config.storage.authDir)) {
            const sessionFolders = fs.readdirSync(config.storage.authDir);
            Logger.info(`Found ${sessionFolders.length} existing session(s). Initializing...`);
            
            for (const sessionId of sessionFolders) {
                const sessionPath = path.join(config.storage.authDir, sessionId);
                if (fs.statSync(sessionPath).isDirectory()) {
                    Logger.info(`Re-initializing session: ${sessionId}`);
                    await createSession(sessionId);
                }
            }
        }
    } catch (error) {
        Logger.error('Failed to initialize existing sessions', error);
    }
}

const PORT = config.server.port;

server.listen(PORT, () => {
    Logger.info(`🚀 Server is running on port ${PORT}`);
    Logger.info(`🌍 Environment: ${config.server.environment}`);
    Logger.info(`📊 Admin dashboard: http://localhost:${PORT}/admin/dashboard.html`);
    Logger.info(`🔑 Health check: http://localhost:${PORT}/health`);
    
    loadTokens();
    initializeExistingSessions();
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
    Logger.info(`${signal} received, shutting down gracefully`);
    
    server.close(() => {
        Logger.info('HTTP server closed');
        
        // Close all WebSocket connections
        wss.clients.forEach(client => {
            client.close();
        });
        
        // Logout all WhatsApp sessions
        const logoutPromises = Array.from(sessions.values()).map(session => {
            if (session.sock) {
                return session.sock.logout().catch(err => {
                    Logger.error('Error during session logout', err, session.sessionId);
                });
            }
        });
        
        Promise.all(logoutPromises).finally(() => {
            Logger.info('All sessions logged out');
            process.exit(0);
        });
    });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    Logger.error('Uncaught Exception', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    Logger.error('Unhandled Rejection', new Error(reason), null, { promise });
});

module.exports = { app };
