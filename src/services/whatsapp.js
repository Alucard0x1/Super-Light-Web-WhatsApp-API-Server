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
    downloadMediaMessage,
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
const reconnectTimeouts = new Map();

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
    if (!require('../utils/validation').isValidId(sessionId)) {
        throw new Error('Invalid session ID');
    }

    ensureAuthDir();

    const sessionDir = path.join(AUTH_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Clear any pending reconnection timer for this session
    if (reconnectTimeouts.has(sessionId)) {
        clearTimeout(reconnectTimeouts.get(sessionId));
        reconnectTimeouts.delete(sessionId);
    }

    // Clean up any existing socket for this session before creating a new one
    const existingSock = activeSockets.get(sessionId);
    if (existingSock) {
        console.log(`[${sessionId}] Cleaning up existing socket before reconnect`);
        try {
            existingSock.end();
        } catch (err) {
            // Socket may already be closed, ignore
        }
        activeSockets.delete(sessionId);
    }

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
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut &&
                statusCode !== DisconnectReason.connectionReplaced &&
                statusCode !== 401 &&
                statusCode !== 403 &&
                statusCode !== 440;

            if (shouldReconnect) {
                const retryCount = (retryCounters.get(sessionId) || 0) + 1;
                retryCounters.set(sessionId, retryCount);

                if (retryCount <= 5) {
                    console.log(`[${sessionId}] Reconnecting... (attempt ${retryCount})`);
                    const timerId = setTimeout(() => {
                        reconnectTimeouts.delete(sessionId);
                        connect(sessionId, onUpdate, onMessage);
                    }, 5000);
                    reconnectTimeouts.set(sessionId, timerId);
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

    // Handle incoming messages & auto-replies
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.message) return;

        const remoteJid = msg.key.remoteJid;
        const fromMe = msg.key.fromMe ? 1 : 0;
        const senderName = msg.pushName || null;

        let textBody = '';
        let messageType = 'text';
        let mediaUrl = null;

        if (msg.message.conversation) {
            textBody = msg.message.conversation;
        } else if (msg.message.extendedTextMessage?.text) {
            textBody = msg.message.extendedTextMessage.text;
        } else if (msg.message.imageMessage) {
            messageType = 'image';
            textBody = msg.message.imageMessage.caption || '[Image]';
        } else if (msg.message.videoMessage) {
            messageType = 'video';
            textBody = msg.message.videoMessage.caption || '[Video]';
        } else if (msg.message.audioMessage) {
            messageType = 'audio';
            textBody = '[Voice / Audio Message]';
        } else if (msg.message.documentMessage) {
            messageType = 'document';
            textBody = msg.message.documentMessage.filename || msg.message.documentMessage.title || '[Document]';
        } else if (msg.message.stickerMessage) {
            messageType = 'sticker';
            textBody = '[Sticker]';
        } else if (msg.message.locationMessage) {
            messageType = 'location';
            textBody = `Location: ${msg.message.locationMessage.degreesLatitude}, ${msg.message.locationMessage.degreesLongitude}`;
        } else if (msg.message.contactMessage || msg.message.contactsArrayMessage) {
            messageType = 'contact';
            textBody = msg.message.contactMessage?.displayName || '[Contact Card]';
        }

        // Auto-download media files locally for 100% reliable Live Support Inbox rendering
        const isMedia = ['image', 'video', 'audio', 'document', 'sticker'].includes(messageType);
        if (isMedia) {
            try {
                const buffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { logger, reuploadRequest: sock.updateMediaMessage }
                );

                let ext = 'bin';
                if (messageType === 'image') ext = 'jpg';
                else if (messageType === 'video') ext = 'mp4';
                else if (messageType === 'audio') ext = 'mp3';
                else if (messageType === 'sticker') ext = 'webp';
                else if (messageType === 'document') {
                    const fname = msg.message.documentMessage?.filename || '';
                    ext = fname.includes('.') ? fname.split('.').pop() : 'pdf';
                }

                const mediaDir = path.join(__dirname, '../../media');
                if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

                const localFileName = `${Date.now()}_${msg.key.id}.${ext}`;
                const localFilePath = path.join(mediaDir, localFileName);
                fs.writeFileSync(localFilePath, buffer);
                mediaUrl = `/media/${localFileName}`;
            } catch (mediaErr) {
                console.error(`[WhatsApp] Media download failed for msg ${msg.key.id}:`, mediaErr.message);
                mediaUrl = msg.message[messageType + 'Message']?.url || null;
            }
        }

        // 1. Cache message in database for Live Support Inbox
        try {
            const ChatMessage = require('../models/ChatMessage');
            ChatMessage.save({
                id: msg.key.id,
                sessionId,
                remoteJid,
                senderName,
                fromMe,
                messageType,
                body: textBody,
                mediaUrl
            });
        } catch (e) {
            console.error('[WhatsApp] ChatMessage save error:', e.message);
        }

        // 2. Auto-reply rule evaluation (supports external incoming AND self-testing on own number)
        const myNumber = sock.user?.id ? sock.user.id.split(':')[0].split('@')[0] : null;
        const isSelfChat = fromMe && myNumber && remoteJid.includes(myNumber);

        if ((!fromMe || isSelfChat) && textBody) {
            try {
                const AutoReply = require('../models/AutoReply');
                const rule = AutoReply.findMatchingReply(sessionId, textBody);
                let matchedRule = false;

                if (rule && rule.is_active) {
                    matchedRule = true;
                    console.log(`[AutoReply] Match found for keyword "${rule.keyword}" on session ${sessionId}`);

                    let replyPayload = rule.response_payload;
                    try {
                        replyPayload = JSON.parse(rule.response_payload);
                    } catch (e) {}

                    if (rule.response_type === 'text') {
                        const replyText = typeof replyPayload === 'object' ? (replyPayload.body || replyPayload.text || String(replyPayload)) : String(replyPayload);
                        await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                        
                        // Save auto-reply message into ChatMessage cache as outgoing
                        const ChatMessage = require('../models/ChatMessage');
                        ChatMessage.save({
                            sessionId,
                            remoteJid,
                            senderName: 'AutoResponder',
                            fromMe: 1,
                            messageType: 'text',
                            body: replyText
                        });
                    }
                }

                // AI Chatbot fallback if no keyword rule matched
                if (!matchedRule) {
                    const aiChatbot = require('./aiChatbot');
                    const aiReply = await aiChatbot.generateResponse({ sessionId, remoteJid, userText: textBody });
                    if (aiReply) {
                        console.log(`[AI Chatbot] Sending AI response for session ${sessionId} to ${remoteJid}`);
                        await sock.sendMessage(remoteJid, { text: aiReply }, { quoted: msg });

                        const ChatMessage = require('../models/ChatMessage');
                        ChatMessage.save({
                            sessionId,
                            remoteJid,
                            senderName: 'AI Assistant',
                            fromMe: 1,
                            messageType: 'text',
                            body: aiReply
                        });
                    }
                }
            } catch (err) {
                console.error(`[AutoReply/AI] Execution error:`, err.message);
            }
        }

        if (!fromMe && onMessage) {
            onMessage(sessionId, msg);
        }
    });

    return sock;
}

/**
 * Disconnect a session
 * @param {string} sessionId - Session ID
 */
function disconnect(sessionId) {
    if (reconnectTimeouts.has(sessionId)) {
        clearTimeout(reconnectTimeouts.get(sessionId));
        reconnectTimeouts.delete(sessionId);
    }
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
    if (!require('../utils/validation').isValidId(sessionId)) {
        return;
    }

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

/**
 * Get all joined WhatsApp groups and participants for a session
 * @param {string} sessionId - Session ID
 */
async function getJoinedGroups(sessionId) {
    const sock = activeSockets.get(sessionId);
    if (!sock) throw new Error('Session is not connected');
    const groupMap = await sock.groupFetchAllParticipating();
    return Object.values(groupMap).map(g => ({
        id: g.id,
        subject: g.subject,
        owner: g.owner,
        creation: g.creation,
        participantsCount: g.participants?.length || 0,
        participants: g.participants?.map(p => ({
            id: p.id,
            number: p.id.split('@')[0],
            admin: p.admin || null
        })) || []
    }));
}

/**
 * Send a text message using an active session socket
 * @param {string} sessionId - Session ID
 * @param {string} toJid - Target JID (e.g., number@s.whatsapp.net)
 * @param {string} text - Message content
 */
async function sendTextMessage(sessionId, toJid, text) {
    const { jidNormalizedUser } = require('@whiskeysockets/baileys');
    const sock = activeSockets.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} is not connected`);
    const jid = jidNormalizedUser(toJid);
    return await sock.sendMessage(jid, { text });
}

module.exports = {
    connect,
    disconnect,
    getSocket,
    isConnected,
    deleteSessionData,
    getActiveSessions,
    getJoinedGroups,
    sendTextMessage,
    AUTH_DIR
};
