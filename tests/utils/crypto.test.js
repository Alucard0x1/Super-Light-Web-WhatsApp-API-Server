/**
 * Crypto Utility Tests
 */

const { encrypt, decrypt, generateKey, isValidKey } = require('../../src/utils/crypto');

describe('Crypto Utility', () => {
    const testKey = 'a'.repeat(64); // 64 hex chars = 32 bytes

    describe('encrypt/decrypt', () => {
        test('should encrypt and decrypt text correctly', () => {
            const originalText = 'Hello, World!';
            const encrypted = encrypt(originalText, testKey);
            const decrypted = decrypt(encrypted, testKey);

            expect(decrypted).toBe(originalText);
        });

        test('encrypted text should be different from original', () => {
            const originalText = 'Hello, World!';
            const encrypted = encrypt(originalText, testKey);

            expect(encrypted).not.toBe(originalText);
        });

        test('should handle empty string', () => {
            const originalText = '';
            const encrypted = encrypt(originalText, testKey);
            const decrypted = decrypt(encrypted, testKey);

            expect(decrypted).toBe(originalText);
        });

        test('should handle special characters', () => {
            const originalText = '!@#$%^&*()_+-=[]{}|;\':",./<>?`~';
            const encrypted = encrypt(originalText, testKey);
            const decrypted = decrypt(encrypted, testKey);

            expect(decrypted).toBe(originalText);
        });

        test('should handle unicode characters', () => {
            const originalText = '你好世界 🎉 مرحبا';
            const encrypted = encrypt(originalText, testKey);
            const decrypted = decrypt(encrypted, testKey);

            expect(decrypted).toBe(originalText);
        });

        test('should produce different ciphertext for same input (IV randomization)', () => {
            const originalText = 'Hello, World!';
            const encrypted1 = encrypt(originalText, testKey);
            const encrypted2 = encrypt(originalText, testKey);

            expect(encrypted1).not.toBe(encrypted2);
        });

        test('should decrypt legacy AES-256-CBC payloads (pre-GCM format)', () => {
            // Produce a legacy "iv:ciphertext" payload using the old algorithm
            const crypto = require('crypto');
            const key = Buffer.from(testKey.slice(0, 64), 'hex');
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
            let encrypted = cipher.update('legacy-data', 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const legacy = iv.toString('hex') + ':' + encrypted;

            expect(legacy.startsWith('v2:')).toBe(false);
            expect(decrypt(legacy, testKey)).toBe('legacy-data');
        });

        test('should reject tampered v2 ciphertext', () => {
            const originalText = 'integrity-check';
            const encrypted = encrypt(originalText, testKey);
            // Flip a character in the ciphertext portion
            const flipped = encrypted.slice(0, -4) + (encrypted.endsWith('0000') ? '0001' : '0000');
            expect(() => decrypt(flipped, testKey)).toThrow();
        });
    });

    describe('generateKey', () => {
        test('should generate a 64 character hex key', () => {
            const key = generateKey();

            expect(key).toHaveLength(64);
            expect(/^[0-9a-f]+$/.test(key)).toBe(true);
        });

        test('should generate unique keys', () => {
            const key1 = generateKey();
            const key2 = generateKey();

            expect(key1).not.toBe(key2);
        });
    });

    describe('isValidKey', () => {
        test('should return true for valid 64 char hex key', () => {
            expect(isValidKey('a'.repeat(64))).toBe(true);
            expect(isValidKey('1234567890abcdef'.repeat(4))).toBe(true);
        });

        test('should return false for too short key', () => {
            expect(isValidKey('abc123')).toBe(false);
            expect(isValidKey('')).toBe(false);
        });

        test('should return false for null/undefined', () => {
            expect(isValidKey(null)).toBe(false);
            expect(isValidKey(undefined)).toBe(false);
        });

        test('should return false for non-hex characters', () => {
            expect(isValidKey('g'.repeat(64))).toBe(false);
            expect(isValidKey('!'.repeat(64))).toBe(false);
        });
    });
});
