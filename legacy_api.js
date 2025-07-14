const express = require('express');
const multer = require('multer');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('validator');
const { validateToken } = require('./api_v1');

const router = express.Router();
const upload = multer(); // for form-data parsing

// This is a simplified version of the sendMessage function from api_v1.js
// In a real app, you'd likely want to share this logic.
async function sendLegacyMessage(sock, to, message) {
    try {
        const jid = jidNormalizedUser(to);
        const result = await sock.sendMessage(jid, message);
        return { status: 'success', message: `Message sent to ${to}`, messageId: result.key.id };
    } catch (error) {
        console.error(`Failed to send legacy message to ${to}:`, error);
        return { status: 'error', message: `Failed to send legacy message to ${to}. Reason: ${error.message}` };
    }
}

const legacyLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 requests per minute
    message: { status: 'error', message: 'Too many requests, please try again later.' },
    // Trust proxy headers for proper IP detection
    trustProxy: true,
    standardHeaders: true,
    legacyHeaders: false
});

function initializeLegacyApi(sessions, sessionTokens) {
    // Apply rate limiting and authentication to all legacy endpoints
    router.use(legacyLimiter);
    router.use((req, res, next) => validateToken(req, res, next, sessionTokens));

    // Legacy JSON endpoint
    router.post('/send-message', express.json(), async (req, res) => {
        const { sessionId, number, message } = req.body;
        if (!sessionId || !number || !message) {
            return res.status(400).json({ status: 'error', message: 'sessionId, number, and message are required.' });
        }
        // Input validation
        if (!/^[0-9]{8,15}$/.test(number)) {
            return res.status(400).json({ status: 'error', message: 'Invalid phone number format.' });
        }
        if (typeof message !== 'string' || message.length === 0 || message.length > 4096) {
            return res.status(400).json({ status: 'error', message: 'Invalid message content.' });
        }

        const session = sessions.get(sessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            return res.status(404).json({ status: 'error', message: `Session ${sessionId} not found or not connected.` });
        }

        const destination = `${number}@s.whatsapp.net`;
        const result = await sendLegacyMessage(session.sock, destination, { text: message });
        res.status(200).json(result);
    });

    // Legacy form-data endpoint
    router.post('/message', upload.none(), async (req, res) => {
        const { phone, message, sessionId } = req.body;
        const targetSessionId = sessionId || 'putra';
        if (!phone || !message) {
            return res.status(400).json({ status: 'error', message: 'phone and message are required.' });
        }
        // Input validation
        if (!/^[0-9]{8,15}$/.test(phone)) {
            return res.status(400).json({ status: 'error', message: 'Invalid phone number format.' });
        }
        if (typeof message !== 'string' || message.length === 0 || message.length > 4096) {
            return res.status(400).json({ status: 'error', message: 'Invalid message content.' });
        }
        
        const session = sessions.get(targetSessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            return res.status(404).json({ status: 'error', message: `Session ${targetSessionId} not found or not connected.` });
        }

        const destination = `${phone}@s.whatsapp.net`;
        const result = await sendLegacyMessage(session.sock, destination, { text: message });
        res.status(200).json(result);
    });

    return router;
}

module.exports = { initializeLegacyApi }; 