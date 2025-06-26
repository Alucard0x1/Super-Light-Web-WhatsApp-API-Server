const config = require('../config');
const Logger = require('../utils/logger');

class Database {
    constructor() {
        this.type = process.env.DB_TYPE || 'file'; // file, redis, postgresql
        this.connection = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            switch (this.type) {
                case 'redis':
                    await this.connectRedis();
                    break;
                case 'postgresql':
                    await this.connectPostgreSQL();
                    break;
                case 'file':
                default:
                    await this.connectFileSystem();
                    break;
            }
            this.isConnected = true;
            Logger.info(`Database connected: ${this.type}`);
        } catch (error) {
            Logger.error('Database connection failed', error);
            throw error;
        }
    }

    async connectRedis() {
        if (process.env.REDIS_URL) {
            const redis = require('redis');
            this.connection = redis.createClient({
                url: process.env.REDIS_URL,
                retry_strategy: (options) => {
                    if (options.error && options.error.code === 'ECONNREFUSED') {
                        return new Error('Redis server connection refused');
                    }
                    if (options.total_retry_time > 1000 * 60 * 60) {
                        return new Error('Redis retry time exhausted');
                    }
                    return Math.min(options.attempt * 100, 3000);
                }
            });

            await this.connection.connect();
            
            this.connection.on('error', (err) => {
                Logger.error('Redis connection error', err);
            });
        }
    }

    async connectPostgreSQL() {
        if (process.env.DATABASE_URL) {
            const { Pool } = require('pg');
            this.connection = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Test the connection
            const client = await this.connection.connect();
            await client.query('SELECT NOW()');
            client.release();

            // Create tables if they don't exist
            await this.initializePostgreSQLTables();
        }
    }

    async connectFileSystem() {
        // File system doesn't need connection, but we can validate directories
        const fs = require('fs');
        const path = require('path');
        
        const dbDir = path.join(config.storage.logsDir, 'database');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        this.connection = { type: 'file', path: dbDir };
    }

    async initializePostgreSQLTables() {
        const createTablesQuery = `
            CREATE TABLE IF NOT EXISTS sessions (
                id VARCHAR(255) PRIMARY KEY,
                status VARCHAR(50) NOT NULL,
                detail TEXT,
                token VARCHAR(255) UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
                message_id VARCHAR(255),
                from_jid VARCHAR(255),
                to_jid VARCHAR(255),
                message_type VARCHAR(50),
                content JSONB,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                direction VARCHAR(10) CHECK (direction IN ('in', 'out'))
            );

            CREATE TABLE IF NOT EXISTS webhook_logs (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255),
                url VARCHAR(500),
                payload JSONB,
                response_status INTEGER,
                success BOOLEAN,
                error_message TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
            CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
            CREATE INDEX IF NOT EXISTS idx_webhook_logs_session_id ON webhook_logs(session_id);
        `;

        await this.connection.query(createTablesQuery);
        Logger.info('PostgreSQL tables initialized');
    }

    // Session management
    async saveSession(sessionData) {
        try {
            switch (this.type) {
                case 'redis':
                    await this.connection.hSet(`session:${sessionData.sessionId}`, sessionData);
                    break;
                case 'postgresql':
                    await this.connection.query(
                        `INSERT INTO sessions (id, status, detail, token, updated_at, last_activity) 
                         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                         ON CONFLICT (id) DO UPDATE SET 
                         status = EXCLUDED.status, 
                         detail = EXCLUDED.detail, 
                         updated_at = CURRENT_TIMESTAMP,
                         last_activity = CURRENT_TIMESTAMP`,
                        [sessionData.sessionId, sessionData.status, sessionData.detail, sessionData.token]
                    );
                    break;
                case 'file':
                default:
                    const fs = require('fs');
                    const path = require('path');
                    const sessionFile = path.join(this.connection.path, `session_${sessionData.sessionId}.json`);
                    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
                    break;
            }
        } catch (error) {
            Logger.error('Failed to save session', error, sessionData.sessionId);
            throw error;
        }
    }

    async getSession(sessionId) {
        try {
            switch (this.type) {
                case 'redis':
                    return await this.connection.hGetAll(`session:${sessionId}`);
                case 'postgresql':
                    const result = await this.connection.query(
                        'SELECT * FROM sessions WHERE id = $1',
                        [sessionId]
                    );
                    return result.rows[0] || null;
                case 'file':
                default:
                    const fs = require('fs');
                    const path = require('path');
                    const sessionFile = path.join(this.connection.path, `session_${sessionId}.json`);
                    if (fs.existsSync(sessionFile)) {
                        return JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
                    }
                    return null;
            }
        } catch (error) {
            Logger.error('Failed to get session', error, sessionId);
            return null;
        }
    }

    async getAllSessions() {
        try {
            switch (this.type) {
                case 'redis':
                    const keys = await this.connection.keys('session:*');
                    const sessions = [];
                    for (const key of keys) {
                        const sessionData = await this.connection.hGetAll(key);
                        sessions.push(sessionData);
                    }
                    return sessions;
                case 'postgresql':
                    const result = await this.connection.query('SELECT * FROM sessions ORDER BY updated_at DESC');
                    return result.rows;
                case 'file':
                default:
                    const fs = require('fs');
                    const path = require('path');
                    const sessions = [];
                    const files = fs.readdirSync(this.connection.path);
                    for (const file of files) {
                        if (file.startsWith('session_') && file.endsWith('.json')) {
                            const sessionData = JSON.parse(fs.readFileSync(path.join(this.connection.path, file), 'utf-8'));
                            sessions.push(sessionData);
                        }
                    }
                    return sessions;
            }
        } catch (error) {
            Logger.error('Failed to get all sessions', error);
            return [];
        }
    }

    async deleteSession(sessionId) {
        try {
            switch (this.type) {
                case 'redis':
                    await this.connection.del(`session:${sessionId}`);
                    break;
                case 'postgresql':
                    await this.connection.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
                    break;
                case 'file':
                default:
                    const fs = require('fs');
                    const path = require('path');
                    const sessionFile = path.join(this.connection.path, `session_${sessionId}.json`);
                    if (fs.existsSync(sessionFile)) {
                        fs.unlinkSync(sessionFile);
                    }
                    break;
            }
        } catch (error) {
            Logger.error('Failed to delete session', error, sessionId);
            throw error;
        }
    }

    // Message logging
    async logMessage(messageData) {
        try {
            switch (this.type) {
                case 'postgresql':
                    await this.connection.query(
                        `INSERT INTO messages (session_id, message_id, from_jid, to_jid, message_type, content, direction) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [
                            messageData.sessionId,
                            messageData.messageId,
                            messageData.from,
                            messageData.to,
                            messageData.type,
                            JSON.stringify(messageData.content),
                            messageData.direction
                        ]
                    );
                    break;
                case 'file':
                    const fs = require('fs');
                    const path = require('path');
                    const logFile = path.join(this.connection.path, 'messages.jsonl');
                    const logEntry = JSON.stringify({ ...messageData, timestamp: new Date().toISOString() }) + '\n';
                    fs.appendFileSync(logFile, logEntry);
                    break;
            }
        } catch (error) {
            Logger.error('Failed to log message', error, messageData.sessionId);
        }
    }

    // Webhook logging
    async logWebhook(webhookData) {
        try {
            switch (this.type) {
                case 'postgresql':
                    await this.connection.query(
                        `INSERT INTO webhook_logs (session_id, url, payload, response_status, success, error_message) 
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            webhookData.sessionId,
                            webhookData.url,
                            JSON.stringify(webhookData.payload),
                            webhookData.responseStatus,
                            webhookData.success,
                            webhookData.errorMessage
                        ]
                    );
                    break;
                case 'file':
                    const fs = require('fs');
                    const path = require('path');
                    const logFile = path.join(this.connection.path, 'webhooks.jsonl');
                    const logEntry = JSON.stringify({ ...webhookData, timestamp: new Date().toISOString() }) + '\n';
                    fs.appendFileSync(logFile, logEntry);
                    break;
            }
        } catch (error) {
            Logger.error('Failed to log webhook', error, webhookData.sessionId);
        }
    }

    // Performance metrics
    async recordMetric(metricName, value, sessionId = null) {
        try {
            const metric = {
                name: metricName,
                value: value,
                sessionId: sessionId,
                timestamp: new Date().toISOString()
            };

            switch (this.type) {
                case 'redis':
                    await this.connection.lPush(`metrics:${metricName}`, JSON.stringify(metric));
                    await this.connection.lTrim(`metrics:${metricName}`, 0, 999); // Keep last 1000 metrics
                    break;
                case 'file':
                    const fs = require('fs');
                    const path = require('path');
                    const metricsFile = path.join(this.connection.path, 'metrics.jsonl');
                    const logEntry = JSON.stringify(metric) + '\n';
                    fs.appendFileSync(metricsFile, logEntry);
                    break;
            }
        } catch (error) {
            Logger.error('Failed to record metric', error);
        }
    }

    async getMetrics(metricName, limit = 100) {
        try {
            switch (this.type) {
                case 'redis':
                    const metrics = await this.connection.lRange(`metrics:${metricName}`, 0, limit - 1);
                    return metrics.map(m => JSON.parse(m));
                case 'file':
                    // For file system, we'll return a simple implementation
                    return [];
                default:
                    return [];
            }
        } catch (error) {
            Logger.error('Failed to get metrics', error);
            return [];
        }
    }

    async close() {
        try {
            if (this.connection && this.type === 'redis') {
                await this.connection.quit();
            } else if (this.connection && this.type === 'postgresql') {
                await this.connection.end();
            }
            this.isConnected = false;
            Logger.info('Database connection closed');
        } catch (error) {
            Logger.error('Error closing database connection', error);
        }
    }

    // Health check
    async healthCheck() {
        try {
            switch (this.type) {
                case 'redis':
                    await this.connection.ping();
                    return { status: 'healthy', type: 'redis' };
                case 'postgresql':
                    await this.connection.query('SELECT 1');
                    return { status: 'healthy', type: 'postgresql' };
                case 'file':
                default:
                    return { status: 'healthy', type: 'file' };
            }
        } catch (error) {
            Logger.error('Database health check failed', error);
            return { status: 'unhealthy', type: this.type, error: error.message };
        }
    }
}

// Singleton instance
let dbInstance = null;

const getDatabase = () => {
    if (!dbInstance) {
        dbInstance = new Database();
    }
    return dbInstance;
};

module.exports = { Database, getDatabase }; 