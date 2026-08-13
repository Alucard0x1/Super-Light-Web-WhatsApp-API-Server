/**
 * RecipientListManager Path Safety Unit Tests
 * Locks in ID validation + path containment for list file storage.
 *
 * sanitize-html@2.17.6 pulls htmlparser2 v12 (ESM-only) which Jest 29 cannot
 * parse inside node_modules; it is unrelated to these tests, so it is mocked.
 */

jest.mock('sanitize-html', () => jest.fn((html) => html));

const fs = require('fs');
const path = require('path');
const RecipientListManager = require('../../src/services/recipient-lists');

describe('RecipientListManager path safety', () => {
    let manager;
    const createdIds = [];

    beforeAll(() => {
        manager = new RecipientListManager('a'.repeat(64)); // valid 64-hex key
    });

    afterAll(() => {
        createdIds.forEach(id => manager.deleteList(id));
    });

    test('creates and loads a list round-trip', () => {
        const list = manager.createList({
            name: 'Path Safety Test',
            recipients: ['6281111111111'],
            createdBy: 'a@b.com'
        });
        createdIds.push(list.id);
        expect(list.id).toMatch(/^list_[0-9]+_[0-9a-f]{8}$/);
        const loaded = manager.loadList(list.id);
        expect(loaded).not.toBeNull();
        expect(loaded.recipients).toEqual([{ number: '6281111111111', name: '', jobTitle: '', companyName: '', customFields: {}, addedAt: expect.any(String) }]);
    });

    test('loadList rejects path traversal ids', () => {
        expect(manager.loadList('../../package.json')).toBeNull();
        expect(manager.loadList('..\\..\\package.json')).toBeNull();
        expect(manager.loadList('..')).toBeNull();
    });

    test('deleteList refuses path traversal ids', () => {
        expect(manager.deleteList('../../package.json')).toBe(false);
        expect(fs.existsSync(path.join(__dirname, '../../package.json'))).toBe(true); // untouched
    });

    test('saveList throws for invalid ids', () => {
        expect(() => manager.saveList({ id: '../escape', name: 'x' })).toThrow('Invalid list ID');
    });

    test('loadList returns null for unknown valid id', () => {
        expect(manager.loadList('list_0000000000000_00000000')).toBeNull();
    });
});
