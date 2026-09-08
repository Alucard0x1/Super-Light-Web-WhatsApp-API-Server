/**
 * Live Support Inbox Chat API Routes
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const ChatMessage = require('../models/ChatMessage');
const Session = require('../models/Session');
const User = require('../models/User');
const whatsappService = require('../services/whatsapp');
const response = require('../utils/response');

const mediaDir = path.join(__dirname, '../../media');

function authenticateChat(req, res, next) {
    if (req.session && req.session.adminAuthed) {
        if (req.session.userId !== 'legacy-admin' && req.session.userEmail) {
            const user = User.findByEmail(req.session.userEmail);
            if (!user || !user.is_active) {
                return response.unauthorized(res, 'Login required');
            }
        }
        req.currentUser = { email: req.session.userEmail, role: req.session.userRole };
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        const sessionRecord = Session.findByToken(token);
        if (sessionRecord) {
            req.apiSessionId = sessionRecord.id;
            req.currentUser = { email: sessionRecord.owner_email, role: 'user' };
            return next();
        }
    }

    return response.unauthorized(res, 'Authentication required');
}

function canAccessSession(req, sessionId) {
    if (!sessionId) return false;
    if (req.apiSessionId) {
        return req.apiSessionId === sessionId;
    }
    if (req.currentUser) {
        if (req.currentUser.role === 'admin') return true;
        const s = Session.findById(sessionId);
        return s && s.owner_email === req.currentUser.email;
    }
    return false;
}

router.use(authenticateChat);

/**
 * GET /api/v1/chats
 * Get recent conversations for a session
 */
router.get('/', (req, res) => {
    try {
        const { sessionId } = req.query;
        if (!sessionId) {
            return response.badRequest(res, 'sessionId query parameter is required');
        }
        if (!canAccessSession(req, sessionId)) {
            return response.forbidden(res, 'Access denied for this session');
        }
        const conversations = ChatMessage.getRecentConversations(sessionId);
        return response.success(res, conversations);
    } catch (err) {
        return response.error(res, err.message);
    }
});

/**
 * GET /api/v1/chats/:remoteJid/messages
 * Get message history for a specific contact
 */
router.get('/:remoteJid/messages', (req, res) => {
    try {
        const { sessionId } = req.query;
        const { remoteJid } = req.params;
        if (!sessionId) {
            return response.badRequest(res, 'sessionId query parameter is required');
        }
        if (!canAccessSession(req, sessionId)) {
            return response.forbidden(res, 'Access denied for this session');
        }
        const messages = ChatMessage.getChatHistory(sessionId, remoteJid);
        ChatMessage.markAsRead(sessionId, remoteJid);
        return response.success(res, messages);
    } catch (err) {
        return response.error(res, err.message);
    }
});

/**
 * POST /api/v1/chats/:remoteJid/send
 * Send live chat reply to a contact from Live Inbox UI (supports text, image, document, audio)
 */
router.post('/:remoteJid/send', async (req, res) => {
    try {
        const { sessionId, message, type = 'text', mediaUrl, mediaId, filename } = req.body;
        const { remoteJid } = req.params;

        if (!sessionId) {
            return response.badRequest(res, 'sessionId query or body parameter is required');
        }
        if (!canAccessSession(req, sessionId)) {
            return response.forbidden(res, 'Access denied for this session');
        }

        const resolveMediaPayload = (id, url) => {
            if (id) {
                const localPath = path.join(mediaDir, path.basename(id));
                if (fs.existsSync(localPath)) return { url: localPath };
                return { url: id };
            }
            if (url) {
                if (url.startsWith('/media/') || url.startsWith('media/')) {
                    const localPath = path.join(mediaDir, path.basename(url));
                    if (fs.existsSync(localPath)) return { url: localPath };
                }
                return { url };
            }
            return null;
        };

        const formattedJid = remoteJid.includes('@') ? remoteJid : `${remoteJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        let result;

        if (type === 'image') {
            const sock = whatsappService.getSocket(sessionId);
            if (!sock) throw new Error(`Session ${sessionId} is not connected`);
            const imagePayload = resolveMediaPayload(mediaId, mediaUrl);
            if (!imagePayload) throw new Error('Image url or mediaId is required');
            result = await sock.sendMessage(formattedJid, { image: imagePayload, caption: message || '' });
            ChatMessage.save({
                id: result?.key?.id,
                sessionId,
                remoteJid: formattedJid,
                senderName: 'Agent',
                fromMe: 1,
                messageType: 'image',
                body: message || '[Image]',
                mediaUrl: mediaUrl || (mediaId ? `/media/${mediaId}` : null)
            });
        } else if (type === 'document') {
            const sock = whatsappService.getSocket(sessionId);
            if (!sock) throw new Error(`Session ${sessionId} is not connected`);
            const docPayload = resolveMediaPayload(mediaId, mediaUrl);
            if (!docPayload) throw new Error('Document url or mediaId is required');
            result = await sock.sendMessage(formattedJid, { document: docPayload, fileName: filename || 'document', caption: message || '' });
            ChatMessage.save({
                id: result?.key?.id,
                sessionId,
                remoteJid: formattedJid,
                senderName: 'Agent',
                fromMe: 1,
                messageType: 'document',
                body: filename || message || '[Document]',
                mediaUrl: mediaUrl || (mediaId ? `/media/${mediaId}` : null)
            });
        } else if (type === 'audio') {
            const sock = whatsappService.getSocket(sessionId);
            if (!sock) throw new Error(`Session ${sessionId} is not connected`);
            const audioPayload = resolveMediaPayload(mediaId, mediaUrl);
            if (!audioPayload) throw new Error('Audio url or mediaId is required');
            result = await sock.sendMessage(formattedJid, { audio: audioPayload, ptt: true });
            ChatMessage.save({
                id: result?.key?.id,
                sessionId,
                remoteJid: formattedJid,
                senderName: 'Agent',
                fromMe: 1,
                messageType: 'audio',
                body: '[Audio Voice Note]',
                mediaUrl: mediaUrl || (mediaId ? `/media/${mediaId}` : null)
            });
        } else {
            result = await whatsappService.sendTextMessage(sessionId, formattedJid, message || '');
            ChatMessage.save({
                id: result?.key?.id,
                sessionId,
                remoteJid: formattedJid,
                senderName: 'Agent',
                fromMe: 1,
                messageType: 'text',
                body: message || ''
            });
        }

        return response.success(res, { message: 'Message sent successfully', data: result });
    } catch (err) {
        return response.error(res, err.message);
    }
});

module.exports = router;
