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

const sessions = new Map();
const retries = new Map();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const logger = pino({ level: 'debug' });

const TOKENS_FILE = path.join(__dirname, 'session_tokens.json');
let sessionTokens = new Map();

function saveTokens() {
    const tokensToSave = Object.fromEntries(sessionTokens);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokensToSave, null, 2), 'utf-8');
}

function loadTokens() {
    if (fs.existsSync(TOKENS_FILE)) {
        try {
            const tokensFromFile = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
            sessionTokens.clear(); // Do not reassign, clear and populate instead
            for (const [key, value] of Object.entries(tokensFromFile)) {
                sessionTokens.set(key, value);
            }
        } catch (error) {
            console.error('Error loading tokens file:', error);
            sessionTokens.clear();
        }
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

const v1ApiRouter = initializeApi(sessions, sessionTokens);
const legacyApiRouter = initializeLegacyApi(sessions);
app.use('/api/v1', v1ApiRouter);
app.use('/api', legacyApiRouter); // Mount legacy routes at /api

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function log(message, sessionId = 'SYSTEM') {
    console.log(`[${sessionId}] ${message}`);
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
        qr: s.qr,
        detail: s.detail,
        token: sessionTokens.get(s.sessionId) || null
    }));
}

// API Endpoints
app.get('/sessions', (req, res) => {
    res.json(getSessionsDetails());
});

async function createSession(sessionId) {
    if (sessions.has(sessionId)) {
        // If session exists, just try to connect it.
        // This can happen on server restart for existing sessions.
        await connectToWhatsApp(sessionId);
        return { success: true, message: `Re-initiating connection for session ${sessionId}.` };
    }

    const session = {
        sessionId,
        status: 'DISCONNECTED',
        sock: null,
        qr: null,
        detail: 'Session created. Please get QR code.'
    };
    sessions.set(sessionId, session);
    
    if (!sessionTokens.has(sessionId)) {
        sessionTokens.set(sessionId, randomUUID());
        saveTokens();
    }

    log(`Session created: ${sessionId}`);
    broadcast({ type: 'session-update', data: getSessionsDetails() });
    
    await connectToWhatsApp(sessionId);

    return { success: true, message: `Session ${sessionId} created.` };
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
    if (!session) return;

    if (session.sock) {
        try {
            await session.sock.logout();
        } catch (e) {
            console.error(`Error logging out session ${sessionId}:`, e);
        }
    }

    sessions.delete(sessionId);
    sessionTokens.delete(sessionId);
    saveTokens();

    const authDir = path.join(__dirname, 'auth_info_baileys', `auth_info_${sessionId}`);
    if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
    }
    
    log(`Session ${sessionId} deleted successfully.`, sessionId);
    broadcast({ type: 'session-update', data: getSessionsDetails() });

    return { success: true, message: `Session ${sessionId} deleted.` };
}

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

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

server.listen(PORT, () => {
    log(`Server is running on port ${PORT}`);
    log('Admin dashboard available at http://localhost:3000/admin/dashboard.html');
    loadTokens(); // Load tokens at startup
    initializeExistingSessions();
});
