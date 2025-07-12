const bcrypt = require('./bcrypt-compat');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class UserManager {
    constructor(encryptionKey) {
        this.usersFile = path.join(__dirname, 'users.enc');
        this.encryptionKey = encryptionKey;
        this.users = new Map();
        this.loadUsers();
    }

    // Encryption/decryption methods
    encrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        const iv = crypto.randomBytes(16);
        
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    decrypt(text) {
        const algorithm = 'aes-256-cbc';
        const key = Buffer.from(this.encryptionKey.slice(0, 64), 'hex');
        
        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts[1];
        
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    async loadUsers() {
        try {
            const encryptedData = await fs.readFile(this.usersFile, 'utf8');
            const decryptedData = this.decrypt(encryptedData);
            const userData = JSON.parse(decryptedData);
            
            this.users = new Map(userData.map(user => [user.email, user]));
        } catch (error) {
            // File doesn't exist or is corrupted, start fresh
            this.users = new Map();
            
            // Create default admin user if no users exist
            if (this.users.size === 0 && process.env.ADMIN_DASHBOARD_PASSWORD) {
                await this.createUser({
                    email: 'admin@localhost',
                    password: process.env.ADMIN_DASHBOARD_PASSWORD,
                    role: 'admin',
                    createdBy: 'system'
                });
            }
        }
    }

    async saveUsers() {
        const userData = Array.from(this.users.values());
        const jsonData = JSON.stringify(userData, null, 2);
        const encryptedData = this.encrypt(jsonData);
        
        await fs.writeFile(this.usersFile, encryptedData);
    }

    async createUser({ email, password, role = 'user', createdBy }) {
        if (this.users.has(email)) {
            throw new Error('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = {
            id: crypto.randomUUID(),
            email: email.toLowerCase(),
            password: hashedPassword,
            role,
            createdBy,
            createdAt: new Date().toISOString(),
            sessions: [], // WhatsApp sessions created by this user
            lastLogin: null,
            isActive: true
        };

        this.users.set(email.toLowerCase(), user);
        await this.saveUsers();
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    async updateUser(email, updates) {
        const user = this.users.get(email.toLowerCase());
        if (!user) {
            throw new Error('User not found');
        }

        // Don't allow updating certain fields
        delete updates.id;
        delete updates.email;
        delete updates.createdBy;
        delete updates.createdAt;

        // Hash password if being updated
        if (updates.password) {
            updates.password = await bcrypt.hash(updates.password, 10);
        }

        Object.assign(user, updates);
        await this.saveUsers();
        
        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    async deleteUser(email) {
        if (!this.users.has(email.toLowerCase())) {
            throw new Error('User not found');
        }

        this.users.delete(email.toLowerCase());
        await this.saveUsers();
        return { success: true };
    }

    async authenticateUser(email, password) {
        const user = this.users.get(email.toLowerCase());
        if (!user || !user.isActive) {
            return null;
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return null;
        }

        // Update last login
        user.lastLogin = new Date().toISOString();
        await this.saveUsers();

        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    getUser(email) {
        const user = this.users.get(email.toLowerCase());
        if (!user) return null;
        
        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    getAllUsers() {
        return Array.from(this.users.values()).map(user => {
            const { password: _, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });
    }

    // Session ownership methods
    async addSessionToUser(email, sessionId) {
        const user = this.users.get(email.toLowerCase());
        if (!user) {
            throw new Error('User not found');
        }

        if (!user.sessions.includes(sessionId)) {
            user.sessions.push(sessionId);
            await this.saveUsers();
        }
    }

    async removeSessionFromUser(email, sessionId) {
        const user = this.users.get(email.toLowerCase());
        if (!user) {
            throw new Error('User not found');
        }

        user.sessions = user.sessions.filter(id => id !== sessionId);
        await this.saveUsers();
    }

    getUserSessions(email) {
        const user = this.users.get(email.toLowerCase());
        return user ? user.sessions : [];
    }

    getSessionOwner(sessionId) {
        for (const user of this.users.values()) {
            if (user.sessions.includes(sessionId)) {
                const { password: _, ...userWithoutPassword } = user;
                return userWithoutPassword;
            }
        }
        return null;
    }
}

module.exports = UserManager; 