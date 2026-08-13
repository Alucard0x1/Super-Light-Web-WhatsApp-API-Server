/**
 * ChatMessage Model
 * Handles database caching for Live Support Chat Inbox & Message History
 */

const { db } = require('../config/database');
const crypto = require('crypto');

class ChatMessage {
    /**
     * Store incoming or outgoing chat message
     */
    static save({ id, sessionId, remoteJid, senderName, fromMe = 0, messageType = 'text', body = '', mediaUrl = null }) {
        const msgId = id || crypto.randomUUID();
        const stmt = db.prepare(`
            INSERT INTO chat_messages (id, session_id, remote_jid, sender_name, from_me, message_type, body, media_url, timestamp, is_read)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
            ON CONFLICT(id) DO UPDATE SET
                body = excluded.body,
                media_url = excluded.media_url
        `);

        stmt.run(msgId, sessionId, remoteJid, senderName || null, fromMe ? 1 : 0, messageType, body, mediaUrl, fromMe ? 1 : 0);
        return this.findById(msgId);
    }

    /**
     * Find message by ID
     */
    static findById(id) {
        const stmt = db.prepare('SELECT * FROM chat_messages WHERE id = ?');
        return stmt.get(id);
    }

    /**
     * Get recent active chat conversations for a session
     */
    static getRecentConversations(sessionId, limit = 50) {
        const stmt = db.prepare(`
            SELECT 
                remote_jid, 
                sender_name,
                body,
                message_type,
                from_me,
                timestamp,
                (SELECT COUNT(*) FROM chat_messages cm2 WHERE cm2.session_id = cm.session_id AND cm2.remote_jid = cm.remote_jid AND cm2.is_read = 0 AND cm2.from_me = 0) as unread_count
            FROM chat_messages cm
            WHERE session_id = ?
            GROUP BY remote_jid
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        return stmt.all(sessionId, limit);
    }

    /**
     * Get chat message history for a specific contact
     */
    static getChatHistory(sessionId, remoteJid, limit = 100) {
        const stmt = db.prepare(`
            SELECT * FROM chat_messages 
            WHERE session_id = ? AND remote_jid = ?
            ORDER BY timestamp ASC
            LIMIT ?
        `);
        return stmt.all(sessionId, remoteJid, limit);
    }

    /**
     * Mark chat conversation as read
     */
    static markAsRead(sessionId, remoteJid) {
        const stmt = db.prepare(`
            UPDATE chat_messages 
            SET is_read = 1 
            WHERE session_id = ? AND remote_jid = ?
        `);
        return stmt.run(sessionId, remoteJid);
    }
}

module.exports = ChatMessage;
