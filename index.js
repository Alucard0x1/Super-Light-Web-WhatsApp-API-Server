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
    if (global.gc) {
        setInterval(() => global.gc(), 60000);
    }
}

require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import new modules
const { db } = require('./src/config/database');
const { User, Session, ActivityLog } = require('./src/models');
const { encrypt, decrypt, isValidKey } = require('./src/utils/crypto');
const response = require('./src/utils/response');
const whatsappService = require('./src/services/whatsapp');
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
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket clients map
const wsClients = new Map();

// Session configuration
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';

if (isProduction && !process.env.SESSION_SECRET) {
    console.error('FATAL: SESSION_SECRET environment variable is required in production mode!');
    process.exit(1);
}

const sessionStore = new FileStore({
    path: './sessions',
    ttl: 86400,
    retries: 0,
    secret: sessionSecret,
    logFn: () => { }
});

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

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
        secure: process.env.COOKIE_SECURE === 'true', // Only use secure cookies if explicitly enabled or on HTTPS
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// WebSocket handler
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const wsToken = url.searchParams.get('token');

    let userInfo = null;
    // TODO: Validate wsToken against session

    wsClients.set(ws, userInfo);

    ws.on('close', () => {
        wsClients.delete(ws);
    });
});

// Broadcast to all WebSocket clients
function broadcastToClients(data) {
    const message = JSON.stringify(data);
    for (const [client] of wsClients) {
        if (client.readyState === 1) {
            client.send(message);
        }
    }
}

// Mount new routes
app.use('/admin', authRoutes);
app.use('/admin/users', userRoutes);

// Static pages
app.get('/api-documentation', (req, res) => {
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

// Initialize wrappers for API
const sessionTokens = new Map();

const log = (message, context, details) => {
    console.log(`[${context || 'SYSTEM'}] ${message}`, details || '');
};

const userManager = {
    getSessionOwner: (sessionId) => {
        const s = Session.findById(sessionId);
        return s ? { email: s.owner_email } : null;
    }
};

// Dummy functions for overlap routes (handled by index.js primarily)
const createSessionWrapper = async (sessionId, email) => { /* handled by index.js route */ };
const deleteSessionWrapper = async (sessionId) => { /* handled by index.js route */ };
const getSessionsDetailsWrapper = () => [];

// Session Proxy to adapt whatsappService sockets (Map<string, Socket>) to api.js expectation ({ sock, status })
const sessionsProxy = {
    get: (sessionId) => {
        const sock = whatsappService.getSocket(sessionId);
        if (sock) {
            return {
                sock: sock,
                status: 'CONNECTED' // whatsappService only keeps active sockets
            };
        }
        return null;
    },
    forEach: (callback) => {
        whatsappService.getActiveSessions().forEach((sock, sessionId) => {
            callback({
                sock: sock,
                status: 'CONNECTED',
                owner: 'unknown', // not available in socket
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
    ActivityLog
);


// WhatsApp session management endpoints
app.get('/api/v1/sessions', (req, res) => {
    if (!req.session?.adminAuthed) {
        return response.unauthorized(res);
    }

    const sessions = Session.getAll(req.session.userEmail, req.session.userRole === 'admin');
    const activeSockets = whatsappService.getActiveSessions();

    // Enrich with live status and map id -> sessionId
    const enriched = sessions.map(s => ({
        ...s,
        sessionId: s.id, // Frontend expects sessionId
        isConnected: activeSockets.has(s.id)
    }));

    return response.success(res, enriched);
});

app.post('/api/v1/sessions', async (req, res) => {
    if (!req.session?.adminAuthed) {
        return response.unauthorized(res);
    }

    const { sessionId } = req.body;
    if (!sessionId) {
        return response.validationError(res, ['sessionId is required']);
    }

    try {
        // Create session in database
        const session = Session.create(sessionId, req.session.userEmail);

        // Add sessionId alias for frontend compatibility
        const responseSession = { ...session, sessionId: session.id };

        // Connect to WhatsApp
        whatsappService.connect(sessionId, (id, status, detail, qr) => {
            Session.updateStatus(id, status, detail);
            broadcastToClients({
                type: 'session-update',
                data: { sessionId: id, status, detail, qr }
            });
        }, null);

        // Update sessionTokens map
        if (session.token) {
            sessionTokens.set(sessionId, session.token);
        }

        ActivityLog.logSessionCreate(req.session.userEmail, sessionId, req.ip, req.headers['user-agent']);

        return response.success(res, responseSession, 201);
    } catch (err) {
        if (err.message === 'Session already exists') {
            return response.error(res, 'Session already exists', 409);
        }
        throw err;
    }
});

app.delete('/api/v1/sessions/:sessionId', (req, res) => {
    if (!req.session?.adminAuthed) {
        return response.unauthorized(res);
    }

    const { sessionId } = req.params;

    whatsappService.deleteSessionData(sessionId);
    sessionTokens.delete(sessionId);
    ActivityLog.logSessionDelete(req.session.userEmail, sessionId, req.ip, req.headers['user-agent']);

    broadcastToClients({
        type: 'session-deleted',
        data: { sessionId }
    });

    return response.success(res, { message: 'Session deleted' });
});

// Mount API router (Last, so it doesn't shadow explicit index.js routes)
app.use('/api/v1', apiRouter);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Ensure default admin exists
User.ensureAdmin(process.env.ADMIN_DASHBOARD_PASSWORD);

// Initialize existing sessions on startup
(async () => {
    // Sync sessions from disk to DB
    Session.syncWithFilesystem();

    const existingSessions = Session.getAll();
    console.log(`[SYSTEM] Found ${existingSessions.length} existing session(s)`);

    for (const session of existingSessions) {
        // Populate sessionTokens
        if (session.token) {
            sessionTokens.set(session.id, session.token);
        }

        if (session.status === 'CONNECTED' || session.status === 'DISCONNECTED') {
            console.log(`[SYSTEM] Re-initializing session: ${session.id}`);
            whatsappService.connect(session.id, (id, status, detail, qr) => {
                Session.updateStatus(id, status, detail);
                broadcastToClients({
                    type: 'session-update',
                    data: { sessionId: id, status, detail, qr }
                });
            }, null);
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
process.on('SIGINT', () => {
    console.log('\n[SYSTEM] Shutting down...');

    // Disconnect all WhatsApp sessions
    for (const [sessionId] of whatsappService.getActiveSessions()) {
        whatsappService.disconnect(sessionId);
    }

    server.close(() => {
        console.log('[SYSTEM] Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, wss };
