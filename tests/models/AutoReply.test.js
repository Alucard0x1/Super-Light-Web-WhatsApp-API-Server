/**
 * AutoReply Model Unit Tests
 */

const AutoReply = require('../../src/models/AutoReply');
const { db } = require('../../src/config/database');

describe('AutoReply Model', () => {
    let createdRuleId;

    afterAll(() => {
        if (createdRuleId) {
            AutoReply.delete(createdRuleId);
        }
    });

    test('should create auto-reply rule successfully', () => {
        const rule = AutoReply.create({
            sessionId: 'test',
            keyword: 'PROMO_TEST',
            matchType: 'contains',
            responseType: 'text',
            responsePayload: 'Get 50% discount today!'
        });

        expect(rule).toBeDefined();
        expect(rule.keyword).toBe('PROMO_TEST');
        expect(rule.match_type).toBe('contains');
        expect(rule.session_id).toBe('test');
        createdRuleId = rule.id;
    });

    test('should match exact keyword', () => {
        const exactRule = AutoReply.create({
            sessionId: null,
            keyword: 'HELP_TEST',
            matchType: 'exact',
            responsePayload: 'Support menu'
        });

        const match = AutoReply.findMatchingReply('test', 'help_test');
        expect(match).toBeDefined();
        expect(match.keyword).toBe('HELP_TEST');

        AutoReply.delete(exactRule.id);
    });

    test('should match contains keyword', () => {
        const match = AutoReply.findMatchingReply('test', 'Do you have any PROMO_TEST codes?');
        expect(match).toBeDefined();
        expect(match.keyword).toBe('PROMO_TEST');
    });

    test('should match startsWith keyword', () => {
        const startRule = AutoReply.create({
            sessionId: null,
            keyword: 'INFO_TEST',
            matchType: 'startsWith',
            responsePayload: 'Info details'
        });

        const match = AutoReply.findMatchingReply('test', 'info_test about prices');
        expect(match).toBeDefined();
        expect(match.keyword).toBe('INFO_TEST');

        AutoReply.delete(startRule.id);
    });

    test('should return null when no active rule matches', () => {
        const match = AutoReply.findMatchingReply('test', 'unmatched random query 123999');
        expect(match).toBeNull();
    });
});
