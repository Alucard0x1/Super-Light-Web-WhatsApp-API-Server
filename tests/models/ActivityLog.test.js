/**
 * ActivityLog Model Unit Tests
 */

const path = require('path');
const fs = require('fs');

// Isolated test database — must be set before requiring the model
const DB_PATH = path.join(__dirname, 'test-db-activity.db');
process.env.DATABASE_PATH = DB_PATH;
[DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
});

const ActivityLog = require('../../src/models/ActivityLog');
const { db } = require('../../src/config/database');

describe('ActivityLog Model', () => {
    afterAll(() => {
        db.close();
        [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
    });

    describe('log', () => {
        test('creates a log entry and returns its id', () => {
            const { id } = ActivityLog.log({
                userEmail: 'admin@example.com',
                action: 'LOGIN',
                resource: 'auth',
                ip: '127.0.0.1',
                userAgent: 'jest'
            });
            expect(id).toBeTruthy();
        });

        test('persists JSON details and success flag', () => {
            ActivityLog.log({
                userEmail: 'admin@example.com',
                action: 'MESSAGE_SEND',
                resource: 'message',
                resourceId: 'sess_1',
                details: { recipient: '6281', messageType: 'text' },
                success: false
            });
            const rows = ActivityLog.getAll({ action: 'MESSAGE_SEND' });
            expect(rows).toHaveLength(1);
            expect(rows[0].details).toEqual({ recipient: '6281', messageType: 'text' });
            expect(rows[0].success).toBe(0);
            expect(rows[0].userEmail).toBe('admin@example.com');
            expect(rows[0].resourceId).toBe('sess_1');
        });
    });

    describe('getAll', () => {
        test('returns all entries ordered by recency', () => {
            const rows = ActivityLog.getAll({ limit: 50 });
            expect(rows.length).toBeGreaterThanOrEqual(2);
            const timestamps = rows.map(r => r.created_at);
            expect([...timestamps].sort().reverse()).toEqual(timestamps);
        });

        test('filters by userEmail', () => {
            ActivityLog.log({ userEmail: 'other@example.com', action: 'SESSION_CREATE', resource: 'session' });
            const rows = ActivityLog.getAll({ userEmail: 'other@example.com' });
            expect(rows).toHaveLength(1);
            expect(rows[0].action).toBe('SESSION_CREATE');
        });

        test('filters by action and resource', () => {
            expect(ActivityLog.getAll({ action: 'SESSION_CREATE' })).toHaveLength(1);
            expect(ActivityLog.getAll({ resource: 'session' }).length).toBeGreaterThanOrEqual(1);
            expect(ActivityLog.getAll({ action: 'NO_SUCH_ACTION' })).toHaveLength(0);
        });

        test('respects limit', () => {
            const rows = ActivityLog.getAll({ limit: 1 });
            expect(rows).toHaveLength(1);
        });

        test('filters by date range', () => {
            const rows = ActivityLog.getAll({ startDate: '2099-01-01 00:00:00' });
            expect(rows).toHaveLength(0);
        });
    });

    describe('helper methods', () => {
        test('logLogin records login attempts', () => {
            ActivityLog.logLogin('a@b.com', '1.2.3.4', 'agent', false);
            const logins = ActivityLog.getAll({ action: 'LOGIN' });
            expect(logins).toHaveLength(2); // first describe block + this one
            // same-second timestamps make row order nondeterministic — check membership
            expect(logins.some(l => l.success === 0)).toBe(true);
        });

        test('logSessionCreate / logSessionDelete', () => {
            ActivityLog.logSessionCreate('a@b.com', 'sess_x', '1.2.3.4', 'agent');
            ActivityLog.logSessionDelete('a@b.com', 'sess_x', '1.2.3.4', 'agent');
            expect(ActivityLog.getAll({ action: 'SESSION_CREATE' })).toHaveLength(2);
            expect(ActivityLog.getAll({ action: 'SESSION_DELETE' })).toHaveLength(1);
        });

        test('logMessageSend stores recipient details', () => {
            ActivityLog.logMessageSend('a@b.com', 'sess_x', '6281', 'image', '1.2.3.4', 'agent');
            const rows = ActivityLog.getAll({ action: 'MESSAGE_SEND' });
            expect(rows).toHaveLength(2);
            expect(rows.some(r => r.details.recipient === '6281' && r.details.messageType === 'image')).toBe(true);
        });

        test('logCampaign helpers prefix action with CAMPAIGN_', () => {
            ActivityLog.logCampaignCreate('a@b.com', 'camp_1', 'Blast', 50);
            ActivityLog.logCampaignStart('a@b.com', 'camp_1', 'Blast', 50);
            expect(ActivityLog.getAll({ action: 'CAMPAIGN_CREATE' })).toHaveLength(1);
            expect(ActivityLog.getAll({ action: 'CAMPAIGN_START' })).toHaveLength(1);
        });
    });

    describe('getSummary', () => {
        test('aggregates totals, byAction and byUser', () => {
            const summary = ActivityLog.getSummary(null, 7);
            expect(summary.totalActivities).toBeGreaterThanOrEqual(4);
            expect(summary.byAction.login).toBe(2);
            expect(summary.byUser['other@example.com']).toBe(1);
        });

        test('filters summary by user', () => {
            const summary = ActivityLog.getSummary('other@example.com', 7);
            expect(summary.totalActivities).toBe(1);
            expect(summary.byUser).toEqual({ 'other@example.com': 1 });
        });

        test('normalizes message send actions to send_message card', () => {
            const summary = ActivityLog.getSummary(null, 7);
            expect(summary.byAction.send_message).toBe(2);
        });
    });

    describe('cleanOld / clearAll', () => {
        test('cleanOld removes only entries older than the cutoff', () => {
            db.prepare(
                "INSERT INTO activity_logs (user_email, action, created_at) VALUES ('old@example.com', 'OLD', datetime('now', '-40 days'))"
            ).run();
            expect(ActivityLog.cleanOld(30)).toBe(1);
            expect(ActivityLog.getAll({ action: 'OLD' })).toHaveLength(0);
        });

        test('clearAll wipes the table', () => {
            const removed = ActivityLog.clearAll();
            expect(removed).toBeGreaterThan(0);
            expect(ActivityLog.getAll({ limit: 100 })).toHaveLength(0);
        });
    });
});
