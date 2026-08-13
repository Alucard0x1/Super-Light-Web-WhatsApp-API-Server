/**
 * Auto-Reply Rules API Routes
 */

const express = require('express');
const router = express.Router();
const AutoReply = require('../models/AutoReply');
const response = require('../utils/response');

/**
 * GET /api/v1/auto-replies
 * List auto-replies
 */
router.get('/', (req, res) => {
    try {
        const userEmail = req.session && req.session.userRole !== 'admin' ? req.session.userEmail : null;
        const rules = AutoReply.findAll(userEmail);
        return response.success(res, rules);
    } catch (err) {
        return response.error(res, err.message);
    }
});

/**
 * POST /api/v1/auto-replies
 * Create auto-reply rule
 */
router.post('/', (req, res) => {
    try {
        const { sessionId, keyword, matchType, responseType, responsePayload } = req.body;
        const createdBy = req.session ? req.session.userEmail : null;

        if (!keyword || !responsePayload) {
            return response.badRequest(res, 'Keyword and responsePayload are required');
        }

        const rule = AutoReply.create({
            sessionId: sessionId || null,
            keyword,
            matchType: matchType || 'exact',
            responseType: responseType || 'text',
            responsePayload,
            createdBy
        });

        return response.created(res, rule);
    } catch (err) {
        return response.error(res, err.message);
    }
});

/**
 * GET /api/v1/auto-replies/:id
 */
router.get('/:id', (req, res) => {
    try {
        const rule = AutoReply.findById(req.params.id);
        if (!rule) {
            return response.notFound(res, 'Auto-reply rule not found');
        }
        return response.success(res, rule);
    } catch (err) {
        return response.error(res, err.message);
    }
});

/**
 * PUT /api/v1/auto-replies/:id
 */
router.put('/:id', (req, res) => {
    try {
        const rule = AutoReply.update(req.params.id, req.body);
        return response.success(res, rule);
    } catch (err) {
        return response.error(res, err.message);
    }
});

/**
 * DELETE /api/v1/auto-replies/:id
 */
router.delete('/:id', (req, res) => {
    try {
        const success = AutoReply.delete(req.params.id);
        if (!success) {
            return response.notFound(res, 'Auto-reply rule not found');
        }
        return response.success(res, { message: 'Auto-reply rule deleted successfully' });
    } catch (err) {
        return response.error(res, err.message);
    }
});

module.exports = router;
