/**
 * Recipient Model Unit Tests
 */

const path = require('path');
const fs = require('fs');

// Isolated test database — must be set before requiring the model
const DB_PATH = path.join(__dirname, 'test-db-recipients.db');
process.env.DATABASE_PATH = DB_PATH;
[DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
});

const Recipient = require('../../src/models/Recipient');
const { db } = require('../../src/config/database');

describe('Recipient Model', () => {
    const campaignId = 'camp_test_1';

    beforeAll(() => {
        // Recipients FK to campaigns — seed the parent row
        db.prepare("INSERT OR IGNORE INTO campaigns (id, name, status) VALUES (?, 'Test Campaign', 'draft')")
            .run(campaignId);
    });

    afterAll(() => {
        db.close();
        [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
    });

    describe('addBulk / getByCampaign', () => {
        test('addBulk inserts recipients and returns count', () => {
            const added = Recipient.addBulk(campaignId, [
                { number: '6281111111111', name: 'Alice', customFields: { city: 'Jakarta' } },
                { number: '6282222222222', name: 'Bob' }
            ]);
            expect(added).toBe(2);
        });

        test('getByCampaign returns recipients with parsed custom fields', () => {
            const rows = Recipient.getByCampaign(campaignId);
            expect(rows).toHaveLength(2);
            const alice = rows.find(r => r.number === '6281111111111');
            expect(alice.name).toBe('Alice');
            expect(alice.customFields).toEqual({ city: 'Jakarta' });
            expect(alice.status).toBe('pending');
        });

        test('addBulk with duplicate number replaces existing row', () => {
            Recipient.addBulk(campaignId, [{ number: '6281111111111', name: 'Alice Updated' }]);
            const rows = Recipient.getByCampaign(campaignId);
            expect(rows).toHaveLength(2);
            expect(rows.find(r => r.number === '6281111111111').name).toBe('Alice Updated');
        });
    });

    describe('getPending', () => {
        test('returns pending recipients limited by default 100', () => {
            const pending = Recipient.getPending(campaignId);
            expect(pending).toHaveLength(2);
            expect(pending.every(r => ['pending', 'retry'].includes(r.status))).toBe(true);
        });

        test('respects limit option', () => {
            expect(Recipient.getPending(campaignId, 1)).toHaveLength(1);
        });
    });

    describe('status transitions', () => {
        test('updateStatus marks sent and records sent_at', () => {
            Recipient.updateStatus(campaignId, '6281111111111', 'sent');
            const r = Recipient.getByCampaign(campaignId).find(x => x.number === '6281111111111');
            expect(r.status).toBe('sent');
            expect(r.sent_at).toBeTruthy();
        });

        test('updateStatus records failure error message', () => {
            Recipient.updateStatus(campaignId, '6282222222222', 'failed', 'Invalid number');
            const r = Recipient.getByCampaign(campaignId).find(x => x.number === '6282222222222');
            expect(r.status).toBe('failed');
            expect(r.error).toBe('Invalid number');
        });

        test('markForRetry sets status to retry and increments retry_count', () => {
            Recipient.markForRetry(campaignId, '6282222222222');
            const r = Recipient.getByCampaign(campaignId).find(x => x.number === '6282222222222');
            expect(r.status).toBe('retry');
            expect(r.retry_count).toBe(1);
        });

        test('getPending includes retry recipients', () => {
            const pending = Recipient.getPending(campaignId);
            expect(pending.some(r => r.status === 'retry')).toBe(true);
        });

        test('resetFailed moves failed recipients back to retry', () => {
            Recipient.addBulk(campaignId, [{ number: '6283333333333' }]);
            Recipient.updateStatus(campaignId, '6283333333333', 'failed');
            expect(Recipient.resetFailed(campaignId)).toBe(1);
            const r = Recipient.getByCampaign(campaignId).find(x => x.number === '6283333333333');
            expect(r.status).toBe('retry');
            expect(r.retry_count).toBe(1);
        });
    });

    describe('countByStatus', () => {
        test('aggregates counts with zero defaults', () => {
            const counts = Recipient.countByStatus(campaignId);
            expect(counts.sent).toBe(1);
            expect(counts.retry).toBe(2); // 222 + 333
            expect(counts.pending).toBe(0);
            expect(counts.failed).toBe(0);
        });

        test('countByStatus for unknown campaign returns zero defaults', () => {
            const counts = Recipient.countByStatus('camp_does_not_exist');
            expect(counts).toEqual({ pending: 0, sent: 0, failed: 0, retry: 0 });
        });
    });

    describe('deleteByCampaign', () => {
        test('removes all recipients of a campaign', () => {
            const deleted = Recipient.deleteByCampaign(campaignId);
            expect(deleted).toBeGreaterThan(0);
            expect(Recipient.getByCampaign(campaignId)).toHaveLength(0);
        });
    });
});
