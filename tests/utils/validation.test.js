/**
 * Validation Utility Unit Tests
 */

const {
    isValidId,
    sanitizeId,
    isValidPhoneNumber,
    sanitizePhoneNumber
} = require('../../src/utils/validation');

describe('Validation Utility', () => {
    describe('isValidId', () => {
        test('accepts alphanumeric, underscore, hyphen IDs', () => {
            expect(isValidId('session_1')).toBe(true);
            expect(isValidId('abc123')).toBe(true);
            expect(isValidId('a-b_c')).toBe(true);
            expect(isValidId('A'.repeat(128))).toBe(true);
        });

        test('rejects empty/null/non-string values', () => {
            expect(isValidId('')).toBe(false);
            expect(isValidId(null)).toBe(false);
            expect(isValidId(undefined)).toBe(false);
            expect(isValidId(123)).toBe(false);
        });

        test('rejects dots and path traversal attempts', () => {
            expect(isValidId('a.b')).toBe(false);
            expect(isValidId('..')).toBe(false);
            expect(isValidId('../etc/passwd')).toBe(false);
            expect(isValidId('a/b')).toBe(false);
            expect(isValidId('a b')).toBe(false);
        });

        test('rejects IDs longer than 128 characters', () => {
            expect(isValidId('a'.repeat(129))).toBe(false);
        });
    });

    describe('sanitizeId', () => {
        test('strips unsafe characters', () => {
            expect(sanitizeId('my..id/\\*')).toBe('myid');
            expect(sanitizeId('hello_world-1')).toBe('hello_world-1');
        });

        test('handles null/undefined input', () => {
            expect(sanitizeId(null)).toBe('');
            expect(sanitizeId(undefined)).toBe('');
        });
    });

    describe('isValidPhoneNumber', () => {
        test('accepts E.164 style numbers with and without + prefix', () => {
            expect(isValidPhoneNumber('+6281234567890')).toBe(true);
            expect(isValidPhoneNumber('6281234567890')).toBe(true);
            expect(isValidPhoneNumber('12345678')).toBe(true);
            expect(isValidPhoneNumber('123456789012345')).toBe(true); // 15 digits max
        });

        test('accepts WhatsApp JID formats', () => {
            expect(isValidPhoneNumber('6281234567890@s.whatsapp.net')).toBe(true);
            expect(isValidPhoneNumber('123456789012345@g.us')).toBe(true);
        });

        test('rejects invalid numbers', () => {
            expect(isValidPhoneNumber('')).toBe(false);
            expect(isValidPhoneNumber(null)).toBe(false);
            expect(isValidPhoneNumber(undefined)).toBe(false);
            expect(isValidPhoneNumber(12345)).toBe(false);
            expect(isValidPhoneNumber('1234567')).toBe(false); // too short
            expect(isValidPhoneNumber('1234567890123456')).toBe(false); // too long
            expect(isValidPhoneNumber('+')).toBe(false);
            expect(isValidPhoneNumber('abc12345678')).toBe(false);
            expect(isValidPhoneNumber('12345@x.whatsapp.net')).toBe(false); // bad JID domain
        });
    });

    describe('sanitizePhoneNumber', () => {
        test('removes spaces, dashes, parentheses and plus signs', () => {
            expect(sanitizePhoneNumber('+62 812-3456-7890')).toBe('+6281234567890');
            expect(sanitizePhoneNumber('(0812) 3456-7890')).toBe('081234567890');
        });

        test('keeps only one leading plus', () => {
            expect(sanitizePhoneNumber('++6281')).toBe('+6281');
            expect(sanitizePhoneNumber('6+2+8')).toBe('628');
        });

        test('handles empty input', () => {
            expect(sanitizePhoneNumber('')).toBe('');
            expect(sanitizePhoneNumber(null)).toBe('');
            expect(sanitizePhoneNumber(undefined)).toBe('');
        });
    });
});
