/**
 * User Model Unit Tests
 */

const path = require('path');
const fs = require('fs');

// Isolated test database — must be set before requiring the model
const DB_PATH = path.join(__dirname, 'test-db-users.db');
process.env.DATABASE_PATH = DB_PATH;
[DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
});

const User = require('../../src/models/User');
const { db } = require('../../src/config/database');

describe('User Model', () => {
    afterAll(() => {
        db.close();
        [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
    });

    describe('create', () => {
        test('creates user with normalized email and no password leak', async () => {
            const user = await User.create({ email: 'Test@Example.com', password: 'password123', role: 'user' });
            expect(user.email).toBe('test@example.com');
            expect(user.role).toBe('user');
            expect(user.isActive).toBe(true);
            expect(user.password).toBeUndefined();
            expect(user.id).toBeTruthy();
        });

        test('creates admin role when requested', async () => {
            const admin = await User.create({ email: 'admin2@example.com', password: 'password123', role: 'admin' });
            expect(admin.role).toBe('admin');
        });

        test('rejects duplicate email', async () => {
            await expect(
                User.create({ email: 'test@example.com', password: 'password123' })
            ).rejects.toThrow('already exists');
        });

        test('rejects short password', async () => {
            await expect(
                User.create({ email: 'short@example.com', password: 'short' })
            ).rejects.toThrow('at least 8');
        });

        test('rejects invalid role', async () => {
            await expect(
                User.create({ email: 'badrole@example.com', password: 'password123', role: 'root' })
            ).rejects.toThrow('Invalid role');
        });
    });

    describe('authenticate', () => {
        test('authenticates with correct password and updates last_login', async () => {
            const user = await User.authenticate('test@example.com', 'password123');
            expect(user).not.toBeNull();
            expect(user.email).toBe('test@example.com');
            expect(user.password).toBeUndefined();
            const raw = db.prepare('SELECT last_login FROM users WHERE email = ?').get('test@example.com');
            expect(raw.last_login).toBeTruthy();
        });

        test('rejects wrong password', async () => {
            expect(await User.authenticate('test@example.com', 'wrongpass')).toBeNull();
        });

        test('rejects unknown email', async () => {
            expect(await User.authenticate('nobody@example.com', 'password123')).toBeNull();
        });

        test('rejects deactivated users', async () => {
            const u = await User.create({ email: 'inactive@example.com', password: 'password123' });
            await User.update(u.id, { is_active: 0 });
            expect(await User.authenticate('inactive@example.com', 'password123')).toBeNull();
        });
    });

    describe('update', () => {
        test('updates role', async () => {
            const u = await User.create({ email: 'rolechange@example.com', password: 'password123' });
            const updated = await User.update(u.id, { role: 'admin' });
            expect(updated.role).toBe('admin');
        });

        test('rejects invalid role value', async () => {
            const u = await User.create({ email: 'badrole2@example.com', password: 'password123' });
            await expect(User.update(u.id, { role: 'superuser' })).rejects.toThrow('Invalid role');
        });

        test('rejects empty password', async () => {
            const u = await User.create({ email: 'emptypw@example.com', password: 'password123' });
            await expect(User.update(u.id, { password: '' })).rejects.toThrow('cannot be empty');
        });

        test('rejects short password on update', async () => {
            const u = await User.create({ email: 'shortpw@example.com', password: 'password123' });
            await expect(User.update(u.id, { password: 'tiny' })).rejects.toThrow('at least 8');
        });

        test('ignores protected fields (email, id, created_by)', async () => {
            const u = await User.create({ email: 'protected@example.com', password: 'password123' });
            const updated = await User.update(u.id, { email: 'hacked@example.com', id: 'x', created_by: 'y', role: 'admin' });
            expect(updated.email).toBe('protected@example.com');
            expect(updated.id).toBe(u.id);
            expect(updated.role).toBe('admin');
        });

        test('throws for unknown user', async () => {
            await expect(User.update('no-such-id', { role: 'admin' })).rejects.toThrow('not found');
        });

        test('ignores SQL-injection-shaped keys and binds values safely', async () => {
            const u = await User.create({ email: 'sqli@example.com', password: 'password123' });
            const other = await User.create({ email: 'other@example.com', password: 'password123', role: 'admin' });
            const userCountBefore = User.getAll().length;

            const updated = await User.update(u.id, {
                "role = 'admin' --": 'x',
                'is_active = 0; DROP TABLE users; --': 'y',
                'password = NULL': 'z',
                '1=1': 'w',
                role: 'user'
            });

            // Only the allowlisted field was applied; the injected keys were ignored
            expect(updated.role).toBe('user');
            expect(updated.email).toBe('sqli@example.com');
            // users table intact and other users untouched
            expect(User.getAll().length).toBe(userCountBefore);
            expect(User.findByEmail('other@example.com').role).toBe('admin');
        });

        test('rejects prototype-pollution-shaped keys (JSON body)', async () => {
            const u = await User.create({ email: 'proto@example.com', password: 'password123' });
            // JSON.parse creates own __proto__/constructor properties (not setters)
            const payload = JSON.parse('{"__proto__": {"is_active": 0}, "constructor": "x", "role": "admin"}');
            const updated = await User.update(u.id, payload);
            expect(updated.role).toBe('admin'); // allowlisted field applied
            expect(updated.isActive).toBe(true); // __proto__ key ignored, no pollution
        });

        test('is_active is a valid update target (allowlisted)', async () => {
            const u = await User.create({ email: 'active-flag@example.com', password: 'password123' });
            const deactivated = await User.update(u.id, { is_active: 0 });
            expect(deactivated.isActive).toBe(false);
            expect(await User.authenticate('active-flag@example.com', 'password123')).toBeNull();
        });
    });

    describe('find/getAll/delete', () => {
        test('findById returns sanitized user or null', async () => {
            const u = await User.create({ email: 'findme@example.com', password: 'password123' });
            expect(User.findById(u.id).email).toBe('findme@example.com');
            expect(User.findById(u.id).password).toBeUndefined();
            expect(User.findById('no-such-id')).toBeNull();
        });

        test('getAll never exposes passwords', async () => {
            const users = User.getAll();
            expect(users.length).toBeGreaterThan(0);
            users.forEach(u => expect(u.password).toBeUndefined());
        });

        test('delete removes user and reports result', async () => {
            const u = await User.create({ email: 'delete-me@example.com', password: 'password123' });
            expect(User.delete(u.id)).toBe(true);
            expect(User.findById(u.id)).toBeNull();
            expect(User.delete(u.id)).toBe(false);
        });
    });

    describe('ensureAdmin', () => {
        test('creates default admin@localhost when missing', async () => {
            await User.ensureAdmin('adminpass123');
            const admin = User.findByEmail('admin@localhost');
            expect(admin).not.toBeNull();
            expect(admin.role).toBe('admin');
            // findByEmail returns the raw row (snake_case columns)
            expect(admin.is_active).toBe(1);
        });

        test('is a no-op when admin already exists', async () => {
            await User.ensureAdmin('different-pass-123');
            const admin = User.findByEmail('admin@localhost');
            expect(admin).not.toBeNull();
            // original password still works (user was not recreated)
            expect(await User.authenticate('admin@localhost', 'adminpass123')).not.toBeNull();
        });

        test('is a no-op without a password argument', async () => {
            await User.ensureAdmin();
            expect(User.findByEmail('admin@localhost')).not.toBeNull();
        });
    });
});
