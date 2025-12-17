/**
 * Shared Crypto Utility
 * Single source of truth for encryption/decryption across the application
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

/**
 * Encrypt text using AES-256-CBC
 * @param {string} text - Text to encrypt
 * @param {string} encryptionKey - 64 hex character key
 * @returns {string} - Encrypted string in format "iv:encrypted"
 */
function encrypt(text, encryptionKey) {
    const key = Buffer.from(encryptionKey.slice(0, 64), 'hex');
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt text using AES-256-CBC
 * @param {string} text - Encrypted string in format "iv:encrypted"
 * @param {string} encryptionKey - 64 hex character key
 * @returns {string} - Decrypted text
 */
function decrypt(text, encryptionKey) {
    const key = Buffer.from(encryptionKey.slice(0, 64), 'hex');

    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
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
    return key && key.length >= 64 && /^[0-9a-fA-F]+$/.test(key.slice(0, 64));
}

module.exports = {
    encrypt,
    decrypt,
    generateKey,
    isValidKey
};
