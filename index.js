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

const sessions = new Map();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const logger = pino({ level: 'debug' });

app.use(express.json());
app.use(bodyParser.json());
app.use('/admin', express.static(path.join(__dirname, 'admin')));


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

function updateSessionStatus(sessionId, status, detail = '', qr = '', reason = '') {
    let session = sessions.get(sessionId) || { sessionId };
    session = { ...session, status, detail, qr, reason };
    sessions.set(sessionId, session);
    broadcast({ type: 'session-update', data: getSessions() });
}

async function createWhatsAppSession(sessionId) {
    updateSessionStatus(sessionId, 'CONNECTING', 'Initializing session...');
    log('Starting session...', sessionId);

    const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    updateSessionStatus(sessionId, 'CONNECTING', 'Initializing session...');
    log('Starting session...', sessionId);

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
    
    sessions.set(sessionId, { sock, status: 'CONNECTING', detail: 'Socket created' });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
        const statusCode = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;

        log(`Connection update: ${connection}, status code: ${statusCode}`, sessionId);

      if (qr) {
            log('QR code generated.', sessionId);
            updateSessionStatus(sessionId, 'GENERATING_QR', 'QR code available.', qr);
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.payload?.error || 'Unknown';

            // Allow reconnection on a 515 error, which is a "stream error" often seen after pairing.
            const shouldReconnect = statusCode !== 401 && statusCode !== 403;
            
            log(`Connection closed. Reason: ${reason}, statusCode: ${statusCode}. Reconnecting: ${shouldReconnect}`, sessionId);
            updateSessionStatus(sessionId, 'DISCONNECTED', 'Connection closed.', '', reason);

            if (shouldReconnect) {
                setTimeout(() => createWhatsAppSession(sessionId), 5000);
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
            updateSessionStatus(sessionId, 'CONNECTED', `Connected as ${sock.user?.name || 'Unknown'}`);
        }
    });

    return sock;
}

function getSessions() {
    const sessionData = [];
    for (const [sessionId, session] of sessions.entries()) {
        sessionData.push({
            sessionId,
            status: session.status,
            detail: session.detail,
            qr: session.qr,
            reason: session.reason,
        });
    }
    return sessionData;
}


// API Endpoints
app.get('/sessions', (req, res) => {
    res.json(getSessions());
});

app.post('/sessions', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }
    if (sessions.has(sessionId)) {
        return res.status(400).json({ error: `Session ${sessionId} already exists.` });
    }
    log(`Received request to create session: ${sessionId}`);
    await createWhatsAppSession(sessionId);
    res.status(201).json({ message: 'Session creation initiated.' });
});

app.get('/sessions/:sessionId/qr', async (req, res) => {
  const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }
    log(`QR code requested for ${sessionId}`, sessionId);
    updateSessionStatus(sessionId, 'GENERATING_QR', 'QR code requested by user.');
    // The connection logic will handle the actual QR generation and broadcast.
    res.status(200).json({ message: 'QR generation triggered.' });
});


app.delete('/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
  }

  try {
        if (session.sock) {
            await session.sock.logout();
        }
    } catch (e) {
        log(`Error during logout for ${sessionId}: ${e.message}`, sessionId);
    }
    
    try {
        if (session.sock) {
            session.sock.end(undefined);
        }
    } catch (e) {
        log(`Error during socket end for ${sessionId}: ${e.message}`, sessionId);
    }

    sessions.delete(sessionId);

    const sessionDir = path.join(__dirname, 'auth_info_baileys', sessionId);
    if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    
    log(`Session ${sessionId} deleted successfully.`, sessionId);
    broadcast({ type: 'session-update', data: getSessions() });

    res.status(200).json({ message: `Session ${sessionId} deleted.` });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    log(`Server is running on port ${PORT}`);
    log('Admin dashboard available at http://localhost:3000/admin/dashboard.html');
});
