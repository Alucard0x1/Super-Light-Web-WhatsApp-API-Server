/**
 * WhatsApp Session Model
 * SQLite-based session metadata management
 * Note: Actual auth credentials stored in auth_info_baileys folder
 */

const { db } = require('../config/database');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(process.cwd(), 'auth_info_baileys');

class Session {
    /**
     * Create a new session
     * @param {string} sessionId - Session ID
     * @param {string} ownerEmail - Owner's email
     * @returns {object} Created session
     */
    static create(sessionId, ownerEmail = null) {
        const existingSession = this.findById(sessionId);
        if (existingSession) {
            throw new Error('Session already exists');
        }

        const token = crypto.randomUUID();

        const stmt = db.prepare(`
            INSERT INTO whatsapp_sessions (id, owner_email, token, status, created_at, updated_at)
            VALUES (?, ?, ?, 'CREATING', datetime('now'), datetime('now'))
        `);

        stmt.run(sessionId, ownerEmail, token);

        return this.findById(sessionId);
    }

    /**
     * Find session by ID
     * @param {string} sessionId - Session ID
     * @returns {object|null} Session object or null
     */
    static findById(sessionId) {
        const stmt = db.prepare('SELECT * FROM whatsapp_sessions WHERE id = ?');
        return stmt.get(sessionId);
    }

    /**
     * Find session by token
     * @param {string} token - Session token
     * @returns {object|null} Session object or null
     */
    static findByToken(token) {
        const stmt = db.prepare('SELECT * FROM whatsapp_sessions WHERE token = ?');
        return stmt.get(token);
    }

    /**
     * Get all sessions
     * @param {string} ownerEmail - Filter by owner (optional)
     * @param {boolean} isAdmin - If true, return all sessions
     * @returns {array} Array of sessions
     */
    static getAll(ownerEmail = null, isAdmin = false) {
        if (isAdmin || !ownerEmail) {
            const stmt = db.prepare('SELECT * FROM whatsapp_sessions ORDER BY created_at DESC');
            return stmt.all();
        }

        const stmt = db.prepare('SELECT * FROM whatsapp_sessions WHERE owner_email = ? ORDER BY created_at DESC');
        return stmt.all(ownerEmail);
    }

    /**
     * Update session status
     * @param {string} sessionId - Session ID
     * @param {string} status - New status
     * @param {string} detail - Status detail
     * @returns {object} Updated session
     */
    static updateStatus(sessionId, status, detail = null) {
        const stmt = db.prepare(`
            UPDATE whatsapp_sessions 
            SET status = ?, detail = ?, updated_at = datetime('now')
            WHERE id = ?
        `);
        stmt.run(status, detail, sessionId);
        return this.findById(sessionId);
    }

    /**
     * Delete session
     * @param {string} sessionId - Session ID
     * @returns {boolean} True if deleted
     */
    static delete(sessionId) {
        const stmt = db.prepare('DELETE FROM whatsapp_sessions WHERE id = ?');
        const result = stmt.run(sessionId);
        return result.changes > 0;
    }

    /**
     * Get session token
     * @param {string} sessionId - Session ID
     * @returns {string|null} Token or null
     */
    static getToken(sessionId) {
        const session = this.findById(sessionId);
        return session ? session.token : null;
    }

    /**
     * Validate token for a session
     * @param {string} sessionId - Session ID
     * @param {string} token - Token to validate
     * @returns {boolean} True if valid
     */
    static validateToken(sessionId, token) {
        const session = this.findById(sessionId);
        return session && session.token === token;
    }

    /**
     * Count active sessions
     * @returns {number} Count of non-disconnected sessions
     */
    static countActive() {
        const stmt = db.prepare(`
            SELECT COUNT(*) as count FROM whatsapp_sessions 
            WHERE status NOT IN ('DISCONNECTED', 'DELETED')
        `);
        return stmt.get().count;
    }

    /**
     * Get sessions by owner
     * @param {string} ownerEmail - Owner's email
     * @returns {array} Array of session IDs
     */
    static getSessionIdsByOwner(ownerEmail) {
        const stmt = db.prepare('SELECT id FROM whatsapp_sessions WHERE owner_email = ?');
        return stmt.all(ownerEmail.toLowerCase()).map(s => s.id);
    }

    /**
     * Sync database with filesystem
     * Detects session folders that are not in the DB and adds them
     * Only syncs folders containing valid WhatsApp auth data (creds.json)
     */
    static syncWithFilesystem() {
        if (!fs.existsSync(SESSION_DIR)) {
            return;
        }

        const { isValidId } = require('../utils/validation');
        const entries = fs.readdirSync(SESSION_DIR, { withFileTypes: true });
        const directories = entries
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        console.log(`[Session] Found ${directories.length} session folder(s) on disk: ${directories.join(', ')}`);

        const insertStmt = db.prepare(`
            INSERT OR IGNORE INTO whatsapp_sessions (id, owner_email, token, status, created_at, updated_at)
            VALUES (?, 'admin@localhost', ?, 'DISCONNECTED', datetime('now'), datetime('now'))
        `);

        let addedCount = 0;
        let skippedCount = 0;
        for (const sessionId of directories) {
            // Skip invalid session IDs
            if (!isValidId(sessionId)) {
                console.log(`[Session] Skipping invalid session folder: ${sessionId}`);
                skippedCount++;
                continue;
            }

            // Only sync folders that contain actual WhatsApp auth data (creds.json)
            const credsPath = path.join(SESSION_DIR, sessionId, 'creds.json');
            if (!fs.existsSync(credsPath)) {
                console.log(`[Session] Skipping folder without creds.json: ${sessionId}`);
                skippedCount++;
                continue;
            }

            // Check if exists in database
            const exists = this.findById(sessionId);
            if (!exists) {
                const token = crypto.randomUUID();
                insertStmt.run(sessionId, token);
                addedCount++;
                console.log(`[Session] Registered orphan session from disk: ${sessionId}`);
            }
        }

        if (skippedCount > 0) {
            console.log(`[Session] Skipped ${skippedCount} non-session folder(s)`);
        }

        if (addedCount > 0) {
            console.log(`[Session] Synced ${addedCount} sessions from disk to database`);
        }
    }
}

module.exports = Session;
