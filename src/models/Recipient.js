/**
 * Recipient Model
 * SQLite-based campaign recipient management
 */

const { db } = require('../config/database');

class Recipient {
    /**
     * Add recipients to a campaign
     * @param {string} campaignId - Campaign ID
     * @param {array} recipients - Array of recipient objects {number, name, customFields}
     * @returns {number} Number of recipients added
     */
    static addBulk(campaignId, recipients) {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO campaign_recipients (campaign_id, number, name, custom_fields, status)
            VALUES (?, ?, ?, ?, 'pending')
        `);

        const insertMany = db.transaction((items) => {
            for (const r of items) {
                stmt.run(
                    campaignId,
                    r.number,
                    r.name || null,
                    r.customFields ? JSON.stringify(r.customFields) : null
                );
            }
        });

        insertMany(recipients);
        return recipients.length;
    }

    /**
     * Get pending recipients for sending
     * @param {string} campaignId - Campaign ID
     * @param {number} limit - Max recipients to return
     * @returns {array} Array of recipients
     */
    static getPending(campaignId, limit = 100) {
        const stmt = db.prepare(`
            SELECT * FROM campaign_recipients 
            WHERE campaign_id = ? AND status IN ('pending', 'retry')
            ORDER BY id ASC
            LIMIT ?
        `);
        return stmt.all(campaignId, limit).map(r => ({
            ...r,
            customFields: r.custom_fields ? JSON.parse(r.custom_fields) : {}
        }));
    }

    /**
     * Update recipient status
     * @param {string} campaignId - Campaign ID
     * @param {string} number - Recipient number
     * @param {string} status - New status
     * @param {string} error - Error message (optional)
     */
    static updateStatus(campaignId, number, status, error = null) {
        const stmt = db.prepare(`
            UPDATE campaign_recipients 
            SET status = ?, error = ?, sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END
            WHERE campaign_id = ? AND number = ?
        `);
        stmt.run(status, error, status, campaignId, number);
    }

    /**
     * Mark recipient for retry
     * @param {string} campaignId - Campaign ID
     * @param {string} number - Recipient number
     */
    static markForRetry(campaignId, number) {
        const stmt = db.prepare(`
            UPDATE campaign_recipients 
            SET status = 'retry', retry_count = retry_count + 1
            WHERE campaign_id = ? AND number = ?
        `);
        stmt.run(campaignId, number);
    }

    /**
     * Get all recipients for a campaign
     * @param {string} campaignId - Campaign ID
     * @returns {array} Array of recipients
     */
    static getByCampaign(campaignId) {
        const stmt = db.prepare('SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY id');
        return stmt.all(campaignId).map(r => ({
            ...r,
            customFields: r.custom_fields ? JSON.parse(r.custom_fields) : {}
        }));
    }

    /**
     * Delete all recipients for a campaign
     * @param {string} campaignId - Campaign ID
     * @returns {number} Number of deleted recipients
     */
    static deleteByCampaign(campaignId) {
        const stmt = db.prepare('DELETE FROM campaign_recipients WHERE campaign_id = ?');
        const result = stmt.run(campaignId);
        return result.changes;
    }

    /**
     * Reset failed recipients to pending
     * @param {string} campaignId - Campaign ID
     * @returns {number} Number of reset recipients
     */
    static resetFailed(campaignId) {
        const stmt = db.prepare(`
            UPDATE campaign_recipients 
            SET status = 'retry', retry_count = retry_count + 1
            WHERE campaign_id = ? AND status = 'failed'
        `);
        const result = stmt.run(campaignId);
        return result.changes;
    }

    /**
     * Get recipient count by status
     * @param {string} campaignId - Campaign ID
     * @returns {object} Count by status
     */
    static countByStatus(campaignId) {
        const stmt = db.prepare(`
            SELECT status, COUNT(*) as count 
            FROM campaign_recipients 
            WHERE campaign_id = ? 
            GROUP BY status
        `);
        const rows = stmt.all(campaignId);
        return rows.reduce((acc, row) => {
            acc[row.status] = row.count;
            return acc;
        }, { pending: 0, sent: 0, failed: 0, retry: 0 });
    }
}

module.exports = Recipient;
