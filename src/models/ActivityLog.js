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
        const dateLimit = `datetime('now', '-${days} days')`;

        let sql = `
            SELECT 
                action,
                COUNT(*) as count,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count
            FROM activity_logs 
            WHERE created_at >= ${dateLimit}
        `;

        const params = [];
        if (userEmail) {
            sql += ' AND user_email = ?';
            params.push(userEmail);
        }

        sql += ' GROUP BY action';

        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);

        return rows.reduce((acc, row) => {
            acc[row.action] = {
                total: row.count,
                success: row.success_count,
                failed: row.failure_count
            };
            return acc;
        }, {});
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
}

module.exports = ActivityLog;
