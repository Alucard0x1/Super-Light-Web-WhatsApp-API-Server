/**
 * Analytics & Metrics API Routes
 */

const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const response = require('../utils/response');

/**
 * GET /api/v1/analytics/summary
 * Aggregate system-wide analytics summary
 */
router.get('/summary', (req, res) => {
    try {
        const totalSessions = db.prepare('SELECT COUNT(*) as count FROM whatsapp_sessions').get().count;
        const connectedSessions = db.prepare("SELECT COUNT(*) as count FROM whatsapp_sessions WHERE status = 'CONNECTED'").get().count;
        const totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get().count;
        const totalMessagesSent = db.prepare("SELECT COUNT(*) as count FROM campaign_recipients WHERE status = 'sent'").get().count;
        const totalAutoReplies = db.prepare('SELECT COUNT(*) as count FROM auto_replies WHERE is_active = 1').get().count;
        const totalLists = db.prepare('SELECT COUNT(*) as count FROM recipient_lists').get().count;
        const totalChatMessages = db.prepare('SELECT COUNT(*) as count FROM chat_messages').get().count;

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
