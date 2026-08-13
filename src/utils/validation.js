/**
 * Validation utilities
 */

/**
 * Validates an ID to prevent path traversal and ensure safe characters.
 * Allows alphanumeric characters, underscores, and hyphens.
 * @param {string} id - The ID to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const isValidId = (id) => {
    if (!id || typeof id !== 'string') return false;
    // Allow only alphanumeric, underscores, and hyphens.
    // Strictly prevent dot (.) to avoid path traversal abuse even if .. is blocked.
    // Also length check (1-128 characters) for sanity.
    return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
};

/**
 * Sanitizes a filename/ID by removing unsafe characters.
 * @param {string} text - The input text
 * @returns {string} - Sanitized text
 */
const sanitizeId = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/[^a-zA-Z0-9_-]/g, '');
};

/**
 * Validates a phone number in E.164 format.
 * E.164: +[country code][subscriber number], max 15 digits.
 * Also allows numbers without the + prefix for backward compatibility.
 * @param {string} number - The phone number to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const isValidPhoneNumber = (number) => {
    if (!number || typeof number !== 'string') return false;

    // Allow WhatsApp JID format (e.g., 1234567890@s.whatsapp.net)
    if (number.endsWith('@s.whatsapp.net') || number.endsWith('@g.us')) {
        const phonePart = number.split('@')[0];
        return /^\d{8,15}$/.test(phonePart);
    }

    // Strip + prefix if present for validation
    const cleaned = number.startsWith('+') ? number.slice(1) : number;

    // E.164: 1-15 digits after country code, only numbers allowed
    return /^\d{8,15}$/.test(cleaned);
};

/**
 * Sanitizes a phone number by removing non-numeric characters (except +).
 * @param {string} number - The phone number to sanitize
 * @returns {string} - Sanitized phone number
 */
const sanitizePhoneNumber = (number) => {
    if (!number || typeof number !== 'string') return '';
    // Keep only digits and leading +
    const cleaned = number.replace(/[^\d+]/g, '');
    // Allow only one leading +
    if (cleaned.startsWith('+')) {
        return '+' + cleaned.slice(1).replace(/\+/g, '');
    }
    return cleaned.replace(/\+/g, '');
};

module.exports = {
    isValidId,
    sanitizeId,
    isValidPhoneNumber,
    sanitizePhoneNumber
};
