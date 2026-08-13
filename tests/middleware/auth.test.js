/**
 * Authentication Middleware Unit Tests
 */

jest.mock('../../src/models/User', () => ({
    findByEmail: jest.fn()
}));

jest.mock('../../src/utils/response', () => ({
    unauthorized: jest.fn(),
    forbidden: jest.fn()
}));

const { requireAuth, requireAdmin, getCurrentUser, attachUser } = require('../../src/middleware/auth');
const response = require('../../src/utils/response');
const User = require('../../src/models/User');

describe('Auth Middleware', () => {
    let mockRes, mockNext;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRes = { clearCookie: jest.fn() };
        mockNext = jest.fn();
    });

    describe('requireAuth', () => {
        test('rejects missing session', () => {
            requireAuth({}, mockRes, mockNext);
            expect(response.unauthorized).toHaveBeenCalledWith(mockRes, 'Login required');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('rejects unauthenticated session', () => {
            requireAuth({ session: {} }, mockRes, mockNext);
            expect(response.unauthorized).toHaveBeenCalledWith(mockRes, 'Login required');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('allows legacy-admin session without user row', () => {
            const req = { session: { adminAuthed: true, userId: 'legacy-admin' } };
            requireAuth(req, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
            expect(User.findByEmail).not.toHaveBeenCalled();
        });

        test('allows active user', () => {
            User.findByEmail.mockReturnValue({ is_active: 1, role: 'admin' });
            const req = {
                session: { adminAuthed: true, userId: 'u1', userEmail: 'a@b.com', userRole: 'admin' }
            };
            requireAuth(req, mockRes, mockNext);
            expect(User.findByEmail).toHaveBeenCalledWith('a@b.com');
            expect(mockNext).toHaveBeenCalled();
        });

        test('destroys session for inactive user', () => {
            User.findByEmail.mockReturnValue({ is_active: 0 });
            const req = {
                session: {
                    adminAuthed: true,
                    userId: 'u1',
                    userEmail: 'a@b.com',
                    destroy: jest.fn((cb) => cb())
                }
            };
            requireAuth(req, mockRes, mockNext);
            expect(req.session.destroy).toHaveBeenCalled();
            expect(mockRes.clearCookie).toHaveBeenCalledWith('connect.sid');
            expect(response.unauthorized).toHaveBeenCalledWith(mockRes, 'Login required');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('destroys session when user row is missing', () => {
            User.findByEmail.mockReturnValue(null);
            const req = {
                session: {
                    adminAuthed: true,
                    userId: 'u1',
                    userEmail: 'a@b.com',
                    destroy: jest.fn((cb) => cb())
                }
            };
            requireAuth(req, mockRes, mockNext);
            expect(req.session.destroy).toHaveBeenCalled();
            expect(response.unauthorized).toHaveBeenCalled();
        });

        test('syncs role changes without re-login', () => {
            User.findByEmail.mockReturnValue({ is_active: 1, role: 'user' });
            const req = {
                session: {
                    adminAuthed: true,
                    userId: 'u1',
                    userEmail: 'a@b.com',
                    userRole: 'admin',
                    save: jest.fn((cb) => cb && cb())
                }
            };
            requireAuth(req, mockRes, mockNext);
            expect(req.session.userRole).toBe('user');
            expect(req.session.save).toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe('requireAdmin', () => {
        test('rejects unauthenticated session', () => {
            requireAdmin({ session: {} }, mockRes, mockNext);
            expect(response.unauthorized).toHaveBeenCalledWith(mockRes, 'Login required');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('rejects non-admin role', () => {
            requireAdmin({ session: { adminAuthed: true, userRole: 'user' } }, mockRes, mockNext);
            expect(response.forbidden).toHaveBeenCalledWith(mockRes, 'Admin access required');
            expect(mockNext).not.toHaveBeenCalled();
        });

        test('allows admin role', () => {
            requireAdmin({ session: { adminAuthed: true, userRole: 'admin' } }, mockRes, mockNext);
            expect(mockNext).toHaveBeenCalled();
        });
    });

    describe('getCurrentUser / attachUser', () => {
        test('getCurrentUser returns null when not authed', () => {
            expect(getCurrentUser({ session: {} })).toBeNull();
            expect(getCurrentUser({})).toBeNull();
        });

        test('getCurrentUser returns user info when authed', () => {
            const info = getCurrentUser({
                session: { adminAuthed: true, userEmail: 'a@b.com', userRole: 'admin', userId: 'u1' }
            });
            expect(info).toEqual({ email: 'a@b.com', role: 'admin', id: 'u1' });
        });

        test('attachUser sets req.user and continues', () => {
            const req = { session: { adminAuthed: true, userEmail: 'a@b.com', userRole: 'user', userId: 'u2' } };
            attachUser(req, mockRes, mockNext);
            expect(req.user).toEqual({ email: 'a@b.com', role: 'user', id: 'u2' });
            expect(mockNext).toHaveBeenCalled();
        });
    });
});
