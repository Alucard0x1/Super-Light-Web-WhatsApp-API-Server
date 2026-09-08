/**
 * Analytics & Metrics API Routes
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const Session = require('../models/Session');
const User = require('../models/User');

function authenticateAnalytics(req, res, next) {
    if (req.session && req.session.adminAuthed) {
        if (req.session.userId !== 'legacy-admin' && req.session.userEmail) {
            const user = User.findByEmail(req.session.userEmail);
            if (!user || !user.is_active) {
                return response.unauthorized(res, 'Login required');
            }
        }
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        const sessionRecord = Session.findByToken(token);
        if (sessionRecord) {
            return next();
        }
    }

    return response.unauthorized(res, 'Authentication required');
}

router.use(authenticateAnalytics);

/**
 * GET /api/v1/analytics/summary
 * Aggregate system-wide analytics summary
 */
router.get('/summary', (req, res) => {
    try {
        const totalSessions = db.prepare('SELECT COUNT(*) as count FROM whatsapp_sessions').get().count;
        const connectedSessions = db.prepare("SELECT COUNT(*) as count FROM whatsapp_sessions WHERE status = 'CONNECTED'").get().count;
        const totalAutoReplies = db.prepare('SELECT COUNT(*) as count FROM auto_replies WHERE is_active = 1').get().count;
        const totalChatMessages = db.prepare('SELECT COUNT(*) as count FROM chat_messages').get().count;

        let totalCampaigns = 0;
        let totalMessagesSent = 0;
        let totalLists = 0;

        try {
            const CampaignManager = require('../services/campaigns');
            const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
            if (encryptionKey) {
                const campaignManager = new CampaignManager(encryptionKey);
                const campaigns = campaignManager.getAllCampaigns(null, true);
                totalCampaigns = campaigns.length;
                totalMessagesSent = campaigns.reduce((acc, c) => acc + (c.statistics?.sent || 0), 0);
            }
        } catch (e) {
            totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get().count;
            totalMessagesSent = db.prepare("SELECT COUNT(*) as count FROM campaign_recipients WHERE status = 'sent'").get().count;
        }

        try {
            const RecipientListManager = require('../services/recipient-lists');
            const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
            if (encryptionKey) {
                const listManager = new RecipientListManager(encryptionKey);
                const lists = listManager.getAllLists(null, true);
                totalLists = lists.length;
            }
        } catch (e) {
            totalLists = db.prepare('SELECT COUNT(*) as count FROM recipient_lists').get().count;
        }

        try {
            const directFromLogs = db.prepare("SELECT COUNT(*) as count FROM activity_logs WHERE action = 'MESSAGE_SEND'").get().count;
            totalMessagesSent += directFromLogs;
        } catch (e) {}

        return response.success(res, {
            totalSessions,
            connectedSessions,
            totalCampaigns,
            totalMessagesSent,
            totalAutoReplies,
            totalLists,
            totalChatMessages
        });
    } catch (err) {
        return response.error(res, err.message);
    }
});

/**
 * GET /api/v1/analytics/trends
 * Hourly message distribution for Chart.js graphs
 */
router.get('/trends', (req, res) => {
    try {
        const trends = db.prepare(`
            SELECT 
                strftime('%Y-%m-%d %H:00', timestamp) as hour,
                COUNT(*) as count
            FROM chat_messages
            WHERE timestamp >= datetime('now', '-24 hours')
            GROUP BY hour
            ORDER BY hour ASC
        `).all();

        return response.success(res, trends);
    } catch (err) {
        return response.error(res, err.message);
    }
});

module.exports = router;
