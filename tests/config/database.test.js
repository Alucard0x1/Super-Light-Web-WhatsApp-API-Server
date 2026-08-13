/**
 * Database Tests
 */

const path = require('path');
const fs = require('fs');

// Use a test database
process.env.DATABASE_PATH = path.join(__dirname, '../test-database.db');

describe('Database', () => {
    let db;

    beforeAll(() => {
        // Clean up any existing test database
        if (fs.existsSync(process.env.DATABASE_PATH)) {
            fs.unlinkSync(process.env.DATABASE_PATH);
        }

        // Import after setting env
        const database = require('../../src/config/database');
        db = database.db;
    });

    afterAll(() => {
        db.close();
        // Clean up test database
        if (fs.existsSync(process.env.DATABASE_PATH)) {
            fs.unlinkSync(process.env.DATABASE_PATH);
        }
    });

    test('should have users table', () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
        expect(tables).toHaveLength(1);
    });

    test('should have whatsapp_sessions table', () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_sessions'").all();
        expect(tables).toHaveLength(1);
    });

    test('should have campaigns table', () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campaigns'").all();
        expect(tables).toHaveLength(1);
    });

    test('should have campaign_recipients table', () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_recipients'").all();
        expect(tables).toHaveLength(1);
    });

    test('should have activity_logs table', () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_logs'").all();
        expect(tables).toHaveLength(1);
    });

    test('should be using WAL journal mode', () => {
        const result = db.pragma('journal_mode');
        expect(result[0].journal_mode).toBe('wal');
    });
});
