/**
 * ActivityLog Model
 * SQLite-based activity logging
 */

const { db } = require('../config/database');

class ActivityLog {
    /**
     * Log an activity
     * @param {object} data - Activity data
     * @returns {object} Created log entry
     */
    static log(data) {
        const stmt = db.prepare(`
            INSERT INTO activity_logs (
                user_email, action, resource, resource_id, details, ip, user_agent, success, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `);

        const result = stmt.run(
            data.userEmail || null,
            data.action,
            data.resource || null,
            data.resourceId || null,
            data.details ? JSON.stringify(data.details) : null,
            data.ip || null,
            data.userAgent || null,
            data.success !== false ? 1 : 0
        );

        return { id: result.lastInsertRowid };
    }

    /**
     * Get activities with optional filters
     * @param {object} options - Filter options
     * @returns {array} Array of activities
     */
    static getAll(options = {}) {
        const { userEmail, action, resource, startDate, endDate, limit = 100 } = options;

        let sql = 'SELECT * FROM activity_logs WHERE 1=1';
        const params = [];

        if (userEmail) {
            sql += ' AND user_email = ?';
            params.push(userEmail);
        }

        if (action) {
            sql += ' AND action = ?';
            params.push(action);
        }

        if (resource) {
            sql += ' AND resource = ?';
            params.push(resource);
        }

        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }

        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const stmt = db.prepare(sql);
        return stmt.all(...params).map(row => ({
            ...row,
            details: row.details ? JSON.parse(row.details) : null
        }));
    }

    /**
     * Get activity summary for dashboard
     * @param {string} userEmail - Filter by user (optional)
     * @param {number} days - Number of days to look back
     * @returns {object} Summary statistics
     */
    static getSummary(userEmail = null, days = 7) {
        // Calculate date limit in JS to ensure cross-env consistency
        const date = new Date();
        date.setDate(date.getDate() - (parseInt(days) || 7));
        const dateLimit = date.toISOString().replace('T', ' ').split('.')[0];

        console.log(`[ActivityLog] Generating summary for ${days} days (since ${dateLimit} UTC)`);

        let sqlBase = `FROM activity_logs WHERE created_at >= ?`;
        const params = [dateLimit];
        if (userEmail) {
            sqlBase += ' AND user_email = ?';
            params.push(userEmail);
        }

        try {
            // 1. Total activities in range
            const totalStmt = db.prepare(`SELECT COUNT(*) as count ${sqlBase}`);
            const totalResult = totalStmt.get(...params);
            const totalActivities = totalResult ? totalResult.count : 0;

            console.log(`[ActivityLog] Total activities in range: ${totalActivities}`);

            // 2. Group by action (with normalization for cards)
            const actionStmt = db.prepare(`SELECT action, COUNT(*) as count ${sqlBase} GROUP BY action`);
            const actionRows = actionStmt.all(...params);

            const byAction = actionRows.reduce((acc, row) => {
                let key = row.action.toLowerCase();
                // Normalized keys for standard frontend cards
                if (key.includes('message_send') || key.includes('campaign_message')) {
                    acc['send_message'] = (acc['send_message'] || 0) + row.count;
                }
                if (key.includes('session_create') || key === 'create') {
                    acc['create'] = (acc['create'] || 0) + row.count;
                }

                // Keep the raw key for details
                acc[key] = (acc[key] || 0) + row.count;
                return acc;
            }, {});

            // 3. Group by user
            const userStmt = db.prepare(`SELECT user_email, COUNT(*) as count ${sqlBase} GROUP BY user_email`);
            const userRows = userStmt.all(...params);
            const byUser = userRows.reduce((acc, row) => {
                acc[row.user_email || 'anonymous'] = row.count;
                return acc;
            }, {});

            return {
                totalActivities,
                byUser,
                byAction
            };
        } catch (error) {
            console.error('[ActivityLog] ERROR in getSummary:', error);
            return { totalActivities: 0, byUser: {}, byAction: {} };
        }
    }

    /**
     * Helper: Log login attempt
     */
    static logLogin(userEmail, ip, userAgent, success = true) {
        return this.log({
            userEmail,
            action: 'LOGIN',
            resource: 'auth',
            ip,
            userAgent,
            success
        });
    }

    /**
     * Helper: Log session creation
     */
    static logSessionCreate(userEmail, sessionId, ip, userAgent) {
        return this.log({
            userEmail,
            action: 'SESSION_CREATE',
            resource: 'session',
            resourceId: sessionId,
            ip,
            userAgent
        });
    }

    /**
     * Helper: Log session deletion
     */
    static logSessionDelete(userEmail, sessionId, ip, userAgent) {
        return this.log({
            userEmail,
            action: 'SESSION_DELETE',
            resource: 'session',
            resourceId: sessionId,
            ip,
            userAgent
        });
    }

    /**
     * Helper: Log message send
     */
    static logMessageSend(userEmail, sessionId, recipient, messageType, ip, userAgent) {
        return this.log({
            userEmail,
            action: 'MESSAGE_SEND',
            resource: 'message',
            resourceId: sessionId,
            details: { recipient, messageType },
            ip,
            userAgent
        });
    }

    /**
     * Helper: Log campaign action
     */
    static logCampaign(userEmail, action, campaignId, details = null) {
        return this.log({
            userEmail,
            action: `CAMPAIGN_${action.toUpperCase()}`,
            resource: 'campaign',
            resourceId: campaignId,
            details
        });
    }

    static logCampaignCreate(userEmail, campaignId, name, recipientCount) {
        return this.logCampaign(userEmail, 'CREATE', campaignId, { name, recipientCount });
    }

    static logCampaignUpdate(userEmail, campaignId, name, changes) {
        return this.logCampaign(userEmail, 'UPDATE', campaignId, { name, changes });
    }

    static logCampaignDelete(userEmail, campaignId, name) {
        return this.logCampaign(userEmail, 'DELETE', campaignId, { name });
    }

    static logCampaignStart(userEmail, campaignId, name, recipientCount) {
        return this.logCampaign(userEmail, 'START', campaignId, { name, recipientCount });
    }

    static logCampaignPause(userEmail, campaignId, reason) {
        return this.logCampaign(userEmail, 'PAUSE', campaignId, { reason });
    }

    static logCampaignResume(userEmail, campaignId, name) {
        return this.logCampaign(userEmail, 'RESUME', campaignId, { name });
    }

    static logCampaignComplete(userEmail, campaignId, name, statistics) {
        return this.logCampaign(userEmail, 'COMPLETE', campaignId, { name, statistics });
    }

    static logCampaignRetry(userEmail, campaignId, name, retryCount) {
        return this.logCampaign(userEmail, 'RETRY', campaignId, { name, retryCount });
    }

    static logCampaignMessage(userEmail, campaignId, recipient, status, error = null) {
        return this.logCampaign(userEmail, 'MESSAGE', campaignId, { recipient, status, error });
    }

    /**
     * Helper: Log user management action
     */
    static logUserAction(userEmail, action, resource, resourceId, details) {
        return this.log({
            userEmail,
            action,
            resource,
            resourceId,
            details
        });
    }

    /**
     * Clean old logs
     * @param {number} daysToKeep - Number of days to keep
     * @returns {number} Number of deleted logs
     */
    static cleanOld(daysToKeep = 30) {
        const stmt = db.prepare(`
            DELETE FROM activity_logs 
            WHERE created_at < datetime('now', '-' || ? || ' days')
        `);
        const result = stmt.run(daysToKeep);
        return result.changes;
    }

    /**
     * Clear all logs
     * @returns {number} Number of deleted logs
     */
    static clearAll() {
        const stmt = db.prepare('DELETE FROM activity_logs');
        const result = stmt.run();
        return result.changes;
    }
}

module.exports = ActivityLog;
