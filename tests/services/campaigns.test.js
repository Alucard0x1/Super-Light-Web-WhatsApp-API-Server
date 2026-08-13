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
