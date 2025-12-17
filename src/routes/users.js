/**
 * User Management Routes
 * Admin CRUD operations for users
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const { requireAuth, requireAdmin, getCurrentUser } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const response = require('../utils/response');

/**
 * GET /admin/users
 * Get all users (admin only)
 */
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
    const users = User.getAll();
    return response.success(res, users);
}));

/**
 * POST /admin/users
 * Create a new user (admin only)
 */
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
    const { email, password, role } = req.body;
    const currentUser = getCurrentUser(req);

    if (!email || !password) {
        return response.validationError(res, ['Email and password are required']);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return response.validationError(res, ['Invalid email format']);
    }

    try {
        const user = await User.create({
            email,
            password,
            role: role || 'user',
            createdBy: currentUser.email
        });

        await ActivityLog.log({
            userEmail: currentUser.email,
            action: 'USER_CREATE',
            resource: 'user',
            resourceId: user.id,
            details: { newUserEmail: email, role: role || 'user' },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        return response.success(res, user, 201);
    } catch (err) {
        if (err.message === 'User already exists') {
            return response.error(res, 'User with this email already exists', 409);
        }
        throw err;
    }
}));

/**
 * PUT /admin/users/:email
 * Update a user (admin only)
 */
router.put('/:email', requireAdmin, asyncHandler(async (req, res) => {
    const { email } = req.params;
    const updates = req.body;
    const currentUser = getCurrentUser(req);

    const existingUser = User.findByEmail(email);
    if (!existingUser) {
        return response.notFound(res, 'User not found');
    }

    try {
        const user = await User.update(existingUser.id, updates);

        await ActivityLog.log({
            userEmail: currentUser.email,
            action: 'USER_UPDATE',
            resource: 'user',
            resourceId: existingUser.id,
            details: { targetEmail: email, updates: Object.keys(updates) },
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        return response.success(res, user);
    } catch (err) {
        if (err.message === 'User not found') {
            return response.notFound(res, 'User not found');
        }
        throw err;
    }
}));

/**
 * DELETE /admin/users/:email
 * Delete a user (admin only)
 */
router.delete('/:email', requireAdmin, asyncHandler(async (req, res) => {
    const { email } = req.params;
    const currentUser = getCurrentUser(req);

    const existingUser = User.findByEmail(email);
    if (!existingUser) {
        return response.notFound(res, 'User not found');
    }

    // Prevent self-deletion
    if (email.toLowerCase() === currentUser.email.toLowerCase()) {
        return response.error(res, 'Cannot delete your own account', 400);
    }

    const deleted = User.delete(existingUser.id);
    if (!deleted) {
        return response.error(res, 'Failed to delete user', 500);
    }

    await ActivityLog.log({
        userEmail: currentUser.email,
        action: 'USER_DELETE',
        resource: 'user',
        resourceId: existingUser.id,
        details: { deletedEmail: email },
        ip: req.ip,
        userAgent: req.headers['user-agent']
    });

    return response.success(res, { message: 'User deleted' });
}));

module.exports = router;
