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
const { initializeApi, apiToken, getWebhookUrl } = require('./api_v1');
const { initializeLegacyApi } = require('./legacy_api');
const { randomUUID } = require('crypto');
const crypto = require('crypto'); // Add crypto for encryption
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const session = require('express-session');

const sessions = new Map();
const retries = new Map();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const logger = pino({ level: 'debug' });

const TOKENS_FILE = path.join(__dirname, 'session_tokens.json');
const ENCRYPTED_TOKENS_FILE = path.join(__dirname, 'session_tokens.enc');
let sessionTokens = new Map();

// Encryption key - MUST be stored in .env file
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
if (!process.env.TOKEN_ENCRYPTION_KEY) {
    console.warn('⚠️  WARNING: Using random encryption key. Set TOKEN_ENCRYPTION_KEY in .env file!');
    console.warn(`Add this to your .env file: TOKEN_ENCRYPTION_KEY=${ENCRYPTION_KEY}`);
}

// Encryption functions
function encrypt(text) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

// Enhanced token management with encryption
function saveTokens() {
    try {
        const tokensToSave = Object.fromEntries(sessionTokens);
        const jsonString = JSON.stringify(tokensToSave, null, 2);
        const encrypted = encrypt(jsonString);
        
        fs.writeFileSync(ENCRYPTED_TOKENS_FILE, encrypted, 'utf-8');
        
        // Set file permissions (read/write for owner only)
        if (process.platform !== 'win32') {
            fs.chmodSync(ENCRYPTED_TOKENS_FILE, 0o600);
        }
        
        // Keep backward compatibility - save plain JSON but with warning
        if (fs.existsSync(TOKENS_FILE)) {
            fs.unlinkSync(TOKENS_FILE); // Remove old plain file
        }
    } catch (error) {
        console.error('Error saving encrypted tokens:', error);
    }
}

function loadTokens() {
    try {
        // Try to load encrypted file first
        if (fs.existsSync(ENCRYPTED_TOKENS_FILE)) {
            const encrypted = fs.readFileSync(ENCRYPTED_TOKENS_FILE, 'utf-8');
            const decrypted = decrypt(encrypted);
            const tokensFromFile = JSON.parse(decrypted);
            
            sessionTokens.clear();
            for (const [key, value] of Object.entries(tokensFromFile)) {
                sessionTokens.set(key, value);
            }
            return;
        }
        
        // Fallback: migrate from old plain JSON file
        if (fs.existsSync(TOKENS_FILE)) {
            console.log('📦 Migrating plain tokens to encrypted format...');
            const tokensFromFile = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
            
            sessionTokens.clear();
            for (const [key, value] of Object.entries(tokensFromFile)) {
                sessionTokens.set(key, value);
            }
            
            // Save as encrypted and remove old file
            saveTokens();
            fs.unlinkSync(TOKENS_FILE);
            console.log('✅ Migration complete! Tokens are now encrypted.');
        }
    } catch (error) {
        console.error('Error loading tokens:', error);
        sessionTokens.clear();
    }
}

// Ensure media directory exists
const mediaDir = path.join(__dirname, 'media');
if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir);
}

app.use(express.json());
app.use(bodyParser.json());
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/media', express.static(mediaDir)); // Serve uploaded media
app.use(express.urlencoded({ extended: true }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'"]
      }
    }
  })
);
app.use(rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    message: { status: 'error', message: 'Too many requests, please try again later.' }
}));

const ADMIN_PASSWORD = process.env.ADMIN_DASHBOARD_PASSWORD;

// Session limits configuration
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS) || 10;
const SESSION_TIMEOUT_HOURS = parseInt(process.env.SESSION_TIMEOUT_HOURS) || 24;

app.use(session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false } // Set secure: true if using HTTPS
}));

// Admin login endpoint
app.post('/admin/login', express.json(), (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        req.session.adminAuthed = true;
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, message: 'Invalid password' });
});

// Middleware to protect admin dashboard
function requireAdminAuth(req, res, next) {
    if (req.session && req.session.adminAuthed) {
        return next();
    }
    res.status(401).sendFile(path.join(__dirname, 'admin', 'login.html'));
}

// Serve login page only if not authenticated
app.get('/admin/login.html', (req, res) => {
    if (req.session && req.session.adminAuthed) {
        return res.redirect('/admin/dashboard.html');
    }
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

// Protect dashboard and /admin route
app.get('/admin/dashboard.html', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});
app.get('/admin', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// Admin logout endpoint
app.post('/admin/logout', requireAdminAuth, (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true, redirect: '/admin/login.html' });
    });
});

// Test endpoint to verify log injection
app.get('/admin/test-logs', requireAdminAuth, (req, res) => {
    let logData = [];
    try {
        if (fs.existsSync(SYSTEM_LOG_FILE)) {
            const lines = fs.readFileSync(SYSTEM_LOG_FILE, 'utf-8').split('\n').filter(Boolean);
            const entries = lines.map(line => {
                try { return JSON.parse(line); } catch { return null; }
            }).filter(Boolean);
            logData = entries;
        }
    } catch (error) {
        console.error('Test endpoint error:', error);
    }
    res.json({ 
        logFileExists: fs.existsSync(SYSTEM_LOG_FILE),
        logCount: logData.length,
        logs: logData
    });
});

// Update logs endpoint
app.post('/admin/update-logs', requireAdminAuth, express.json(), (req, res) => {
    const { logs } = req.body;
    
    if (!Array.isArray(logs)) {
        return res.status(400).json({ error: 'Invalid logs data' });
    }
    
    try {
        // Clear the in-memory log
        systemLog.length = 0;
        
        // Update in-memory log with new data
        logs.forEach(log => {
            if (log.details && log.details.event === 'messages-sent') {
                systemLog.push(log);
            }
        });
        
        // Rewrite the system.log file
        const logLines = logs.map(log => JSON.stringify(log)).join('\n');
        fs.writeFileSync(SYSTEM_LOG_FILE, logLines + '\n');
        
        log('System log updated', 'SYSTEM', { event: 'log-updated', count: logs.length });
        res.json({ success: true, message: 'Logs updated successfully' });
    } catch (error) {
        console.error('Error updating logs:', error);
        res.status(500).json({ error: 'Failed to update logs' });
    }
});

const v1ApiRouter = initializeApi(sessions, sessionTokens, createSession, getSessionsDetails, deleteSession, log);
const legacyApiRouter = initializeLegacyApi(sessions, sessionTokens);
app.use('/api/v1', v1ApiRouter);
app.use('/api', legacyApiRouter); // Mount legacy routes at /api
// Prevent serving sensitive files
app.use((req, res, next) => {
    if (req.path.includes('session_tokens.json') || req.path.endsWith('.bak')) {
        return res.status(403).send('Forbidden');
    }
    next();
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// System log history (in-memory)
const systemLog = [];
const MAX_LOG_ENTRIES = 1000;
const SYSTEM_LOG_FILE = path.join(__dirname, 'system.log');

// Load last N log entries from disk on startup
function loadSystemLogFromDisk() {
    if (!fs.existsSync(SYSTEM_LOG_FILE)) return;
    const lines = fs.readFileSync(SYSTEM_LOG_FILE, 'utf-8').split('\n').filter(Boolean);
    const lastLines = lines.slice(-MAX_LOG_ENTRIES);
    for (const line of lastLines) {
        try {
            const entry = JSON.parse(line);
            systemLog.push(entry);
        } catch {}
    }
}

function rotateSystemLogIfNeeded() {
    try {
        if (fs.existsSync(SYSTEM_LOG_FILE)) {
            const stats = fs.statSync(SYSTEM_LOG_FILE);
            if (stats.size > 5 * 1024 * 1024) { // 5MB
                if (fs.existsSync(SYSTEM_LOG_FILE + '.bak')) {
                    fs.unlinkSync(SYSTEM_LOG_FILE + '.bak');
                }
                fs.renameSync(SYSTEM_LOG_FILE, SYSTEM_LOG_FILE + '.bak');
            }
        }
    } catch (e) {
        console.error('Failed to rotate system.log:', e.message);
    }
}

function log(message, sessionId = 'SYSTEM', details = {}) {
    const logEntry = {
        type: 'log',
        sessionId,
        message,
        details,
        timestamp: new Date().toISOString()
    };
    // Only persist and show in dashboard if this is a sent message log (event: 'messages-sent')
    if (details && details.event === 'messages-sent') {
        systemLog.push(logEntry);
        if (systemLog.length > MAX_LOG_ENTRIES) {
            systemLog.shift(); // Remove oldest
        }
        try {
            rotateSystemLogIfNeeded();
            fs.appendFileSync(SYSTEM_LOG_FILE, JSON.stringify(logEntry) + '\n');
        } catch (e) {
            console.error('Failed to write to system.log:', e.message);
        }
    }
    console.log(`[${sessionId}] ${message}`);
    broadcast(logEntry);
}

// Export system log as JSON
app.get('/api/v1/logs/export', requireAdminAuth, (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="system-log.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(systemLog, null, 2));
});

// Update postToWebhook to accept sessionId and use getWebhookUrl(sessionId)
async function postToWebhook(data) {
    const sessionId = data.sessionId || 'SYSTEM';
    const webhookUrl = getWebhookUrl(sessionId);
    if (!webhookUrl) return;

    try {
        await axios.post(webhookUrl, data, {
            headers: { 'Content-Type': 'application/json' }
        });
        log(`Successfully posted to webhook: ${webhookUrl}`);
    } catch (error) {
        log(`Failed to post to webhook: ${error.message}`);
    }
}

function updateSessionState(sessionId, status, detail, qr, reason) {
    const oldSession = sessions.get(sessionId) || {};
    const newSession = {
        ...oldSession,
        sessionId: sessionId, // Explicitly ensure sessionId is preserved
        status,
        detail,
        qr,
        reason
    };
    sessions.set(sessionId, newSession);

    broadcast({ type: 'session-update', data: getSessionsDetails() });

    postToWebhook({
        event: 'session-status',
        sessionId,
        status,
        detail,
        reason
    });
}

async function connectToWhatsApp(sessionId) {
    updateSessionState(sessionId, 'CONNECTING', 'Initializing session...', '', '');
    log('Starting session...', sessionId);

    const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    log(`Using WA version: ${version.join('.')}, isLatest: ${isLatest}`, sessionId);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Desktop'),
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: (jid) => isJidBroadcast(jid),
        qrTimeout: 30000,
    });
    
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe) {
            log(`Received new message from ${msg.key.remoteJid}`, sessionId);
            
            const messageData = {
                event: 'new-message',
                sessionId,
                from: msg.key.remoteJid,
                messageId: msg.key.id,
                timestamp: msg.messageTimestamp,
                data: msg
            };
            await postToWebhook(messageData);
        }
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
        const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;

        log(`Connection update: ${connection}, status code: ${statusCode}`, sessionId);

      if (qr) {
            log('QR code generated.', sessionId);
            updateSessionState(sessionId, 'GENERATING_QR', 'QR code available.', qr, '');
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.payload?.error || 'Unknown';

            // Allow reconnection on a 515 error, which is a "stream error" often seen after pairing.
            const shouldReconnect = statusCode !== 401 && statusCode !== 403;
            
            log(`Connection closed. Reason: ${reason}, statusCode: ${statusCode}. Reconnecting: ${shouldReconnect}`, sessionId);
            updateSessionState(sessionId, 'DISCONNECTED', 'Connection closed.', '', reason);

            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(sessionId), 5000);
            } else {
                 log(`Not reconnecting for session ${sessionId} due to fatal error. Please delete and recreate the session.`, sessionId);
                 const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
                 if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                    log(`Cleared session data for ${sessionId}`, sessionId);
                 }
            }
        } else if (connection === 'open') {
            log('Connection opened.', sessionId);
            updateSessionState(sessionId, 'CONNECTED', `Connected as ${sock.user?.name || 'Unknown'}`, '', '');
        }
    });

    sessions.get(sessionId).sock = sock;
}

function getSessionsDetails() {
    return Array.from(sessions.values()).map(s => ({
        sessionId: s.sessionId,
        status: s.status,
        detail: s.detail,
        qr: s.qr,
        token: sessionTokens.get(s.sessionId) || null
    }));
}

// API Endpoints
app.get('/sessions', (req, res) => {
    res.json(getSessionsDetails());
});

async function createSession(sessionId) {
    if (sessions.has(sessionId)) {
        throw new Error('Session already exists');
    }
    
    // Check session limit
    if (sessions.size >= MAX_SESSIONS) {
        throw new Error(`Maximum session limit (${MAX_SESSIONS}) reached. Please delete unused sessions.`);
    }
    
    const token = randomUUID();
    sessionTokens.set(sessionId, token);
    saveTokens();
    
    // Set a placeholder before async connection
    sessions.set(sessionId, { sessionId: sessionId, status: 'CREATING', detail: 'Session is being created.' });
    
    // Auto-cleanup inactive sessions after timeout
    setTimeout(async () => {
        const session = sessions.get(sessionId);
        if (session && session.status !== 'CONNECTED') {
            await deleteSession(sessionId);
            log(`Auto-deleted inactive session after ${SESSION_TIMEOUT_HOURS} hours: ${sessionId}`, 'SYSTEM');
        }
    }, SESSION_TIMEOUT_HOURS * 60 * 60 * 1000);
    
    connectToWhatsApp(sessionId);
    return { status: 'success', message: `Session ${sessionId} created.`, token };
}

app.get('/sessions/:sessionId/qr', async (req, res) => {
  const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    log(`QR code requested for ${sessionId}`, sessionId);
    updateSessionState(sessionId, 'GENERATING_QR', 'QR code requested by user.', '', '');
    // The connection logic will handle the actual QR generation and broadcast.
    res.status(200).json({ message: 'QR generation triggered.' });
});

async function deleteSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.sock) {
        try {
            await session.sock.logout();
        } catch (err) {
            log(`Error during logout for session ${sessionId}: ${err.message}`, sessionId);
        }
    }
    sessions.delete(sessionId);
    sessionTokens.delete(sessionId);
    saveTokens();
    const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    log(`Session ${sessionId} deleted and data cleared.`, 'SYSTEM');
    broadcast({ type: 'session-update', data: getSessionsDetails() });
}

const PORT = process.env.PORT || 3000;

async function initializeExistingSessions() {
    const sessionsDir = path.join(__dirname, 'auth_info_baileys');
    if (fs.existsSync(sessionsDir)) {
        const sessionFolders = fs.readdirSync(sessionsDir);
        log(`Found ${sessionFolders.length} existing session(s). Initializing...`);
        for (const sessionId of sessionFolders) {
            const sessionPath = path.join(sessionsDir, sessionId);
            if (fs.statSync(sessionPath).isDirectory()) {
                log(`Re-initializing session: ${sessionId}`);
                await createSession(sessionId); // Await creation to prevent race conditions
            }
        }
    }
}

loadSystemLogFromDisk();
server.listen(PORT, () => {
    log(`Server is running on port ${PORT}`);
    log('Admin dashboard available at http://localhost:3000/admin/dashboard.html');
    loadTokens(); // Load tokens at startup
    initializeExistingSessions();
});
