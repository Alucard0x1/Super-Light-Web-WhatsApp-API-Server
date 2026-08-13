/**
 * AutoReply Model
 * Handles keyword-triggered auto-response rules
 */

const { db } = require('../config/database');
const crypto = require('crypto');

class AutoReply {
    /**
     * Create a new auto-reply rule
     */
    static create({ sessionId, keyword, matchType = 'exact', responseType = 'text', responsePayload, createdBy = null }) {
        if (!keyword || !responsePayload) {
            throw new Error('Keyword and response payload are required');
        }

        const id = crypto.randomUUID();
        const payloadStr = typeof responsePayload === 'object' ? JSON.stringify(responsePayload) : responsePayload;

        const stmt = db.prepare(`
            INSERT INTO auto_replies (id, session_id, keyword, match_type, response_type, response_payload, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `);

        stmt.run(id, sessionId || null, keyword.trim(), matchType, responseType, payloadStr, createdBy);
        return this.findById(id);
    }

    /**
     * Find auto-reply by ID
     */
    static findById(id) {
        const stmt = db.prepare('SELECT * FROM auto_replies WHERE id = ?');
        return stmt.get(id);
    }

    /**
     * Get all auto-replies, optionally filtered by user
     */
    static findAll(ownerEmail = null) {
        if (ownerEmail) {
            const stmt = db.prepare('SELECT * FROM auto_replies WHERE created_by = ? OR created_by IS NULL ORDER BY created_at DESC');
            return stmt.all(ownerEmail);
        }
        const stmt = db.prepare('SELECT * FROM auto_replies ORDER BY created_at DESC');
        return stmt.all();
    }

    /**
     * Get active auto-replies for a specific session (or global ones where session_id is null)
     */
    static findBySessionId(sessionId) {
        const stmt = db.prepare(`
            SELECT * FROM auto_replies 
            WHERE is_active = 1 AND (session_id = ? OR session_id IS NULL)
            ORDER BY created_at DESC
        `);
        return stmt.all(sessionId);
    }

    /**
     * Update an auto-reply rule
     */
    static update(id, updates) {
        const existing = this.findById(id);
        if (!existing) {
            throw new Error('Auto-reply rule not found');
        }

        const keyword = updates.keyword !== undefined ? updates.keyword.trim() : existing.keyword;
        const matchType = updates.matchType !== undefined ? updates.matchType : existing.match_type;
        const responseType = updates.responseType !== undefined ? updates.responseType : existing.response_type;
        const payloadStr = updates.responsePayload !== undefined 
            ? (typeof updates.responsePayload === 'object' ? JSON.stringify(updates.responsePayload) : updates.responsePayload)
            : existing.response_payload;
        const isActive = updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : existing.is_active;

        const stmt = db.prepare(`
            UPDATE auto_replies 
            SET keyword = ?, match_type = ?, response_type = ?, response_payload = ?, is_active = ?, updated_at = datetime('now')
            WHERE id = ?
        `);

        stmt.run(keyword, matchType, responseType, payloadStr, isActive, id);
        return this.findById(id);
    }

    /**
     * Delete an auto-reply rule
     */
    static delete(id) {
        const stmt = db.prepare('DELETE FROM auto_replies WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    /**
     * Find matching auto-reply rule for incoming text message
     */
    static findMatchingReply(sessionId, incomingText) {
        if (!incomingText || typeof incomingText !== 'string') return null;

        const rules = this.findBySessionId(sessionId);
        const cleanText = incomingText.trim();

        for (const rule of rules) {
            const keyword = rule.keyword.trim();
            let matched = false;

            try {
                if (rule.match_type === 'exact') {
                    matched = cleanText.toLowerCase() === keyword.toLowerCase();
                } else if (rule.match_type === 'contains') {
                    matched = cleanText.toLowerCase().includes(keyword.toLowerCase());
                } else if (rule.match_type === 'startsWith') {
                    matched = cleanText.toLowerCase().startsWith(keyword.toLowerCase());
                } else if (rule.match_type === 'regex') {
                    matched = new RegExp(keyword, 'i').test(cleanText);
                }
            } catch (err) {
                console.error(`[AutoReply] Invalid rule pattern for ID ${rule.id}:`, err.message);
            }

            if (matched) {
                return rule;
            }
        }
        return null;
    }
}

module.exports = AutoReply;
