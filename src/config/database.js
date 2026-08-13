/**
 * Database Configuration and Initialization
 * SQLite database with better-sqlite3 for synchronous operations
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database file path
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '../../data/whatsapp.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Create database instance
const db = new Database(DB_PATH, {
    verbose: process.env.NODE_ENV === 'development' ? console.log : null
});

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Enforce foreign key constraints (better-sqlite3 disables them by default)
db.pragma('foreign_keys = ON');

// Restrict database file permissions (contains session tokens, bcrypt hashes, PII)
if (process.platform !== 'win32') {
    try {
        fs.chmodSync(DB_PATH, 0o600);
        const walFile = `${DB_PATH}-wal`;
        const shmFile = `${DB_PATH}-shm`;
        if (fs.existsSync(walFile)) fs.chmodSync(walFile, 0o600);
        if (fs.existsSync(shmFile)) fs.chmodSync(shmFile, 0o600);
    } catch (err) {
        console.warn('[Database] Could not restrict DB file permissions:', err.message);
    }
}

/**
 * Initialize database schema
 */
function initializeSchema() {
    // Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
            created_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            is_active INTEGER DEFAULT 1
        )
    `);

    // WhatsApp sessions table (metadata only, auth stored in auth_info_baileys)
    db.exec(`
        CREATE TABLE IF NOT EXISTS whatsapp_sessions (
            id TEXT PRIMARY KEY,
            owner_email TEXT REFERENCES users(email) ON DELETE SET NULL,
            token TEXT NOT NULL,
            status TEXT DEFAULT 'DISCONNECTED',
            detail TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Per-session webhook configuration. The URL is intentionally stored
    // separately from session credentials so it can be managed and revoked
    // without exposing authentication state.
    db.exec(`
        CREATE TABLE IF NOT EXISTS webhook_configs (
            session_id TEXT PRIMARY KEY REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Campaigns table
    db.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'ready', 'sending', 'paused', 'completed', 'cancelled')),
            session_id TEXT REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
            message_content TEXT,
            message_type TEXT DEFAULT 'text',
            media_url TEXT,
            message_delay_min INTEGER DEFAULT 3,
            message_delay_max INTEGER DEFAULT 8,
            created_by TEXT REFERENCES users(email) ON DELETE SET NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            scheduled_at DATETIME,
            started_at DATETIME,
            completed_at DATETIME
        )
    `);

    // Campaign recipients table
    db.exec(`
        CREATE TABLE IF NOT EXISTS campaign_recipients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
            number TEXT NOT NULL,
            name TEXT,
            custom_fields TEXT,
            status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'retry')),
            sent_at DATETIME,
            error TEXT,
            retry_count INTEGER DEFAULT 0,
            UNIQUE(campaign_id, number)
        )
    `);

    // Create index for faster recipient lookups
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recipients_campaign_status 
        ON campaign_recipients(campaign_id, status)
    `);

    // Activity logs table
    db.exec(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT,
            action TEXT NOT NULL,
            resource TEXT,
            resource_id TEXT,
            details TEXT,
            ip TEXT,
            user_agent TEXT,
            success INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create index for activity log queries
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_activity_user_date 
        ON activity_logs(user_email, created_at)
    `);

    // Recipient lists table
    db.exec(`
        CREATE TABLE IF NOT EXISTS recipient_lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            recipients TEXT NOT NULL,
            created_by TEXT REFERENCES users(email) ON DELETE SET NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Auto replies table
    db.exec(`
        CREATE TABLE IF NOT EXISTS auto_replies (
            id TEXT PRIMARY KEY,
            session_id TEXT REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
            keyword TEXT NOT NULL,
            match_type TEXT DEFAULT 'exact' CHECK(match_type IN ('exact', 'contains', 'startsWith', 'regex')),
            response_type TEXT DEFAULT 'text' CHECK(response_type IN ('text', 'image', 'document')),
            response_payload TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            created_by TEXT REFERENCES users(email) ON DELETE SET NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Chat messages table (for Live Inbox & message logs)
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
            remote_jid TEXT NOT NULL,
            sender_name TEXT,
            from_me INTEGER DEFAULT 0,
            message_type TEXT DEFAULT 'text',
            body TEXT,
            media_url TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_read INTEGER DEFAULT 0
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_jid 
        ON chat_messages(session_id, remote_jid, timestamp)
    `);

    // AI Settings table (for AI Chatbot Integration)
    db.exec(`
        CREATE TABLE IF NOT EXISTS ai_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_enabled INTEGER DEFAULT 0,
            provider TEXT DEFAULT 'openai',
            api_key TEXT,
            api_base_url TEXT DEFAULT 'https://api.openai.com/v1',
            model TEXT DEFAULT 'gpt-4o-mini',
            system_prompt TEXT DEFAULT 'You are a helpful customer support AI assistant for WhatsApp. Be concise, polite, and professional.',
            temperature REAL DEFAULT 0.7,
            max_tokens INTEGER DEFAULT 500,
            auto_reply_unmatched INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        INSERT OR IGNORE INTO ai_settings (id, is_enabled) VALUES (1, 0)
    `);

    console.log('[Database] Schema initialized successfully');
}

/**
 * Close database connection
 */
function close() {
    db.close();
}

// Initialize schema on load
initializeSchema();

// Handle graceful shutdown (managed by index.js)
process.on('exit', () => {
    try {
        db.close();
    } catch (err) {
        // Database may already be closed
    }
});

module.exports = {
    db,
    initializeSchema,
    close,
    DB_PATH
};
