/**
 * Response Utility Tests
 */

const response = require('../../src/utils/response');

describe('Response Utility', () => {
    let mockRes;

    beforeEach(() => {
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
    });

    describe('success', () => {
        test('should send 200 status by default', () => {
            response.success(mockRes, { message: 'test' });

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'success',
                data: { message: 'test' }
            });
        });

        test('should allow custom status code', () => {
            response.success(mockRes, { id: 1 }, 201);

            expect(mockRes.status).toHaveBeenCalledWith(201);
        });

        test('should handle null data', () => {
            response.success(mockRes, null);

            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'success'
            });
        });
    });

    describe('error', () => {
        test('should send error with message', () => {
            response.error(mockRes, 'Something went wrong', 400);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'error',
                message: 'Something went wrong'
            });
        });

        test('should include details if provided', () => {
            response.error(mockRes, 'Validation failed', 422, { field: 'email' });

            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'error',
                message: 'Validation failed',
                details: { field: 'email' }
            });
        });
    });

    describe('unauthorized', () => {
        test('should send 401 status', () => {
            response.unauthorized(mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(401);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'error',
                message: 'Unauthorized'
            });
        });
    });

    describe('forbidden', () => {
        test('should send 403 status', () => {
            response.forbidden(mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'error',
                message: 'Forbidden'
            });
        });
    });

    describe('notFound', () => {
        test('should send 404 status', () => {
            response.notFound(mockRes, 'User not found');

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'error',
                message: 'User not found'
            });
        });
    });

    describe('validationError', () => {
        test('should send 422 status with errors', () => {
            const errors = ['Email is required', 'Password too short'];
            response.validationError(mockRes, errors);

            expect(mockRes.status).toHaveBeenCalledWith(422);
            expect(mockRes.json).toHaveBeenCalledWith({
                status: 'error',
                message: 'Validation failed',
                details: { errors }
            });
        });
    });
});
