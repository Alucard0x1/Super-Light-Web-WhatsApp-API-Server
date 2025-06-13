const express = require('express');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const router = express.Router();

let webhookUrl = process.env.WEBHOOK_URL || '';

// Multer setup for file uploads
const mediaDir = path.join(__dirname, 'media');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, mediaDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${randomUUID()}${ext}`);
    }
});
const upload = multer({ storage });

const getWebhookUrl = () => webhookUrl;

function initializeApi(sessions, sessionTokens) {
    const validateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token == null) {
            return res.status(401).json({ status: 'error', message: 'No token provided' });
        }
        
        // For session-specific routes, check the token against the session
        const sessionId = req.query.sessionId || req.body.sessionId;
        if (sessionId) {
            const expectedToken = sessionTokens.get(sessionId);
            if (expectedToken && token === expectedToken) {
                return next();
            }
        }
        
        // For global routes (webhook, media), check if it's any valid token
        // Or for requests where sessionId is not easily available in middleware
        const isAnyTokenValid = Array.from(sessionTokens.values()).includes(token);
        if (isAnyTokenValid) {
            // Re-check for session routes to give a more specific error
            if (sessionId) {
                 return res.status(403).json({ status: 'error', message: `Invalid token for session ${sessionId}` });
            }
            return next();
        }

        return res.status(403).json({ status: 'error', message: 'Invalid token' });
    };

    router.use(validateToken);

    async function sendMessage(sock, to, message) {
        try {
            const jid = jidNormalizedUser(to);
            const result = await sock.sendMessage(jid, message);
            return { status: 'success', message: `Message sent to ${to}`, messageId: result.key.id };
        } catch (error) {
            console.error(`Failed to send message to ${to}:`, error);
            return { status: 'error', message: `Failed to send message to ${to}. Reason: ${error.message}` };
        }
    }

    // Webhook setup endpoint
    router.post('/webhook', (req, res) => {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ status: 'error', message: 'URL is required.' });
        }
        webhookUrl = url;
        console.log(`Webhook URL set to: ${webhookUrl}`);
        res.status(200).json({ status: 'success', message: `Webhook URL updated to ${url}` });
    });
    
    // Media upload endpoint
    router.post('/media', upload.single('file'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
        }
        const mediaId = req.file.filename;
        res.status(201).json({
            status: 'success',
            message: 'File uploaded successfully.',
            mediaId: mediaId,
            url: `/media/${mediaId}`
        });
    });

    // Main message sending endpoint
    router.post('/messages', async (req, res) => {
        const { sessionId } = req.query;
        if (!sessionId) {
            return res.status(400).json({ status: 'error', message: 'sessionId query parameter is required' });
        }

        const session = sessions.get(sessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            return res.status(404).json({ status: 'error', message: `Session ${sessionId} not found or not connected.` });
        }

        const messages = Array.isArray(req.body) ? req.body : [req.body];
        const results = [];

        for (const msg of messages) {
            const { recipient_type, to, type, text, image, document } = msg;

            if (!to || !type) {
                 results.push({ status: 'error', message: 'Invalid message format. "to" and "type" are required.' });
                 continue;
            }

            let destination;
            if (recipient_type === 'group') {
                destination = to.endsWith('@g.us') ? to : `${to}@g.us`;
            } else {
                destination = `${to.replace(/[@s.whatsapp.net]/g, '')}@s.whatsapp.net`;
            }

            let messagePayload;
            let options = {};

            try {
                switch (type) {
                    case 'text':
                        if (!text || !text.body) {
                             throw new Error('For "text" type, "text.body" is required.');
                        }
                        messagePayload = { text: text.body };
                        break;

                    case 'image':
                        if (!image || (!image.link && !image.id)) {
                             throw new Error('For "image" type, "image.link" or "image.id" is required.');
                        }
                        const imageUrl = image.id ? path.join(mediaDir, image.id) : image.link;
                        messagePayload = { image: { url: imageUrl }, caption: image.caption };
                        break;

                    case 'document':
                         if (!document || (!document.link && !document.id)) {
                             throw new Error('For "document" type, "document.link" or "document.id" is required.');
                        }
                        const docUrl = document.id ? path.join(mediaDir, document.id) : document.link;
                        messagePayload = { document: { url: docUrl }, mimetype: document.mimetype, fileName: document.filename };
                        break;

                    default:
                        throw new Error(`Unsupported message type: ${type}`);
                }

                const result = await sendMessage(session.sock, destination, messagePayload);
                results.push(result);

            } catch (error) {
                results.push({ status: 'error', message: `Failed to process message for ${to}: ${error.message}` });
            }
        }

        res.status(200).json(results);
    });

    router.delete('/message', async (req, res) => {
        const { sessionId, messageId, remoteJid } = req.body;

        if (!sessionId || !messageId || !remoteJid) {
            return res.status(400).json({ status: 'error', message: 'sessionId, messageId, and remoteJid are required.' });
        }

        const session = sessions.get(sessionId);
        if (!session || !session.sock || session.status !== 'CONNECTED') {
            return res.status(404).json({ status: 'error', message: `Session ${sessionId} not found or not connected.` });
        }

        try {
            await session.sock.chatModify({
                clear: { messages: [{ id: messageId, fromMe: true, timestamp: 0 }] }
            }, remoteJid);
            
            // The above is for clearing. For actual deletion:
            await session.sock.sendMessage(remoteJid, { delete: { remoteJid: remoteJid, fromMe: true, id: messageId } });

            res.status(200).json({ status: 'success', message: `Attempted to delete message ${messageId}` });
        } catch (error) {
            console.error(`Failed to delete message ${messageId}:`, error);
            res.status(500).json({ status: 'error', message: `Failed to delete message. Reason: ${error.message}` });
        }
    });

    return router;
}

module.exports = { initializeApi, getWebhookUrl }; 