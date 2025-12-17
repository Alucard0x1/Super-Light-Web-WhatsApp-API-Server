/**
 * WhatsApp Service
 * Handles Baileys WhatsApp connection logic
 */

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    fetchLatestWaWebVersion,
    makeCacheableSignalKeyStore,
    isJidBroadcast,
    Browsers,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const Session = require('../models/Session');
const ActivityLog = require('../models/ActivityLog');

// Logger configuration
const defaultLogLevel = process.env.NODE_ENV === 'production' ? 'silent' : 'warn';
const logger = pino({ level: process.env.LOG_LEVEL || defaultLogLevel });

// Active socket connections (in-memory)
const activeSockets = new Map();
const retryCounters = new Map();

// Auth directory
const AUTH_DIR = path.join(__dirname, '../../auth_info_baileys');

/**
 * Ensure auth directory exists
 */
function ensureAuthDir() {
    if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
}

/**
 * Connect to WhatsApp
 * @param {string} sessionId - Session ID
 * @param {function} onUpdate - Callback for status updates
 * @param {function} onMessage - Callback for incoming messages
 * @returns {object} Socket connection
 */
async function connect(sessionId, onUpdate, onMessage) {
    ensureAuthDir();

    const sessionDir = path.join(AUTH_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    console.log(`[${sessionId}] Starting WhatsApp connection...`);

    // Update session status
    Session.updateStatus(sessionId, 'CONNECTING', 'Initializing...');
    if (onUpdate) onUpdate(sessionId, 'CONNECTING', 'Initializing...', null);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Get latest WA version (with fallback)
    let version;
    try {
        const waVersion = await fetchLatestWaWebVersion({});
        version = waVersion.version;
        console.log(`[${sessionId}] Using WA Web version: ${version.join('.')}`);
    } catch (e) {
        const baileysVersion = await fetchLatestBaileysVersion();
        version = baileysVersion.version;
        console.log(`[${sessionId}] Using Baileys version: ${version.join('.')} (fallback)`);
    }

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.ubuntu('Chrome'),
        generateHighQualityLinkPreview: false,
        shouldIgnoreJid: (jid) => isJidBroadcast(jid),
        qrTimeout: 40000,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        retryRequestDelayMs: 500,
        maxMsgRetryCount: 3,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        defaultQueryTimeoutMs: undefined,
        getMessage: async () => ({ conversation: 'hello' })
    });

    // Store socket reference
    activeSockets.set(sessionId, sock);

    // Handle credentials update
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[${sessionId}] QR code generated`);
            Session.updateStatus(sessionId, 'GENERATING_QR', 'Scan QR code');
            if (onUpdate) onUpdate(sessionId, 'GENERATING_QR', 'Scan QR code', qr);
        }

        if (connection === 'connecting') {
            Session.updateStatus(sessionId, 'CONNECTING', 'Connecting...');
            if (onUpdate) onUpdate(sessionId, 'CONNECTING', 'Connecting...', null);
        }

        if (connection === 'open') {
            console.log(`[${sessionId}] Connected!`);
            retryCounters.delete(sessionId);

            const name = sock.user?.name || 'Unknown';
            Session.updateStatus(sessionId, 'CONNECTED', `Connected as ${name}`);
            if (onUpdate) onUpdate(sessionId, 'CONNECTED', `Connected as ${name}`, null);
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.output?.payload?.message || 'Connection closed';

            console.log(`[${sessionId}] Disconnected: ${statusCode} - ${reason}`);
            Session.updateStatus(sessionId, 'DISCONNECTED', reason);
            if (onUpdate) onUpdate(sessionId, 'DISCONNECTED', reason, null);

            // Handle reconnection logic
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401 && statusCode !== 403;

            if (shouldReconnect) {
                const retryCount = (retryCounters.get(sessionId) || 0) + 1;
                retryCounters.set(sessionId, retryCount);

                if (retryCount <= 5) {
                    console.log(`[${sessionId}] Reconnecting... (attempt ${retryCount})`);
                    setTimeout(() => connect(sessionId, onUpdate, onMessage), 5000);
                } else {
                    console.log(`[${sessionId}] Max retries reached`);
                    retryCounters.delete(sessionId);
                }
            } else {
                // Clear session data on logout
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(`[${sessionId}] Logged out, cleaning session data`);
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    }
                }
            }

            activeSockets.delete(sessionId);
        }
    });

    // Handle incoming messages
    if (onMessage) {
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.key.fromMe && msg.message) {
                onMessage(sessionId, msg);
            }
        });
    }

    return sock;
}

/**
 * Disconnect a session
 * @param {string} sessionId - Session ID
 */
function disconnect(sessionId) {
    const sock = activeSockets.get(sessionId);
    if (sock) {
        sock.end();
        activeSockets.delete(sessionId);
    }
    retryCounters.delete(sessionId);
}

/**
 * Get socket for a session
 * @param {string} sessionId - Session ID
 * @returns {object|null} Socket or null
 */
function getSocket(sessionId) {
    return activeSockets.get(sessionId) || null;
}

/**
 * Check if session is connected
 * @param {string} sessionId - Session ID
 * @returns {boolean} True if connected
 */
function isConnected(sessionId) {
    const sock = activeSockets.get(sessionId);
    return sock?.user != null;
}

/**
 * Delete session data
 * @param {string} sessionId - Session ID
 */
function deleteSessionData(sessionId) {
    disconnect(sessionId);

    const sessionDir = path.join(AUTH_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    Session.delete(sessionId);
}

/**
 * Get all active sessions
 * @returns {Map} Active sockets
 */
function getActiveSessions() {
    return activeSockets;
}

module.exports = {
    connect,
    disconnect,
    getSocket,
    isConnected,
    deleteSessionData,
    getActiveSessions,
    AUTH_DIR
};
