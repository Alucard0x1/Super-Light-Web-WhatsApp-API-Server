/**
 * Authentication Middleware
 * Handles session-based authentication for admin dashboard
 */

const response = require('../utils/response');

/**
 * Require admin authentication
 * Used for protected dashboard routes
 */
function requireAuth(req, res, next) {
    if (!req.session || !req.session.adminAuthed) {
        return response.unauthorized(res, 'Login required');
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
