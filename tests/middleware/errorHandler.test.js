/**
 * Error Handler Middleware Unit Tests
 */

jest.mock('../../src/utils/response', () => ({
    validationError: jest.fn(),
    unauthorized: jest.fn(),
    forbidden: jest.fn(),
    error: jest.fn(),
    serverError: jest.fn(),
    notFound: jest.fn()
}));

const { errorHandler, notFoundHandler, asyncHandler } = require('../../src/middleware/errorHandler');
const response = require('../../src/utils/response');

describe('Error Handler Middleware', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = { path: '/test', method: 'GET' };
        mockRes = {};
        mockNext = jest.fn();
    });

    describe('errorHandler', () => {
        test('handles ValidationError with error list', () => {
            const err = new Error('bad input');
            err.name = 'ValidationError';
            err.errors = ['field required'];
            errorHandler(err, mockReq, mockRes, mockNext);
            expect(response.validationError).toHaveBeenCalledWith(mockRes, ['field required']);
        });

        test('handles ValidationError without error list', () => {
            const err = new Error('bad input');
            err.name = 'ValidationError';
            errorHandler(err, mockReq, mockRes, mockNext);
            expect(response.validationError).toHaveBeenCalledWith(mockRes, ['bad input']);
        });

        test('handles UnauthorizedError', () => {
            const err = new Error('token expired');
            err.name = 'UnauthorizedError';
            errorHandler(err, mockReq, mockRes, mockNext);
            expect(response.unauthorized).toHaveBeenCalledWith(mockRes, 'token expired');
        });

        test('handles CSRF token errors', () => {
            const err = new Error('csrf');
            err.code = 'EBADCSRFTOKEN';
            errorHandler(err, mockReq, mockRes, mockNext);
            expect(response.forbidden).toHaveBeenCalledWith(mockRes, 'Invalid CSRF token');
        });

        test('handles multer file size errors', () => {
            const err = new Error('too big');
            err.code = 'LIMIT_FILE_SIZE';
            errorHandler(err, mockReq, mockRes, mockNext);
            expect(response.error).toHaveBeenCalledWith(mockRes, 'File too large', 413);
        });

        test('handles multer unexpected file errors', () => {
            const err = new Error('unexpected');
            err.code = 'LIMIT_UNEXPECTED_FILE';
            errorHandler(err, mockReq, mockRes, mockNext);
            expect(response.error).toHaveBeenCalledWith(mockRes, 'Unexpected file field', 400);
        });

        test('falls back to serverError with real message outside production', () => {
            const err = new Error('boom');
            errorHandler(err, mockReq, mockRes, mockNext);
            expect(response.serverError).toHaveBeenCalledWith(mockRes, 'boom', err);
        });

        test('masks error message in production', () => {
            const original = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            try {
                const err = new Error('secret details');
                errorHandler(err, mockReq, mockRes, mockNext);
                expect(response.serverError).toHaveBeenCalledWith(mockRes, 'Internal server error', err);
            } finally {
                process.env.NODE_ENV = original;
            }
        });
    });

    describe('notFoundHandler', () => {
        test('responds 404 with route info', () => {
            notFoundHandler({ method: 'GET', path: '/nope' }, mockRes);
            expect(response.notFound).toHaveBeenCalledWith(mockRes, 'Route GET /nope not found');
        });
    });

    describe('asyncHandler', () => {
        test('passes through a resolved handler', async () => {
            const fn = jest.fn().mockResolvedValue('ok');
            const wrapped = asyncHandler(fn);
            await wrapped(mockReq, mockRes, mockNext);
            expect(fn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('forwards rejections to next', async () => {
            const err = new Error('async boom');
            const fn = jest.fn().mockRejectedValue(err);
            const wrapped = asyncHandler(fn);
            await wrapped(mockReq, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalledWith(err);
        });
    });
});
