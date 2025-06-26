const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');

class AuthMiddleware {
    static async hashPassword(password) {
        return await bcrypt.hash(password, 12);
    }

    static async comparePassword(password, hashedPassword) {
        return await bcrypt.compare(password, hashedPassword);
    }

    static generateToken(payload, expiresIn = config.security.sessionTimeout) {
        return jwt.sign(payload, config.security.jwtSecret, { expiresIn });
    }

    static verifyToken(token) {
        try {
            return jwt.verify(token, config.security.jwtSecret);
        } catch (error) {
            return null;
        }
    }

    static adminAuth(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                status: 'error', 
                message: 'Access token required' 
            });
        }

        const decoded = AuthMiddleware.verifyToken(token);
        if (!decoded || decoded.type !== 'admin') {
            return res.status(403).json({ 
                status: 'error', 
                message: 'Invalid or expired admin token' 
            });
        }

        req.admin = decoded;
        next();
    }

    static async loginAdmin(username, password) {
        try {
            // In a real application, this would check against a database
            // For now, we're using environment variables
            if (username !== config.security.adminUser) {
                return { success: false, message: 'Invalid credentials' };
            }

            // For simplicity, we're comparing plain text passwords
            // In production, you should hash the admin password
            if (password !== config.security.adminPass) {
                return { success: false, message: 'Invalid credentials' };
            }

            const token = AuthMiddleware.generateToken({
                username,
                type: 'admin',
                loginTime: new Date().toISOString()
            });

            return {
                success: true,
                token,
                message: 'Login successful'
            };
        } catch (error) {
            return { 
                success: false, 
                message: 'Authentication error' 
            };
        }
    }

    // Check if admin token exists in localStorage (for frontend)
    static checkAdminAccess() {
        return `
            const token = localStorage.getItem('adminToken');
            if (!token) {
                window.location.href = '/admin/';
                return;
            }
            
            // Verify token with server
            fetch('/admin/verify', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                }
            }).then(response => {
                if (!response.ok) {
                    localStorage.removeItem('adminToken');
                    window.location.href = '/admin/';
                }
            }).catch(() => {
                localStorage.removeItem('adminToken');
                window.location.href = '/admin/';
            });
        `;
    }
}

module.exports = AuthMiddleware; 