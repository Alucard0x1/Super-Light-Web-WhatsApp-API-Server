/**
 * Standardized API Response Utility
 * Ensures consistent response format across all endpoints
 */

/**
 * Send a success response
 * @param {object} res - Express response object
 * @param {object} data - Response data
 * @param {number} statusCode - HTTP status code (default 200)
 */
function success(res, data = null, statusCode = 200) {
    const response = {
        status: 'success',
        ...(data && { data })
    };
    return res.status(statusCode).json(response);
}

/**
 * Send an error response
 * @param {object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default 400)
 * @param {object} details - Additional error details
 */
function error(res, message, statusCode = 400, details = null) {
    const response = {
        status: 'error',
        message,
        ...(details && { details })
    };
    return res.status(statusCode).json(response);
}

/**
 * Send a validation error response
 * @param {object} res - Express response object
 * @param {array} errors - Array of validation errors
 */
function validationError(res, errors) {
    return error(res, 'Validation failed', 422, { errors });
}

/**
 * Send an unauthorized response
 * @param {object} res - Express response object
 * @param {string} message - Error message
 */
function unauthorized(res, message = 'Unauthorized') {
    return error(res, message, 401);
}

/**
 * Send a forbidden response
 * @param {object} res - Express response object
 * @param {string} message - Error message
 */
function forbidden(res, message = 'Forbidden') {
    return error(res, message, 403);
}

/**
 * Send a not found response
 * @param {object} res - Express response object
 * @param {string} message - Error message
 */
function notFound(res, message = 'Not found') {
    return error(res, message, 404);
}

/**
 * Send a server error response
 * @param {object} res - Express response object
 * @param {string} message - Error message
 * @param {Error} err - Original error (logged but not exposed)
 */
function serverError(res, message = 'Internal server error', err = null) {
    if (err) {
        console.error('[Server Error]', err);
    }
    return error(res, message, 500);
}

module.exports = {
    success,
    error,
    validationError,
    unauthorized,
    forbidden,
    notFound,
    serverError
};
