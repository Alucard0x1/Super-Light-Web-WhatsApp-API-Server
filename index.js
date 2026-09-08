/*
 * Super-Light-Web-WhatsApp-API-Server
 *
 * Original Creator: Alucard0x1
 * Original Repository:
 * https://github.com/Alucard0x1/Super-Light-Web-WhatsApp-API-Server
 *
 * Copyright (c) 2026 Alucard0x1
 * Licensed under the MIT License.
 * See LICENSE for details.
 */

/**
 * WhatsApp API Server - Main Entry Point
 * Version 3.2.0
 *
 * This is the refactored entry point using the new modular architecture.
 * All business logic has been moved to src/ directory.
 */

// Memory optimization for production environments
if (process.env.NODE_ENV === 'production') {
    if (!process.env.NODE_OPTIONS) {
        process.env.NODE_OPTIONS = '--max-old-space-size=1024';
    }
}

require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const cookie = require('cookie');
const cookieSignature = require('cookie-signature');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import new modules
const { db } = require('./src/config/database');
const { User, Session, ActivityLog } = require('./src/models');
const { isValidKey } = require('./src/utils/crypto');
const response = require('./src/utils/response');
const whatsappService = require('./src/services/whatsapp');
const { dispatchWebhook, getWebhookUrl } = require('./src/services/webhook');
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');

// API v1 (includes legacy endpoints)
const { initializeApi } = require('./src/routes/api');

// Validate encryption key
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || !isValidKey(ENCRYPTION_KEY)) {
    console.error('FATAL: TOKEN_ENCRYPTION_KEY must be at least 64 hexadecimal characters!');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

// Initialize Express
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// API bearer tokens are retained only for legacy token-authenticated routes.
// They are never used to authenticate dashboard WebSockets.
const sessionTokens = new Map();
// WebSocket clients map
const wsClients = new Map();

// Session configuration
const isProduction = process.env.NODE_ENV === 'production';

const WEAK_SECRETS = new Set([
    'dev-secret-change-me',
    'random_secret_key_here',
    'secret',
    'changeme',
    'change-me',
    'your_secret_key',
    'yourpassword'
]);

if (isProduction) {
    if (!process.env.SESSION_SECRET) {
        console.error('FATAL: SESSION_SECRET environment variable is required in production mode!');
        process.exit(1);
    }
    if (process.env.SESSION_SECRET.length < 32 || WEAK_SECRETS.has(process.env.SESSION_SECRET)) {
        console.error('FATAL: SESSION_SECRET is too weak. Use at least 32 random characters.');
        console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
        process.exit(1);
    }
    if (process.env.ADMIN_DASHBOARD_PASSWORD &&
        WEAK_SECRETS.has(process.env.ADMIN_DASHBOARD_PASSWORD.toLowerCase())) {
        console.error('FATAL: ADMIN_DASHBOARD_PASSWORD is set to a known weak default. Change it before running in production.');
        process.exit(1);
    }
} else if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.warn('[SECURITY] Using default/weak SESSION_SECRET. Set a strong SESSION_SECRET (>= 32 chars) before deploying.');
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';

const configuredSessionHours = Number.parseFloat(process.env.SESSION_TIMEOUT_HOURS || '24');
const sessionTimeoutHours = Number.isFinite(configuredSessionHours) && configuredSessionHours > 0
    ? configuredSessionHours
    : 24;
const sessionTtlSeconds = Math.ceil(sessionTimeoutHours * 60 * 60);
const sessionCookieMaxAge = sessionTtlSeconds * 1000;
const sessionsDir = path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
}
const sessionStore = new FileStore({
    path: sessionsDir,
    ttl: sessionTtlSeconds,
    // Windows: rename collisions with concurrent reads return EPERM; retry
    // instead of surfacing 500s (retries: 0 caused intermittent request failures)
    retries: 5,
    secret: sessionSecret,
    logFn: () => { }
});
// Session files contain auth state and user identity — restrict permissions
if (process.platform !== 'win32') {
    try {
        fs.chmodSync(sessionsDir, 0o700);
    } catch (err) {
        console.warn('[Session] Could not restrict sessions dir permissions:', err.message);
    }
}

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { status: 'error', message: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }
}));

app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        // Secure cookies by default in production (opt-out via COOKIE_SECURE=false)
        secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProduction,
        sameSite: 'lax',
        maxAge: sessionCookieMaxAge
    }
}));

// Same-origin enforcement for state-changing requests (CSRF defense).
// Browsers always send an Origin header on cross-site requests; API clients
// (curl, scripts) typically send none and are unaffected.
app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    try {
        if (new URL(origin).host === req.headers.host) return next();
    } catch (err) {
        // invalid Origin -> reject below
    }
    return response.error(res, 'Cross-origin request rejected', 403);
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Kept for existing probes and upgraded tests.
app.get('/ping', (req, res) => {
    res.type('text/plain').send('pong');
});

app.use((req, res, next) => {
    if (process.env.MAINTENANCE_MODE !== 'true') return next();
    if (req.path === '/health' || req.path === '/ping' || req.path.startsWith('/admin/login')) {
        return next();
    }
    if (req.session?.adminAuthed && req.session.userRole === 'admin') return next();
    return response.error(res, 'Service is in maintenance mode', 503);
});

// Load a session from the FileStore using the connect.sid cookie.
// WebSocket upgrade requests do not pass through the express-session middleware,
// so the cookie must be validated manually here (mirrors express-session's
// getcookie(): strip the 's:' prefix, then unsign the session ID).
function loadSessionFromRequest(req) {
    return new Promise((resolve) => {
        const cookies = cookie.parse(req.headers.cookie || '');
        const raw = cookies['connect.sid'];
        if (!raw) return resolve(null);
        const unsigned = raw.startsWith('s:')
            ? cookieSignature.unsign(raw.slice(2), sessionSecret)
            : false;
        if (!unsigned) return resolve(null);
        sessionStore.get(unsigned, (err, sessionData) => {
            if (err || !sessionData) return resolve(null);
            resolve({ sid: unsigned, session: sessionData });
        });
    });
}

// WebSocket handler — authenticated clients only
wss.on('connection', (ws, req) => {
    // Any parse/validation failure rejects the connection; never throw.
    try {
        // Cross-site WebSocket hijack protection: reject foreign Origins
        const origin = req.headers.origin;
        if (origin) {
            let originHost = null;
            try {
                originHost = new URL(origin).host;
            } catch (err) {
                ws.close(1008, 'Invalid Origin header');
                return;
            }
            if (originHost !== req.headers.host) {
                ws.close(1008, 'Cross-origin WebSocket connections are not allowed');
                return;
            }
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const wsToken = url.searchParams.get('token');

        let userInfo = null;

        const authenticate = (sessionData) => {
            // 1. Authenticated dashboard session (cookie)
            if (sessionData && sessionData.session.adminAuthed) {
                return { sessionId: sessionData.sid, type: 'session' };
            }
            // 2. Session-scoped token issued by GET /admin/ws-token
            if (wsToken && sessionData && sessionData.session.wsToken === wsToken) {
                return { sessionId: sessionData.sid, type: 'ws-token' };
            }
            // 3. Legacy API bearer token (kept for legacy token-authenticated clients)
            if (wsToken) {
                for (const [sessionId, token] of sessionTokens) {
                    if (token === wsToken) {
                        return { sessionId, type: 'session-token' };
                    }
                }
            }
            return null;
        };

        loadSessionFromRequest(req).then((sessionData) => {
            // Client may have disconnected while the session store was queried
            if (ws.readyState === 2 /* CLOSING */ || ws.readyState === 3 /* CLOSED */) return;
            userInfo = authenticate(sessionData);
            if (!userInfo) {
                ws.close(1008, 'Unauthorized');
                return;
            }
            wsClients.set(ws, userInfo);
        }).catch((err) => {
            console.error('[WebSocket] Session validation error:', err.message);
            ws.close(1011, 'Session validation failed');
        });
    } catch (err) {
        console.error('[WebSocket] Handshake error:', err.message);
        ws.close(1011, 'Handshake failed');
    }

    ws.on('close', () => {
        wsClients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error.message);
        wsClients.delete(ws);
    });
});

// Broadcast to all authenticated WebSocket clients
function broadcastToClients(data) {
    const message = JSON.stringify(data);
    for (const [client] of wsClients) {
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}

// --- Webhook dispatch (fire-and-forget) ---

function dispatchSessionWebhook(sessionId, status, detail) {
    const webhookUrl = getWebhookUrl(sessionId);
    if (!webhookUrl) return;
    dispatchWebhook(webhookUrl, 'session.update', sessionId, { status, detail })
        .catch(err => console.error(`[Webhook] session.update failed for ${sessionId}:`, err.message));
}

function dispatchMessageWebhook(sessionId, msg) {
    const webhookUrl = getWebhookUrl(sessionId);
    if (!webhookUrl) return;
    let text = '';
    const message = msg.message;
    if (message) {
        if (message.conversation) text = message.conversation;
        else if (message.extendedTextMessage && message.extendedTextMessage.text) text = message.extendedTextMessage.text;
    }
    const payload = {
        from: msg.key && msg.key.remoteJid,
        text,
        type: message ? Object.keys(message)[0] : 'unknown'
    };
    dispatchWebhook(webhookUrl, 'message.received', sessionId, payload)
        .catch(err => console.error(`[Webhook] message.received failed for ${sessionId}:`, err.message));
}

// Mount new routes
app.use('/admin', authRoutes);
app.use('/admin/users', userRoutes);
app.use('/api/v1/auto-replies', require('./src/routes/autoReply'));
app.use('/api/v1/chats', require('./src/routes/chats'));
app.use('/api/v1/analytics', require('./src/routes/analytics'));

const { requireAuth } = require('./src/middleware/auth');

// System log history persistence (dashboard "System Log History" UI)
const systemLogFile = path.join(__dirname, 'logs', 'system_logs.json');

// requireAuth re-syncs req.session.userRole from the users table, so a demoted
// admin loses access to these routes on the next request.
app.get('/admin/logs', requireAuth, (req, res) => {
    if (req.session.userRole !== 'admin') {
        return response.forbidden(res, 'Admin access required');
    }
    try {
        if (fs.existsSync(systemLogFile)) {
            const logs = JSON.parse(fs.readFileSync(systemLogFile, 'utf-8'));
            res.json({ status: 'success', logs: Array.isArray(logs) ? logs : [] });
        } else {
            res.json({ status: 'success', logs: [] });
        }
    } catch (err) {
        res.json({ status: 'success', logs: [] });
    }
});

app.post('/admin/update-logs', requireAuth, (req, res) => {
    if (req.session.userRole !== 'admin') {
        return response.forbidden(res, 'Admin access required');
    }
    const logs = req.body && req.body.logs;
    if (!Array.isArray(logs)) {
        return response.error(res, 'logs must be an array', 400);
    }
    // Cap size and normalize entries before persisting
    const safeLogs = logs.slice(-5000).map(log => ({
        type: 'log',
        timestamp: typeof log.timestamp === 'string' ? log.timestamp.slice(0, 40) : new Date().toISOString(),
        sessionId: typeof log.sessionId === 'string' ? log.sessionId.slice(0, 128) : 'SYSTEM',
        message: typeof log.message === 'string' ? log.message.slice(0, 4000) : '',
        level: ['INFO', 'WARN', 'ERROR', 'DEBUG'].includes(log.level) ? log.level : 'INFO',
        details: log.details && typeof log.details === 'object' ? log.details : null
    }));
    try {
        const logsDir = path.dirname(systemLogFile);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        fs.writeFileSync(systemLogFile, JSON.stringify(safeLogs));
        if (process.platform !== 'win32') {
            try { fs.chmodSync(systemLogFile, 0o600); } catch (err) { /* best effort */ }
        }
        res.json({ status: 'success' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Failed to write log file' });
    }
});

// Static pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api-documentation', (req, res) => {
    res.sendFile(path.join(__dirname, 'api_documentation.html'));
});

app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'api_documentation.html'));
});

app.get('/admin/login.html', (req, res) => {
    if (req.session?.adminAuthed) {
        return res.redirect('/admin/dashboard.html');
    }
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/admin/dashboard.html', (req, res) => {
    if (!req.session?.adminAuthed) {
        return res.redirect('/admin/login.html');
    }
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// Serve remaining admin pages/assets with server-side auth for HTML pages
app.use('/admin', (req, res, next) => {
    const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)$/i.test(req.path);
    if (isAsset || req.path === '/login.html') return next();
    if (!req.session?.adminAuthed) {
        return res.redirect('/admin/login.html');
    }
    next();
});
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Uploaded media: require a valid session or session bearer token
app.use('/media', (req, res, next) => {
    if (req.session?.adminAuthed) return next();
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.split(' ')[1];
    if (token && Array.from(sessionTokens.values()).includes(token)) return next();
    return response.error(res, 'Authentication required', 401);
});
app.use('/media', express.static(path.join(__dirname, 'media'), {
    fallthrough: false,
    maxAge: '1h',
    setHeaders: (res) => {
        res.setHeader('Content-Disposition', 'inline');
    }
}));

const saveLogToDisk = (logObject) => {
    try {
        const logsDir = path.dirname(systemLogFile);
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        let logs = [];
        if (fs.existsSync(systemLogFile)) {
            try {
                logs = JSON.parse(fs.readFileSync(systemLogFile, 'utf-8'));
                if (!Array.isArray(logs)) logs = [];
            } catch (e) { logs = []; }
        }
        logs.push(logObject);
        if (logs.length > 5000) logs = logs.slice(-5000);
        fs.writeFileSync(systemLogFile, JSON.stringify(logs, null, 2));
    } catch (err) {
        console.error('[SystemLog] Failed to persist log:', err.message);
    }
};

const log = (message, context, details, level) => {
    // Determine level if not provided (heuristic)
    if (!level) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('error') || lowerMsg.includes('fail')) level = 'ERROR';
        else if (lowerMsg.includes('warn')) level = 'WARN';
        else level = 'INFO';
    }

    const logObject = {
        type: 'log',
        timestamp: new Date().toISOString(),
        sessionId: context || 'SYSTEM',
        message: message,
        level: level,
        details: details || null
    };

    // Print to console
    console.log(`[${logObject.timestamp}] [${logObject.level}] [${logObject.sessionId}] ${message}`, details || '');

    // Persist to disk for System Log History UI
    saveLogToDisk(logObject);

    // Broadcast to all connected dashboard clients
    broadcastToClients(logObject);
};

const userManager = {
    getSessionOwner: (sessionId) => {
        const s = Session.findById(sessionId);
        return s ? { email: s.owner_email } : null;
    }
};

const createSessionWrapper = async (sessionId, email) => {
    let session = Session.findById(sessionId);
    if (!session) {
        session = Session.create(sessionId, email);
    }

    if (session.token) {
        sessionTokens.set(sessionId, session.token);
    }

    await whatsappService.connect(sessionId, (id, status, detail, qr) => {
        broadcastToClients({
            type: 'session-update',
            data: { sessionId: id, status, detail, qr }
        });
        dispatchSessionWebhook(id, status, detail);
    }, (id, msg) => {
        dispatchMessageWebhook(id, msg);
    });

    return session;
};

const deleteSessionWrapper = async (sessionId) => {
    whatsappService.deleteSessionData(sessionId);
    sessionTokens.delete(sessionId);
};

const getSessionsDetailsWrapper = (ownerEmail, isAdmin = false) => (
    Session.getAll(ownerEmail, isAdmin).map(session => {
        const details = {
            ...session,
            sessionId: session.id,
            isConnected: whatsappService.isConnected(session.id),
            qr: whatsappService.getQr(session.id) || null
        };
        // Public listings (no owner filter, not admin) must never expose bearer tokens
        if (!ownerEmail && !isAdmin) {
            delete details.token;
        }
        return details;
    })
);

// Session Proxy to adapt whatsappService sockets (Map<string, Socket>) to api.js expectation ({ sock, status })
const sessionsProxy = {
    get: (sessionId) => {
        const sock = whatsappService.getSocket(sessionId);
        if (sock) {
            // Look up session owner from database
            const dbSession = Session.findById(sessionId);
            return {
                sock: sock,
                status: whatsappService.isConnected(sessionId) ? 'CONNECTED' : (dbSession?.status || 'CONNECTING'),
                owner: dbSession ? dbSession.owner_email : 'unknown'
            };
        }
        return null;
    },
    has: (sessionId) => {
        return whatsappService.getActiveSessions().has(sessionId);
    },
    keys: () => {
        return Array.from(whatsappService.getActiveSessions().keys());
    },
    forEach: (callback) => {
        whatsappService.getActiveSessions().forEach((sock, sessionId) => {
            // Look up session owner from database
            const dbSession = Session.findById(sessionId);
            callback({
                sock: sock,
                status: whatsappService.isConnected(sessionId) ? 'CONNECTED' : (dbSession?.status || 'CONNECTING'),
                owner: dbSession ? dbSession.owner_email : 'unknown',
                detail: 'Connected via proxy'
            }, sessionId);
        });
    }
};

const apiRouter = initializeApi(
    sessionsProxy,
    sessionTokens,
    createSessionWrapper,
    getSessionsDetailsWrapper,
    deleteSessionWrapper,
    log,
    userManager,
    ActivityLog,
    broadcastToClients
);

// Note: Session management endpoints (GET/POST/DELETE /api/v1/sessions, /api/v1/sessions/:sessionId/qr)
// are now handled by src/routes/api.js which supports both dashboard session auth and token-based API access.
// The apiRouter is mounted below at /api/v1.

// Mount API router (Last, so it doesn't shadow explicit index.js routes)
app.use('/api/v1', apiRouter);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Campaign scheduler: auto-start campaigns whose scheduledAt has passed
const schedulerInterval = setInterval(async () => {
    try {
        if (apiRouter && typeof apiRouter.checkAndStartScheduledCampaigns === 'function') {
            await apiRouter.checkAndStartScheduledCampaigns();
        }
    } catch (err) {
        console.error('[Scheduler] check error:', err.message);
    }
}, 60 * 1000);
if (typeof schedulerInterval.unref === 'function') schedulerInterval.unref();

// Initialize existing sessions on startup
(async () => {
    // Ensure default admin exists
    await User.ensureAdmin(process.env.ADMIN_DASHBOARD_PASSWORD);

    // Sync sessions from disk to DB
    Session.syncWithFilesystem();

    const existingSessions = Session.getAll();
    console.log(`[SYSTEM] Found ${existingSessions.length} existing session(s)`);

    for (const session of existingSessions) {
        // Populate sessionTokens
        if (session.token) {
            sessionTokens.set(session.id, session.token);
        }

        // Re-initialize any session that was previously connected, disconnected, or stuck in connecting
        const statusesToReinit = ['CONNECTED', 'DISCONNECTED', 'CONNECTING', 'INITIALIZING'];
        if (statusesToReinit.includes(session.status)) {
            console.log(`[SYSTEM] Re-initializing session: ${session.id} (last status: ${session.status})`);

            // Reset status to DISCONNECTED briefly to ensure a clean slate for Baileys
            Session.updateStatus(session.id, 'DISCONNECTED', 'Restarting...');

            whatsappService.connect(session.id, (id, status, detail, qr) => {
                Session.updateStatus(id, status, detail);
                broadcastToClients({
                    type: 'session-update',
                    data: { sessionId: id, status, detail, qr }
                });
                dispatchSessionWebhook(id, status, detail);
            }, (id, msg) => {
                dispatchMessageWebhook(id, msg);
            });
        }
    }
})();

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[SYSTEM] Server is running on port ${PORT}`);
    console.log(`[SYSTEM] Admin dashboard: http://localhost:${PORT}/admin/dashboard.html`);
});

// Graceful shutdown
let isShuttingDown = false;
process.on('SIGINT', () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\n[SYSTEM] Shutting down...');

    clearInterval(schedulerInterval);

    // Disconnect all WhatsApp sessions first
    for (const [sessionId] of whatsappService.getActiveSessions()) {
        try {
            whatsappService.disconnect(sessionId);
        } catch (err) {
            console.error(`[SYSTEM] Error disconnecting session ${sessionId}:`, err.message);
        }
    }

    // Close WebSocket server
    wss.close(() => {
        console.log('[SYSTEM] WebSocket server closed');
    });

    // Close HTTP server
    server.close(() => {
        console.log('[SYSTEM] HTTP server closed');

        // Close database connection last
        try {
            db.close();
            console.log('[SYSTEM] Database connection closed');
        } catch (err) {
            console.error('[SYSTEM] Error closing database:', err.message);
        }

        process.exit(0);
    });

    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
        console.error('[SYSTEM] Force exiting after timeout...');
        process.exit(1);
    }, 10000);
});

module.exports = { app, server, wss };
