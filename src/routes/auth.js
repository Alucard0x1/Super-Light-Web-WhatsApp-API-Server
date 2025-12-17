/**
 * Authentication Routes
 * Handles login, logout, and user authentication
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { requireAuth, requireAdmin, getCurrentUser } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const response = require('../utils/response');

// Environment config
const ADMIN_PASSWORD = process.env.ADMIN_DASHBOARD_PASSWORD;

/**
 * POST /admin/login
 * Login with email/password or legacy password-only
 */
router.post('/login', asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];

    // Debug logging
    console.log('Login attempt:', {
        email: email || '(empty)',
        passwordProvided: !!password,
        passwordLength: password?.length || 0
    });

    // Legacy password-only login for admin (now requires username 'admin')
    if (email === 'admin' && password) {
        if (password === ADMIN_PASSWORD) {
            req.session.adminAuthed = true;
            req.session.userEmail = 'admin@localhost';
            req.session.userRole = 'admin';
            req.session.userId = 'legacy-admin';

            // Explicitly save session before responding
            return req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return response.serverError(res, 'Session error');
                }

                ActivityLog.logLogin('admin@localhost', ip, userAgent, true);

                return response.success(res, {
                    role: 'admin',
                    email: 'admin@localhost'
                });
            });
        }
    }

    // Email/password login
    if (email && password) {
        const user = await User.authenticate(email, password);
        if (user) {
            req.session.adminAuthed = true;
            req.session.userEmail = user.email;
            req.session.userRole = user.role;
            req.session.userId = user.id;

            // Explicitly save session before responding
            return req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return response.serverError(res, 'Session error');
                }

                ActivityLog.logLogin(user.email, ip, userAgent, true);

                return response.success(res, {
                    role: user.role,
                    email: user.email
                });
            });
        }
    }

    await ActivityLog.logLogin(email || 'unknown', ip, userAgent, false);
    return response.unauthorized(res, 'Invalid credentials');
}));

/**
 * POST /admin/logout
 * Logout and destroy session
 */
router.post('/logout', requireAuth, (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        return response.success(res, { redirect: '/admin/login.html' });
    });
});

/**
 * GET /admin/me
 * Get current user info
 */
router.get('/me', requireAuth, (req, res) => {
    const user = getCurrentUser(req);
    return response.success(res, user);
});

/**
 * GET /admin/ws-token
 * Get WebSocket authentication token
 */
router.get('/ws-token', requireAuth, (req, res) => {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    // Store in session for validation
    req.session.wsToken = token;

    return response.success(res, { token });
});

module.exports = router;
