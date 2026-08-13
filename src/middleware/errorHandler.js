/**
 * Global Error Handler Middleware
 * Catches all errors and sends standardized responses
 */

const response = require('../utils/response');

/**
 * Error handler middleware
 * Should be registered last in the middleware chain
 */
function errorHandler(err, req, res, next) {
    // Log the error
    console.error('[Error]', {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        path: req.path,
        method: req.method
    });

    // Handle specific error types
    if (err.name === 'ValidationError') {
        return response.validationError(res, err.errors || [err.message]);
    }

    if (err.name === 'UnauthorizedError') {
        return response.unauthorized(res, err.message);
    }

    if (err.code === 'EBADCSRFTOKEN') {
        return response.forbidden(res, 'Invalid CSRF token');
    }

    // Handle multer file upload errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return response.error(res, 'File too large', 413);
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return response.error(res, 'Unexpected file field', 400);
    }

    // Default to 500 internal server error
    const message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message;

    return response.serverError(res, message, err);
}

/**
 * 404 Not Found handler
 * Should be registered after all routes
 */
function notFoundHandler(req, res) {
    return response.notFound(res, `Route ${req.method} ${req.path} not found`);
}

/**
 * Async handler wrapper
 * Catches rejected promises and passes them to error handler
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler
};
