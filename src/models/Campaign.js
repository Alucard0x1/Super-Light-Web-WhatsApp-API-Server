/**
 * Campaign Model
 * SQLite-based campaign management
 */

const { db } = require('../config/database');
const crypto = require('crypto');

class Campaign {
    /**
     * Create a new campaign
     * @param {object} data - Campaign data
     * @returns {object} Created campaign
     */
    static create(data) {
        const id = crypto.randomUUID().slice(0, 8);

        const stmt = db.prepare(`
            INSERT INTO campaigns (
                id, name, description, status, session_id, message_content, message_type,
                media_url, message_delay_min, message_delay_max, created_by,
                created_at, updated_at, scheduled_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)
        `);

        stmt.run(
            id,
            data.name,
            data.description || null,
            data.status || 'draft',
            data.sessionId || null,
            data.messageContent || null,
            data.messageType || 'text',
            data.mediaUrl || null,
            data.messageDelayMin || 3,
            data.messageDelayMax || 8,
            data.createdBy,
            data.scheduledAt || null
        );

        return this.findById(id);
    }

    /**
     * Find campaign by ID
     * @param {string} id - Campaign ID
     * @returns {object|null} Campaign object or null
     */
    static findById(id) {
        const stmt = db.prepare('SELECT * FROM campaigns WHERE id = ?');
        const campaign = stmt.get(id);
        if (!campaign) return null;

        // Get recipient statistics
        campaign.statistics = this.getStatistics(id);
        return campaign;
    }

    /**
     * Get all campaigns
     * @param {string} ownerEmail - Filter by owner (optional)
     * @param {boolean} isAdmin - If true, return all campaigns
     * @returns {array} Array of campaigns
     */
    static getAll(ownerEmail = null, isAdmin = false) {
        let campaigns;

        if (isAdmin || !ownerEmail) {
            const stmt = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC');
            campaigns = stmt.all();
        } else {
            const stmt = db.prepare('SELECT * FROM campaigns WHERE created_by = ? ORDER BY created_at DESC');
            campaigns = stmt.all(ownerEmail.toLowerCase());
        }

        // Add statistics to each campaign
        return campaigns.map(c => ({
            ...c,
            statistics: this.getStatistics(c.id)
        }));
    }

    /**
     * Update campaign
     * @param {string} id - Campaign ID
     * @param {object} updates - Fields to update
     * @returns {object} Updated campaign
     */
    static update(id, updates) {
        const campaign = this.findById(id);
        if (!campaign) {
            throw new Error('Campaign not found');
        }

        const allowedFields = [
            'name', 'description', 'status', 'session_id', 'message_content',
            'message_type', 'media_url', 'message_delay_min', 'message_delay_max',
            'scheduled_at', 'started_at', 'completed_at'
        ];

        const fieldsToUpdate = Object.keys(updates).filter(k => allowedFields.includes(k));

        if (fieldsToUpdate.length === 0) {
            return campaign;
        }

        fieldsToUpdate.push('updated_at');
        const setClause = fieldsToUpdate.map(f => `${f} = ?`).join(', ');
        const values = fieldsToUpdate.slice(0, -1).map(f => updates[f]);
        values.push("datetime('now')");

        // Use raw SQL for datetime
        const sql = `UPDATE campaigns SET ${fieldsToUpdate.slice(0, -1).map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`;
        const stmt = db.prepare(sql);
        stmt.run(...fieldsToUpdate.slice(0, -1).map(f => updates[f]), id);

        return this.findById(id);
    }

    /**
     * Update campaign status
     * @param {string} id - Campaign ID
     * @param {string} status - New status
     * @returns {object} Updated campaign
     */
    static updateStatus(id, status) {
        const updates = { status };

        if (status === 'sending') {
            const stmt = db.prepare(`
                UPDATE campaigns SET status = ?, started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
            `);
            stmt.run(status, id);
        } else if (status === 'completed') {
            const stmt = db.prepare(`
                UPDATE campaigns SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
            `);
            stmt.run(status, id);
        } else {
            const stmt = db.prepare(`
                UPDATE campaigns SET status = ?, updated_at = datetime('now') WHERE id = ?
            `);
            stmt.run(status, id);
        }

        return this.findById(id);
    }

    /**
     * Delete campaign
     * @param {string} id - Campaign ID
     * @returns {boolean} True if deleted
     */
    static delete(id) {
        // Recipients will be deleted via CASCADE
        const stmt = db.prepare('DELETE FROM campaigns WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    /**
     * Get campaign statistics
     * @param {string} id - Campaign ID
     * @returns {object} Statistics
     */
    static getStatistics(id) {
        const stmt = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'retry' THEN 1 ELSE 0 END) as retry
            FROM campaign_recipients WHERE campaign_id = ?
        `);
        return stmt.get(id) || { total: 0, pending: 0, sent: 0, failed: 0, retry: 0 };
    }

    /**
     * Get scheduled campaigns that should start now
     * @returns {array} Array of campaigns to start
     */
    static getScheduledToStart() {
        const stmt = db.prepare(`
            SELECT * FROM campaigns 
            WHERE status = 'ready' 
            AND scheduled_at IS NOT NULL 
            AND scheduled_at <= datetime('now')
        `);
        return stmt.all();
    }
}

module.exports = Campaign;
