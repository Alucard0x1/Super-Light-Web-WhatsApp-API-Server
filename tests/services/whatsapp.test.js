/**
 * WhatsApp Service — Race Condition Regression Tests
 *
 * Locks in two concurrency fixes:
 *  R1) connect() must not create two sockets for the same session when invoked
 *      concurrently (the per-session connect mutex dedupes in-flight connects).
 *  R2) connect() must not retain a "zombie" socket when the session row was
 *      deleted while it was connecting (the auth-state/version awaits allow a
 *      concurrent deleteSessionData to erase the DB record mid-connect).
 *
 * The heavy @whiskeysockets/baileys dependency is mocked; only the module
 * contract (makeWASocket / useMultiFileAuthState) matters here.
 */

jest.mock('@whiskeysockets/baileys', () => {
    const makeSocket = jest.fn(() => {
        const ev = { on: jest.fn() };
        return {
            ev,
            end: jest.fn(),
            user: { id: '6280000000000@s.whatsapp.net', name: 'Tester' }
        };
    });
    return {
        __esModule: true,
        default: makeSocket,
        useMultiFileAuthState: jest.fn().mockResolvedValue({ state: { creds: {}, keys: {} }, saveCreds: jest.fn() }),
        fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0] }),
        fetchLatestWaWebVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0] }),
        makeCacheableSignalKeyStore: jest.fn(x => x),
        isJidBroadcast: jest.fn(() => false),
        downloadMediaMessage: jest.fn(() => Promise.resolve(Buffer.alloc(0))),
        Browsers: { ubuntu: jest.fn(() => 'browser') },
        DisconnectReason: { loggedOut: 401, connectionReplaced: 440 }
    };
});

const path = require('path');
const fs = require('fs');
const Session = require('../../src/models/Session');
const whatsapp = require('../../src/services/whatsapp');

const AUTH_DIR = path.join(process.cwd(), 'auth_info_baileys');
const TEST_IDS = ['mutex_test', 'zombie_test'];

describe('whatsapp connect() concurrency safety', () => {
    beforeAll(() => {
        // Clean any leftover session rows so findById returns undefined,
        // which is exactly the state the R2 zombie guard defends against.
        for (const id of TEST_IDS) Session.delete(id);
    });

    afterAll(() => {
        for (const id of TEST_IDS) {
            const dir = path.join(AUTH_DIR, id);
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        }
        for (const id of TEST_IDS) Session.delete(id);
    });

    test('R1: concurrent connect() for the same session creates only one socket', async () => {
        const makeSocket = require('@whiskeysockets/baileys').default;
        makeSocket.mockClear();

        const doNothing = () => {};
        const p1 = whatsapp.connect('mutex_test', doNothing, doNothing);
        const p2 = whatsapp.connect('mutex_test', doNothing, doNothing);

        // A concurrent connect must resolve to the SAME in-flight promise
        // (the mutex), not start a second socket.
        expect(p1).toBe(p2);

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(r2);
        expect(makeSocket).toHaveBeenCalledTimes(1);
    });

    test('R2: connect() discards the socket if the session row was deleted while connecting', async () => {
        // No DB row exists for this id -> findById returns undefined.
        const sock = await whatsapp.connect('zombie_test', () => {}, () => {});
        expect(sock).toBeDefined();
        // The mock socket must have been ended (zombie guard) and not registered.
        expect(sock.end).toHaveBeenCalled();
        expect(whatsapp.getSocket('zombie_test')).toBeNull();
    });
});
