/**
 * User Model
 * SQLite-based user management with bcrypt password hashing
 */

const { db } = require('../config/database');
const bcrypt = require('../utils/bcrypt-compat');
const crypto = require('crypto');

class User {
    /**
     * Create a new user
     * @param {object} userData - User data
     * @returns {object} Created user (without password)
     */
    static async create({ email, password, role = 'user', createdBy = null }) {
        const existingUser = this.findByEmail(email);
        if (existingUser) {
            throw new Error('User already exists');
        }

        if (!password || password.length < 8) {
            throw new Error('Password must be at least 8 characters');
        }
        if (!['admin', 'user'].includes(role)) {
            throw new Error('Invalid role: must be admin or user');
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const id = crypto.randomUUID();
        const normalizedEmail = email.toLowerCase();

        const stmt = db.prepare(`
            INSERT INTO users (id, email, password, role, created_by, created_at, is_active)
            VALUES (?, ?, ?, ?, ?, datetime('now'), 1)
        `);

        stmt.run(id, normalizedEmail, hashedPassword, role, createdBy);

        return this.findById(id);
    }

    /**
     * Find user by ID
     * @param {string} id - User ID
     * @returns {object|null} User object or null
     */
    static findById(id) {
        const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
        const user = stmt.get(id);
        return user ? this._sanitize(user) : null;
    }

    /**
     * Find user by email
     * @param {string} email - User email
     * @returns {object|null} User object (with password for auth) or null
     */
    static findByEmail(email) {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        return stmt.get(email?.toLowerCase());
    }

    /**
     * Authenticate user
     * @param {string} email - User email
     * @param {string} password - User password
     * @returns {object|null} User object or null if invalid
     */
    static async authenticate(email, password) {
        const user = this.findByEmail(email);
        if (!user || !user.is_active) {
            return null;
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return null;
        }

        // Update last login
        const updateStmt = db.prepare(`
            UPDATE users SET last_login = datetime('now') WHERE id = ?
        `);
        updateStmt.run(user.id);

        return this._sanitize(user);
    }

    /**
     * Update user
     * @param {string} id - User ID
     * @param {object} updates - Fields to update
     * @returns {object} Updated user
     */
    static async update(id, updates) {
        const user = this.findById(id);
        if (!user) {
            throw new Error('User not found');
        }

        // Don't allow updating certain fields
        delete updates.id;
        delete updates.email;
        delete updates.created_by;
        delete updates.created_at;

        // Hash password if being updated; an explicitly empty string is
        // rejected instead of silently locking the account
        if (updates.password === '') {
            throw new Error('Password cannot be empty');
        }
        if (updates.password) {
            if (updates.password.length < 8) {
                throw new Error('Password must be at least 8 characters');
            }
            updates.password = await bcrypt.hash(updates.password, 12);
        }

        // Field-name allowlist: the SET clause may only contain these fixed
        // SQL fragments. Request-body keys are mapped to constants (never
        // interpolated into SQL text); all values are bound via ? parameters.
        const SET_FRAGMENTS = {
            password: 'password = ?',
            role: 'role = ?',
            is_active: 'is_active = ?'
        };
        const fieldsToUpdate = Object.keys(updates).filter(k => Object.prototype.hasOwnProperty.call(SET_FRAGMENTS, k));

        // Validate role values before writing
        if (fieldsToUpdate.includes('role') && !['admin', 'user'].includes(updates.role)) {
            throw new Error('Invalid role: must be admin or user');
        }

        if (fieldsToUpdate.length === 0) {
            return user;
        }

        const setClause = fieldsToUpdate.map(f => SET_FRAGMENTS[f]).join(', ');
        const values = fieldsToUpdate.map(f => updates[f]);

        const stmt = db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`);
        stmt.run(...values, id);

        return this.findById(id);
    }

    /**
     * Delete user
     * @param {string} id - User ID
     * @returns {boolean} True if deleted
     */
    static delete(id) {
        const stmt = db.prepare('DELETE FROM users WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    }

    /**
     * Get all users
     * @returns {array} Array of users
     */
    static getAll() {
        const stmt = db.prepare('SELECT * FROM users ORDER BY created_at DESC');
        return stmt.all().map(u => this._sanitize(u));
    }

    /**
     * Remove password from user object and convert to camelCase
     * @param {object} user - User object
     * @returns {object} User without password
     */
    static _sanitize(user) {
        if (!user) return null;
        const { password, created_by, created_at, last_login, is_active, ...rest } = user;
        return {
            ...rest,
            createdBy: created_by,
            createdAt: created_at,
            lastLogin: last_login,
            isActive: is_active === 1 || is_active === true
        };
    }

    /**
     * Create default admin user if none exists
     * @param {string} adminPassword - Admin password from environment
     */
    static async ensureAdmin(adminPassword) {
        if (!adminPassword) return;

        const adminExists = this.findByEmail('admin@localhost');
        if (!adminExists) {
            try {
                const hashedPassword = await bcrypt.hash(adminPassword, 12);
                const id = crypto.randomUUID();
                const stmt = db.prepare(`
                    INSERT INTO users (id, email, password, role, created_by, created_at, is_active)
                    VALUES (?, 'admin@localhost', ?, 'admin', 'system', datetime('now'), 1)
                `);
                stmt.run(id, hashedPassword);
                console.log('[User] Default admin user created');
            } catch (err) {
                // The legacy env-password login still works; warn instead of crashing boot
                console.warn(`[User] Could not create default admin user: ${err.message}`);
            }
        }
    }
}

module.exports = User;
