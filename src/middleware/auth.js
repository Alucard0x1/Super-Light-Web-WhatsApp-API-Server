/**
 * Authentication Middleware
 * Handles session-based authentication for admin dashboard
 */

const response = require('../utils/response');
const User = require('../models/User');

/**
 * Require admin authentication
 * Re-validates against the users table on every request so that
 * deactivated users and role downgrades take effect immediately.
 */
function requireAuth(req, res, next) {
    if (!req.session || !req.session.adminAuthed) {
        return response.unauthorized(res, 'Login required');
    }

    // Legacy admin session (no user row) — keep as-is
    if (req.session.userId === 'legacy-admin') {
        return next();
    }

    const user = User.findByEmail(req.session.userEmail);
    if (!user || !user.is_active) {
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            return response.unauthorized(res, 'Login required');
        });
        return;
    }

    // Sync role changes (e.g. admin demoted a user) without a re-login
    if (user.role !== req.session.userRole) {
        req.session.userRole = user.role;
        req.session.save(() => {});
    }

    next();
}

/**
 * Require admin role
 * Used for admin-only operations
 */
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminAuthed) {
        return response.unauthorized(res, 'Login required');
    }

    if (req.session.userRole !== 'admin') {
        return response.forbidden(res, 'Admin access required');
    }

    next();
}

/**
 * Get current user from session
 * @param {object} req - Express request
 * @returns {object|null} Current user info
 */
function getCurrentUser(req) {
    if (!req.session || !req.session.adminAuthed) {
        return null;
    }

    return {
        email: req.session.userEmail,
        role: req.session.userRole,
        id: req.session.userId
    };
}

/**
 * Attach user to request
 * Adds req.user for convenience
 */
function attachUser(req, res, next) {
    req.user = getCurrentUser(req);
    next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    getCurrentUser,
    attachUser
};
