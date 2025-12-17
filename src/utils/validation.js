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

module.exports = {
    isValidId,
    sanitizeId
};
