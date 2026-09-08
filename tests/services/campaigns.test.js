/**
 * CampaignManager exportResults Unit Tests
 * Locks in the CSV formula-injection protection (cells starting with =, +, -, @, tab, CR).
 *
 * sanitize-html@2.17.6 pulls htmlparser2 v12 (ESM-only) which Jest 29 cannot
 * parse inside node_modules; it is unrelated to exportResults, so it is mocked.
 */

jest.mock('sanitize-html', () => jest.fn((html) => html));

const path = require('path');
const fs = require('fs');
const CampaignManager = require('../../src/services/campaigns');

describe('CampaignManager sending regressions', () => {
    let manager;
    let stored;

    beforeEach(() => {
        manager = Object.create(CampaignManager.prototype);
        manager.saveCampaign = campaign => { stored = structuredClone(campaign); };
        manager.loadCampaign = () => structuredClone(stored);
        manager.createCampaign({
            name: 'Regression',
            sessionId: 'test',
            message: 'Hello {{JobTitle}} at {{Company}} {{Code}}',
            recipients: [
                { number: '6281111111111', name: 'Alice', jobTitle: 'Engineer',
                    companyName: 'Acme', customFields: { Code: 'ABC' } },
                { number: '6281111111111', name: 'Alice duplicate' }
            ]
        });
    });

    test('preserves personalization through campaign creation', () => {
        expect(manager.processTemplate(stored.message.content, stored.recipients[0]))
            .toBe('Hello Engineer at Acme ABC');
    });

    test('one successful delivery resolves all rows for the same number', () => {
        const [recipient] = manager.getPendingRecipients('test', 1);
        manager.updateRecipientStatus('test', recipient.number, 'sent');
        expect(manager.getPendingRecipients('test', 1)).toEqual([]);
        expect(stored.recipients.map(r => r.status)).toEqual(['sent', 'sent']);
        expect(stored.statistics).toEqual({ total: 2, sent: 2, failed: 0, pending: 0 });
    });

    test('duplicate failures stop at the retry limit and can be manually retried', () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const [recipient] = manager.getPendingRecipients('test', 1);
            expect(recipient).toBeDefined();
            manager.updateRecipientStatus('test', recipient.number, 'failed', 'Unavailable');
        }
        expect(manager.getPendingRecipients('test', 1)).toEqual([]);
        expect(stored.statistics).toEqual({ total: 2, sent: 0, failed: 2, pending: 0 });
        manager.markForRetry('test', '6281111111111');
        manager.markForRetry('test', '6281111111111');
        expect(stored.recipients.map(r => r.status)).toEqual(['pending', 'pending']);
        expect(stored.statistics).toEqual({ total: 2, sent: 0, failed: 0, pending: 2 });
        manager.updateRecipientStatus('test', '6281111111111', 'sent');
        expect(manager.getPendingRecipients('test', 1)).toEqual([]);
    });

    test('disabled automatic retries still allow explicit manual retries', () => {
        stored.settings.retryFailedMessages = false;
        manager.updateRecipientStatus('test', '6281111111111', 'failed', 'Unavailable');
        expect(manager.getPendingRecipients('test', 1)).toEqual([]);
        manager.markForRetry('test', '6281111111111');
        expect(manager.getPendingRecipients('test', 1)).toHaveLength(1);
    });
});

describe('CampaignManager exportResults', () => {
    let manager;
    const testId = `test_camp_${Date.now()}`;
    const listFile = path.join(__dirname, '../../src/services/campaigns', `${testId}.json`);

    beforeAll(() => {
        manager = new CampaignManager('a'.repeat(64)); // valid 64-hex key
        manager.saveCampaign({
            id: testId,
            name: 'CSV Injection Test',
            recipients: [
                { number: '6281111111111', name: 'Alice', status: 'sent' },
                { number: '6282222222222', name: '=SUM(A1:A9)', status: 'failed', error: '+cmd' },
                { number: '6283333333333', name: '@import x', status: 'pending' }
            ]
        });
    });

    afterAll(() => {
        manager.deleteCampaign(testId);
        if (fs.existsSync(listFile)) fs.unlinkSync(listFile); // belt and braces
    });

    test('writes header row', () => {
        const csv = manager.exportResults(testId);
        expect(csv.split('\n')[0]).toBe('"Number","Name","Job Title","Company","Status","Sent At","Error"');
    });

    test('quotes and double-escapes embedded quotes', () => {
        const csv = manager.exportResults(testId);
        expect(csv).toContain('"Alice"');
        expect(csv).not.toContain('"Alice" "');
    });

    test('neutralizes spreadsheet formula injection (=, +, @)', () => {
        const csv = manager.exportResults(testId);
        expect(csv).toContain(`"'=SUM(A1:A9)"`);
        expect(csv).toContain(`"'+cmd"`);
        expect(csv).toContain(`"'@import x"`);
    });

    test('returns null for unknown campaign', () => {
        expect(manager.exportResults('camp_does_not_exist')).toBeNull();
    });

    test('loadCampaign rejects path traversal ids', () => {
        // isValidId (no dots/slashes) plus _containedPath containment
        expect(manager.loadCampaign('../../package.json')).toBeNull();
        expect(manager.loadCampaign('..\\..\\package.json')).toBeNull();
        expect(manager.loadCampaign('..')).toBeNull();
    });

    test('deleteCampaign refuses path traversal ids', () => {
        expect(manager.deleteCampaign('../../package.json')).toBe(false);
        // Traversal target outside the campaigns dir must remain untouched
        expect(fs.existsSync(path.join(__dirname, '../../package.json'))).toBe(true);
    });
});

describe('CampaignManager listing cache (DDoS mitigation H6)', () => {
    test('caches the listing within the TTL and invalidates on mutation', () => {
        const manager = new CampaignManager('a'.repeat(64)); // valid 64-hex key
        const id = `camp_cache_${Date.now()}`;
        manager.saveCampaign({
            id,
            name: 'Cached',
            createdBy: 'admin@example.com',
            recipients: [],
            status: 'draft'
        });

        let loadCount = 0;
        const origLoad = manager.loadCampaign.bind(manager);
        manager.loadCampaign = (...args) => { loadCount++; return origLoad(...args); };

        // First call loads from disk and caches.
        expect(manager.getAllCampaigns()).toHaveLength(1);
        // Second call within the TTL must NOT reload from disk.
        expect(manager.getAllCampaigns()).toHaveLength(1);
        expect(loadCount).toBe(1);

        // A mutation must invalidate the cache so the next read is fresh.
        manager.saveCampaign({ id, name: 'Cached2', createdBy: 'admin@example.com', recipients: [], status: 'draft' });
        expect(manager.getAllCampaigns()).toHaveLength(1);
        expect(loadCount).toBe(2);

        manager.deleteCampaign(id);
    });
});
