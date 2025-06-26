const express = require('express');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const config = require('./config');
const SecurityMiddleware = require('./middleware/security');
const ValidationSchemas = require('./middleware/validation');

const router = express.Router();

let webhookUrl = config.webhook.url;

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.storage.mediaDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${randomUUID()}${ext}`);
    }
});

const upload = multer({ 
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        fieldSize: 10 * 1024 * 1024 // 10MB field limit
    },
    fileFilter: (req, file, cb) => {
        // Allow common file types
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|mp3|mp4|wav|avi/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('File type not allowed'));
        }
    }
});

const getWebhookUrl = () => webhookUrl;

function initializeApi(sessions, sessionTokens, createSession, getSessionsDetails, deleteSession) {
    const validateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token == null) {
            return res.status(401).json({ 
                status: 'error', 
                message: 'No token provided',
                code: 'NO_TOKEN'
            });
        }
        
        const sessionId = req.query.sessionId || req.body.sessionId || req.params.sessionId;
        if (sessionId) {
            const expectedToken = sessionTokens.get(sessionId);
            if (expectedToken && token === expectedToken) {
                req.sessionId = sessionId;
                return next();
            }
        }
        
        const isAnyTokenValid = Array.from(sessionTokens.values()).includes(token);
        if (isAnyTokenValid) {
            if (sessionId) {
                return res.status(403).json({ 
                    status: 'error', 
                    message: `Invalid token for session ${sessionId}`,
                    code: 'INVALID_SESSION_TOKEN'
                });
            }
            return next();
        }

        return res.status(403).json({ 
            status: 'error', 
            message: 'Invalid token',
            code: 'INVALID_TOKEN'
        });
    };

    // Unprotected routes
    router.post('/sessions', 
        SecurityMiddleware.validateInput(ValidationSchemas.sessionCreate),
        async (req, res) => {
            try {
                const { sessionId } = req.body;
                
                if (sessions.has(sessionId)) {
                    return res.status(409).json({ 
                        status: 'error', 
                        message: `Session ${sessionId} already exists`,
                        code: 'SESSION_EXISTS'
                    });
                }
                
                const result = await createSession(sessionId);
                const token = sessionTokens.get(sessionId);
                
                res.status(201).json({ 
                    status: 'success', 
                    message: `Session ${sessionId} created.`, 
                    token: token,
                    sessionId: sessionId
                });
            } catch (error) {
                console.error('Session creation error:', error);
                res.status(500).json({ 
                    status: 'error', 
                    message: `Failed to create session: ${error.message}`,
                    code: 'CREATION_FAILED'
                });
            }
        }
    );

    router.get('/sessions', (req, res) => {
        try {
            const sessions = getSessionsDetails();
            res.status(200).json({
                status: 'success',
                data: sessions,
                count: sessions.length
            });
        } catch (error) {
            console.error('Failed to get sessions:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to retrieve sessions',
                code: 'FETCH_FAILED'
            });
        }
    });

    // All routes below this are protected by token
    router.use(validateToken);

    router.delete('/sessions/:sessionId', async (req, res) => {
        try {
            const { sessionId } = req.params;
            
            if (!sessions.has(sessionId)) {
                return res.status(404).json({ 
                    status: 'error', 
                    message: `Session ${sessionId} not found`,
                    code: 'SESSION_NOT_FOUND'
                });
            }
            
            await deleteSession(sessionId);
            res.status(200).json({ 
                status: 'success', 
                message: `Session ${sessionId} deleted.` 
            });
        } catch (error) {
            console.error('Session deletion error:', error);
            res.status(500).json({ 
                status: 'error', 
                message: `Failed to delete session: ${error.message}`,
                code: 'DELETION_FAILED'
            });
        }
    });

    async function sendMessage(sock, to, message) {
        try {
            const jid = jidNormalizedUser(to);
            const result = await sock.sendMessage(jid, message);
            return { 
                status: 'success', 
                message: `Message sent to ${to}`, 
                messageId: result.key.id,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error(`Failed to send message to ${to}:`, error);
            return { 
                status: 'error', 
                message: `Failed to send message to ${to}. Reason: ${error.message}`,
                code: 'SEND_FAILED'
            };
        }
    }

    // Webhook setup endpoint
    router.post('/webhook', 
        SecurityMiddleware.validateInput(ValidationSchemas.webhookConfig),
        (req, res) => {
            try {
                const { url } = req.body;
                webhookUrl = url;
                console.log(`✅ Webhook URL set to: ${webhookUrl}`);
                res.status(200).json({ 
                    status: 'success', 
                    message: `Webhook URL updated to ${url}`,
                    url: webhookUrl
                });
            } catch (error) {
                console.error('Webhook configuration error:', error);
                res.status(500).json({
                    status: 'error',
                    message: 'Failed to configure webhook',
                    code: 'WEBHOOK_CONFIG_FAILED'
                });
            }
        }
    );

    router.get('/webhook', (req, res) => {
        res.status(200).json({
            status: 'success',
            url: webhookUrl || null,
            configured: !!webhookUrl
        });
    });
    
    // Media upload endpoint with enhanced validation
    router.post('/media', (req, res) => {
        upload.single('file')(req, res, (err) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(413).json({ 
                            status: 'error', 
                            message: 'File too large. Maximum size is 50MB.',
                            code: 'FILE_TOO_LARGE'
                        });
                    }
                }
                return res.status(400).json({ 
                    status: 'error', 
                    message: err.message,
                    code: 'UPLOAD_FAILED'
                });
            }
            
            if (!req.file) {
                return res.status(400).json({ 
                    status: 'error', 
                    message: 'No file uploaded.',
                    code: 'NO_FILE'
                });
            }
            
            const mediaId = req.file.filename;
            res.status(201).json({
                status: 'success',
                message: 'File uploaded successfully.',
                data: {
                    mediaId: mediaId,
                    url: `/media/${mediaId}`,
                    originalName: req.file.originalname,
                    size: req.file.size,
                    mimeType: req.file.mimetype
                }
            });
        });
    });

    // Main message sending endpoint with validation
    router.post('/messages', async (req, res) => {
        try {
            const { sessionId } = req.query;
            
            if (!sessionId) {
                return res.status(400).json({ 
                    status: 'error', 
                    message: 'sessionId query parameter is required',
                    code: 'MISSING_SESSION_ID'
                });
            }

            const session = sessions.get(sessionId);
            if (!session || !session.sock || session.status !== 'CONNECTED') {
                return res.status(404).json({ 
                    status: 'error', 
                    message: `Session ${sessionId} not found or not connected.`,
                    code: 'SESSION_UNAVAILABLE'
                });
            }

            const messages = Array.isArray(req.body) ? req.body : [req.body];
            const results = [];
            
            // Validate each message
            for (const msg of messages) {
                const { error } = ValidationSchemas.sendMessage.validate(msg);
                if (error) {
                    results.push({ 
                        status: 'error', 
                        message: `Validation error: ${error.details[0].message}`,
                        code: 'VALIDATION_ERROR'
                    });
                    continue;
                }

                const { recipient_type, to, type, text, image, document } = msg;

                let destination;
                if (recipient_type === 'group') {
                    destination = to.endsWith('@g.us') ? to : `${to}@g.us`;
                } else {
                    destination = `${to.replace(/[@s.whatsapp.net]/g, '')}@s.whatsapp.net`;
                }

                let messagePayload;

                try {
                    switch (type) {
                        case 'text':
                            messagePayload = { text: text.body };
                            break;

                        case 'image':
                            const imageUrl = image.id ? 
                                path.join(config.storage.mediaDir, image.id) : 
                                image.link;
                            messagePayload = { 
                                image: { url: imageUrl }, 
                                caption: image.caption || ''
                            };
                            break;

                        case 'document':
                            const docUrl = document.id ? 
                                path.join(config.storage.mediaDir, document.id) : 
                                document.link;
                            messagePayload = { 
                                document: { url: docUrl }, 
                                mimetype: document.mimetype, 
                                fileName: document.filename || 'document'
                            };
                            break;

                        default:
                            throw new Error(`Unsupported message type: ${type}`);
                    }

                    const result = await sendMessage(session.sock, destination, messagePayload);
                    results.push(result);

                } catch (error) {
                    results.push({ 
                        status: 'error', 
                        message: `Failed to process message for ${to}: ${error.message}`,
                        code: 'PROCESSING_FAILED'
                    });
                }
            }

            const successCount = results.filter(r => r.status === 'success').length;
            const failureCount = results.length - successCount;

            res.status(200).json({
                status: failureCount === 0 ? 'success' : (successCount === 0 ? 'error' : 'partial'),
                results: results,
                summary: {
                    total: results.length,
                    successful: successCount,
                    failed: failureCount
                }
            });
        } catch (error) {
            console.error('Message sending error:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error while sending messages',
                code: 'INTERNAL_ERROR'
            });
        }
    });

    router.delete('/message', 
        SecurityMiddleware.validateInput(ValidationSchemas.deleteMessage),
        async (req, res) => {
            try {
                const { sessionId, messageId, remoteJid } = req.body;

                const session = sessions.get(sessionId);
                if (!session || !session.sock || session.status !== 'CONNECTED') {
                    return res.status(404).json({ 
                        status: 'error', 
                        message: `Session ${sessionId} not found or not connected.`,
                        code: 'SESSION_UNAVAILABLE'
                    });
                }

                try {
                    await session.sock.sendMessage(remoteJid, { 
                        delete: { 
                            remoteJid: remoteJid, 
                            fromMe: true, 
                            id: messageId 
                        } 
                    });

                    res.status(200).json({ 
                        status: 'success', 
                        message: `Message ${messageId} deleted successfully`,
                        messageId: messageId
                    });
                } catch (deleteError) {
                    console.error(`Failed to delete message ${messageId}:`, deleteError);
                    res.status(500).json({ 
                        status: 'error', 
                        message: `Failed to delete message. Reason: ${deleteError.message}`,
                        code: 'DELETE_FAILED'
                    });
                }
            } catch (error) {
                console.error('Message deletion error:', error);
                res.status(500).json({
                    status: 'error',
                    message: 'Internal server error while deleting message',
                    code: 'INTERNAL_ERROR'
                });
            }
        }
    );

    return router;
}

module.exports = { initializeApi, getWebhookUrl }; 