/**
 * Spintax Utility Unit Tests
 */

const { parseSpintax } = require('../../src/utils/spintax');

describe('Spintax Parser', () => {
    test('should return plain text unchanged if no spintax brackets exist', () => {
        const text = 'Hello world, welcome to our store!';
        expect(parseSpintax(text)).toBe(text);
    });

    test('should pick one variation from spintax options', () => {
        const text = 'Hello {friend|partner|customer}!';
        const result = parseSpintax(text);
        expect(['Hello friend!', 'Hello partner!', 'Hello customer!']).toContain(result);
    });

    test('should replace variable placeholders like {number} or {name}', () => {
        const text = 'Hi {John|Guest}, your phone is {number}.';
        const variables = { number: '6283865213518' };
        const result = parseSpintax(text, variables);
        expect(result).toMatch(/Hi (John|Guest), your phone is 6283865213518\./);
    });

    test('should handle multiple spintax groups in a single string', () => {
        const text = '{Good morning|Hi|Hello} {Alice|Bob}, {welcome|greetings}!';
        const result = parseSpintax(text);
        expect(result).toMatch(/^(Good morning|Hi|Hello) (Alice|Bob), (welcome|greetings)!$/);
    });

    test('should handle empty or null input gracefully', () => {
        expect(parseSpintax('')).toBe('');
        expect(parseSpintax(null)).toBe('');
    });
});
