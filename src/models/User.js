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

        const hashedPassword = await bcrypt.hash(password, 10);
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

        // Hash password if being updated
        if (updates.password) {
            updates.password = await bcrypt.hash(updates.password, 10);
        }

        const allowedFields = ['password', 'role', 'is_active'];
        const fieldsToUpdate = Object.keys(updates).filter(k => allowedFields.includes(k));

        if (fieldsToUpdate.length === 0) {
            return user;
        }

        const setClause = fieldsToUpdate.map(f => `${f} = ?`).join(', ');
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
     * Remove password from user object
     * @param {object} user - User object
     * @returns {object} User without password
     */
    static _sanitize(user) {
        if (!user) return null;
        const { password, ...sanitized } = user;
        return sanitized;
    }

    /**
     * Create default admin user if none exists
     * @param {string} adminPassword - Admin password from environment
     */
    static async ensureAdmin(adminPassword) {
        if (!adminPassword) return;

        const adminExists = this.findByEmail('admin@localhost');
        if (!adminExists) {
            await this.create({
                email: 'admin@localhost',
                password: adminPassword,
                role: 'admin',
                createdBy: 'system'
            });
            console.log('[User] Default admin user created');
        }
    }
}

module.exports = User;
