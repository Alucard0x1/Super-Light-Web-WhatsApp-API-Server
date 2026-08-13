/**
 * Live Support Inbox Chat API Routes
 */

const express = require('express');
const router = express.Router();
const ChatMessage = require('../models/ChatMessage');
const whatsappService = require('../services/whatsapp');
const response = require('../utils/response');

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

        const formattedJid = remoteJid.includes('@') ? remoteJid : `${remoteJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        let result;

        if (type === 'image') {
            const sock = whatsappService.getSocket(sessionId);
            if (!sock) throw new Error(`Session ${sessionId} is not connected`);
            const imagePayload = mediaId ? { id: mediaId } : { url: mediaUrl };
            result = await sock.sendMessage(formattedJid, { image: imagePayload, caption: message || '' });
            ChatMessage.save({
                id: result?.key?.id,
                sessionId,
                remoteJid: formattedJid,
                senderName: 'Agent',
                fromMe: 1,
                messageType: 'image',
                body: message || '[Image]',
                mediaUrl: mediaUrl || null
            });
        } else if (type === 'document') {
            const sock = whatsappService.getSocket(sessionId);
            if (!sock) throw new Error(`Session ${sessionId} is not connected`);
            const docPayload = mediaId ? { id: mediaId } : { url: mediaUrl };
            result = await sock.sendMessage(formattedJid, { document: docPayload, fileName: filename || 'document', caption: message || '' });
            ChatMessage.save({
                id: result?.key?.id,
                sessionId,
                remoteJid: formattedJid,
                senderName: 'Agent',
                fromMe: 1,
                messageType: 'document',
                body: filename || message || '[Document]',
                mediaUrl: mediaUrl || null
            });
        } else if (type === 'audio') {
            const sock = whatsappService.getSocket(sessionId);
            if (!sock) throw new Error(`Session ${sessionId} is not connected`);
            const audioPayload = mediaId ? { id: mediaId } : { url: mediaUrl };
            result = await sock.sendMessage(formattedJid, { audio: audioPayload, ptt: true });
            ChatMessage.save({
                id: result?.key?.id,
                sessionId,
                remoteJid: formattedJid,
                senderName: 'Agent',
                fromMe: 1,
                messageType: 'audio',
                body: '[Audio Voice Note]',
                mediaUrl: mediaUrl || null
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
