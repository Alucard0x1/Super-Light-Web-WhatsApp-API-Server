/**
 * Shared Crypto Utility
 * Single source of truth for encryption/decryption across the application
 *
 * Security notes:
 * - New ciphertext uses AES-256-GCM (authenticated encryption) with a
 *   versioned envelope ("v2:iv:tag:ciphertext") so tampering is detected.
 * - Legacy AES-256-CBC ciphertext ("iv:ciphertext", no prefix) is still
 *   decrypted for backward compatibility with existing stored data.
 * - The encryption key is validated at every use (64 hex chars = 32 bytes).
 */

const crypto = require('crypto');

const ALGORITHM_GCM = 'aes-256-gcm';
const ALGORITHM_CBC = 'aes-256-cbc';
const V2_PREFIX = 'v2:';

/**
 * Derive a 32-byte key from the configured 64-hex-char key.
 * Throws instead of silently truncating/accepting bad keys.
 */
function getKey(encryptionKey) {
    if (!isValidKey(encryptionKey)) {
        throw new Error('Invalid encryption key: expected 64 hexadecimal characters');
    }
    return Buffer.from(encryptionKey.slice(0, 64), 'hex');
}

/**
 * Encrypt text using AES-256-GCM
 * @param {any} data - Data to encrypt (string or object)
 * @param {string} encryptionKey - 64 hex character key
 * @returns {string} - Encrypted string in format "v2:iv:tag:ciphertext"
 */
function encrypt(data, encryptionKey) {
    if (data === '' || data == null) return '';
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const key = getKey(encryptionKey);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(ALGORITHM_GCM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return V2_PREFIX + [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

/**
 * Decrypt text encrypted by encrypt() (or legacy CBC format)
 * @param {string} text - Encrypted string
 * @param {string} encryptionKey - 64 hex character key
 * @returns {string} - Decrypted text
 */
function decrypt(text, encryptionKey) {
    if (!text) return '';
    const key = getKey(encryptionKey);

    try {
        if (text.startsWith(V2_PREFIX)) {
            const parts = text.slice(V2_PREFIX.length).split(':');
            if (parts.length !== 3) {
                throw new Error('Malformed v2 ciphertext');
            }
            const iv = Buffer.from(parts[0], 'hex');
            const tag = Buffer.from(parts[1], 'hex');
            const encrypted = Buffer.from(parts[2], 'hex');

            const decipher = crypto.createDecipheriv(ALGORITHM_GCM, key, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
        }

        // Legacy AES-256-CBC format: "iv:ciphertext"
        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts.slice(1).join(':');

        const decipher = crypto.createDecipheriv(ALGORITHM_CBC, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (err) {
        throw new Error(`Failed to decrypt data: ${err.message}`);
    }
}

/**
 * Generate a random encryption key
 * @returns {string} - 64 hex character key
 */
function generateKey() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate encryption key format
 * @param {string} key - Key to validate
 * @returns {boolean} - True if valid
 */
function isValidKey(key) {
    return typeof key === 'string' && key.length >= 64 && /^[0-9a-fA-F]{64}$/.test(key.slice(0, 64));
}

module.exports = {
    encrypt,
    decrypt,
    generateKey,
    isValidKey
};
