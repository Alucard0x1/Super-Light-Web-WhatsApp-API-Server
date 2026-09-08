/**
 * Auto-Reply Rules API Routes
 */

const express = require('express');
const router = express.Router();
const AutoReply = require('../models/AutoReply');
const Session = require('../models/Session');
const User = require('../models/User');
const response = require('../utils/response');

function authenticateAutoReply(req, res, next) {
    if (req.session && req.session.adminAuthed) {
        if (req.session.userId !== 'legacy-admin' && req.session.userEmail) {
            const user = User.findByEmail(req.session.userEmail);
            if (!user || !user.is_active) {
                return response.unauthorized(res, 'Login required');
            }
        }
        req.currentUser = { email: req.session.userEmail, role: req.session.userRole };
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        const sessionRecord = Session.findByToken(token);
        if (sessionRecord) {
            req.currentUser = { email: sessionRecord.owner_email || 'api-user', role: 'user', sessionId: sessionRecord.id };
            return next();
        }
    }

    return response.unauthorized(res, 'Authentication required');
}

router.use(authenticateAutoReply);

/**
 * GET /api/v1/auto-replies
 * List auto-replies
 */
router.get('/', (req, res) => {
    try {
        const userEmail = req.currentUser.role !== 'admin' ? req.currentUser.email : null;
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
        const createdBy = req.currentUser.email;

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
        if (req.currentUser.role !== 'admin' && rule.created_by && rule.created_by !== req.currentUser.email) {
            return response.forbidden(res, 'Access denied');
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
        const existing = AutoReply.findById(req.params.id);
        if (!existing) {
            return response.notFound(res, 'Auto-reply rule not found');
        }
        if (req.currentUser.role !== 'admin' && existing.created_by && existing.created_by !== req.currentUser.email) {
            return response.forbidden(res, 'Access denied');
        }
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
        const existing = AutoReply.findById(req.params.id);
        if (!existing) {
            return response.notFound(res, 'Auto-reply rule not found');
        }
        if (req.currentUser.role !== 'admin' && existing.created_by && existing.created_by !== req.currentUser.email) {
            return response.forbidden(res, 'Access denied');
        }
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
