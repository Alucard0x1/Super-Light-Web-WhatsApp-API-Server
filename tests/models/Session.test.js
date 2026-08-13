/**
 * Session Model Unit Tests
 */

const path = require('path');
const fs = require('fs');

// Isolated test database — must be set before requiring the model
const DB_PATH = path.join(__dirname, 'test-db-sessions.db');
process.env.DATABASE_PATH = DB_PATH;
[DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
});

const Session = require('../../src/models/Session');
const { db } = require('../../src/config/database');

describe('Session Model', () => {
    afterAll(() => {
        db.close();
        [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
    });

    describe('create/find', () => {
        test('creates session with token and CREATING status', () => {
            const session = Session.create('sess_test_1');
            expect(session.id).toBe('sess_test_1');
            expect(session.status).toBe('CREATING');
            expect(session.token).toBeTruthy();
        });

        test('rejects duplicate session id', () => {
            expect(() => Session.create('sess_test_1')).toThrow('already exists');
        });

        test('findById returns session or undefined', () => {
            expect(Session.findById('sess_test_1')).not.toBeUndefined();
            expect(Session.findById('no-such-session')).toBeUndefined();
        });

        test('findByToken resolves session', () => {
            const s = Session.findById('sess_test_1');
            expect(Session.findByToken(s.token).id).toBe('sess_test_1');
            expect(Session.findByToken('no-such-token')).toBeUndefined();
        });
    });

    describe('status/token operations', () => {
        test('updateStatus persists status and detail', () => {
            const s = Session.updateStatus('sess_test_1', 'CONNECTED', 'Ready');
            expect(s.status).toBe('CONNECTED');
            expect(s.detail).toBe('Ready');
        });

        test('getToken returns token or null', () => {
            expect(Session.getToken('sess_test_1')).toBeTruthy();
            expect(Session.getToken('no-such-session')).toBeNull();
        });

        test('validateToken checks session/token pair', () => {
            const token = Session.getToken('sess_test_1');
            expect(Session.validateToken('sess_test_1', token)).toBe(true);
            expect(Session.validateToken('sess_test_1', 'wrong-token')).toBe(false);
            // findById returns undefined for unknown sessions -> validateToken yields undefined
            expect(Session.validateToken('no-such-session', token)).toBeFalsy();
        });

        test('countActive excludes DISCONNECTED and DELETED sessions', () => {
            Session.create('sess_test_2');
            Session.updateStatus('sess_test_1', 'DISCONNECTED');
            expect(Session.countActive()).toBe(1); // only sess_test_2
            Session.updateStatus('sess_test_2', 'DELETED');
            expect(Session.countActive()).toBe(0);
        });
    });

    describe('owner filtering', () => {
        beforeAll(() => {
            db.prepare(
                "INSERT OR IGNORE INTO users (id, email, password, role) VALUES ('u_owner', 'owner@example.com', 'x', 'user')"
            ).run();
        });

        test('create attaches owner when the user exists', () => {
            const s = Session.create('sess_owner_1', 'owner@example.com');
            expect(s.owner_email).toBe('owner@example.com');
        });

        test('create stores null owner when the user does not exist', () => {
            const s = Session.create('sess_orphan_1', 'ghost@example.com');
            expect(s.owner_email).toBeNull();
        });

        test('getAll filters by owner when not admin', () => {
            const owned = Session.getAll('owner@example.com');
            expect(owned.length).toBeGreaterThan(0);
            owned.forEach(s => expect(s.owner_email).toBe('owner@example.com'));
        });

        test('getAll returns everything for admin or public listing', () => {
            const all = Session.getAll(null, true);
            expect(all.length).toBeGreaterThanOrEqual(Session.getAll('owner@example.com').length);
            expect(Session.getAll(null, true).length).toBe(all.length);
        });

        test('getSessionIdsByOwner is case-insensitive', () => {
            const ids = Session.getSessionIdsByOwner('OWNER@EXAMPLE.COM');
            expect(ids).toContain('sess_owner_1');
        });
    });

    describe('delete', () => {
        test('delete removes session and reports result', () => {
            expect(Session.delete('sess_test_2')).toBe(true);
            expect(Session.findById('sess_test_2')).toBeUndefined();
            expect(Session.delete('sess_test_2')).toBe(false);
        });
    });
});
