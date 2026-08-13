/**
 * Webhook Service Unit Tests
 * Covers SSRF guards (isPrivateAddress, URL validation) and dispatch retry logic.
 */

jest.mock('axios');
jest.mock('dns', () => ({
    promises: {
        lookup: jest.fn()
    }
}));

const path = require('path');
const fs = require('fs');

// Isolated test database (webhook_configs is DB-backed)
const DB_PATH = path.join(__dirname, 'test-db-webhook.db');
process.env.DATABASE_PATH = DB_PATH;
delete process.env.WEBHOOK_URL;
[DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
});

const axios = require('axios');
const dns = require('dns');
const webhook = require('../../src/services/webhook');
const { db } = require('../../src/config/database');

describe('Webhook Service', () => {
    afterEach(() => {
        // Full reset so no mock implementation leaks across tests
        jest.resetAllMocks();
    });

    afterAll(() => {
        db.close();
        [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach(f => {
            if (fs.existsSync(f)) fs.unlinkSync(f);
        });
    });

    describe('isPrivateAddress', () => {
        test('detects private/reserved IPv4 ranges', () => {
            expect(webhook.isPrivateAddress('10.0.0.1')).toBe(true);
            expect(webhook.isPrivateAddress('172.16.0.1')).toBe(true);
            expect(webhook.isPrivateAddress('172.31.255.255')).toBe(true);
            expect(webhook.isPrivateAddress('192.168.1.1')).toBe(true);
            expect(webhook.isPrivateAddress('127.0.0.1')).toBe(true);
            expect(webhook.isPrivateAddress('169.254.1.1')).toBe(true);
            expect(webhook.isPrivateAddress('100.64.0.1')).toBe(true);
            expect(webhook.isPrivateAddress('0.0.0.0')).toBe(true);
            expect(webhook.isPrivateAddress('224.0.0.1')).toBe(true); // multicast
        });

        test('accepts public IPv4 addresses', () => {
            expect(webhook.isPrivateAddress('8.8.8.8')).toBe(false);
            expect(webhook.isPrivateAddress('1.1.1.1')).toBe(false);
            expect(webhook.isPrivateAddress('172.32.0.1')).toBe(false);
            expect(webhook.isPrivateAddress('192.169.1.1')).toBe(false);
        });

        test('detects private/reserved IPv6 addresses', () => {
            expect(webhook.isPrivateAddress('::1')).toBe(true);
            expect(webhook.isPrivateAddress('::')).toBe(true);
            expect(webhook.isPrivateAddress('fc00::1')).toBe(true);
            expect(webhook.isPrivateAddress('fd12:3456::1')).toBe(true);
            expect(webhook.isPrivateAddress('fe80::1')).toBe(true);
            expect(webhook.isPrivateAddress('ff02::1')).toBe(true); // multicast
            expect(webhook.isPrivateAddress('2001:db8::1')).toBe(true); // documentation
            expect(webhook.isPrivateAddress('::ffff:127.0.0.1')).toBe(true); // v4-mapped loopback
            expect(webhook.isPrivateAddress('::ffff:192.168.1.1')).toBe(true);
        });

        test('accepts public IPv6 addresses', () => {
            expect(webhook.isPrivateAddress('2606:4700:4700::1111')).toBe(false);
            expect(webhook.isPrivateAddress('2001:4860:4860::8888')).toBe(false);
        });

        test('treats non-IP input as private (fail closed)', () => {
            expect(webhook.isPrivateAddress('not-an-ip')).toBe(true);
            expect(webhook.isPrivateAddress('')).toBe(true);
        });
    });

    describe('validateWebhookUrl', () => {
        test('accepts a public HTTPS URL', async () => {
            dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
            await expect(webhook.validateWebhookUrl('https://example.com/hook'))
                .resolves.toBe('https://example.com/hook');
        });

        test('rejects non-HTTPS protocols', async () => {
            await expect(webhook.validateWebhookUrl('http://example.com/hook'))
                .rejects.toThrow('credential-free HTTPS');
            await expect(webhook.validateWebhookUrl('ftp://example.com/hook'))
                .rejects.toThrow('credential-free HTTPS');
        });

        test('rejects URLs with embedded credentials', async () => {
            await expect(webhook.validateWebhookUrl('https://user:pass@example.com/hook'))
                .rejects.toThrow('credential-free');
        });

        test('rejects malformed URLs', async () => {
            await expect(webhook.validateWebhookUrl('not a url')).rejects.toThrow('valid HTTPS URL');
        });

        test('rejects literal private IP targets without DNS lookup', async () => {
            await expect(webhook.validateWebhookUrl('https://127.0.0.1/hook')).rejects.toThrow('private or reserved');
            await expect(webhook.validateWebhookUrl('https://10.0.0.5/hook')).rejects.toThrow('private or reserved');
            expect(dns.promises.lookup).not.toHaveBeenCalled();
        });

        test('rejects bracketed IPv6 literals that resolve to loopback', async () => {
            // URL.hostname keeps the brackets ('[::1]'), so net.isIP() misses the
            // literal check; the DNS-resolved check must still catch it.
            dns.promises.lookup.mockResolvedValue([{ address: '::1' }]);
            await expect(webhook.validateWebhookUrl('https://[::1]/hook'))
                .rejects.toThrow('must not resolve');
        });

        test('rejects local hostnames without DNS lookup', async () => {
            await expect(webhook.validateWebhookUrl('https://localhost/hook')).rejects.toThrow('local address');
            await expect(webhook.validateWebhookUrl('https://api.internal/hook')).rejects.toThrow('local address');
            await expect(webhook.validateWebhookUrl('https://server.local/hook')).rejects.toThrow('local address');
            expect(dns.promises.lookup).not.toHaveBeenCalled();
        });

        test('rejects hostnames that resolve to private IPs', async () => {
            dns.promises.lookup.mockResolvedValue([{ address: '192.168.1.10' }]);
            await expect(webhook.validateWebhookUrl('https://example.com/hook'))
                .rejects.toThrow('must not resolve');
        });

        test('tolerates DNS lookup failures (request will fail naturally)', async () => {
            dns.promises.lookup.mockRejectedValue(new Error('ENOTFOUND'));
            await expect(webhook.validateWebhookUrl('https://example.com/hook'))
                .resolves.toBe('https://example.com/hook');
        });
    });

    describe('validateExternalUrl', () => {
        test('accepts public HTTP and HTTPS URLs', async () => {
            dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
            await expect(webhook.validateExternalUrl('https://example.com/img.png')).resolves.toBeTruthy();
            await expect(webhook.validateExternalUrl('http://example.com/img.png')).resolves.toBeTruthy();
        });

        test('rejects non-http(s) protocols and credentials', async () => {
            await expect(webhook.validateExternalUrl('ftp://example.com/file')).rejects.toThrow('http(s) URL');
            await expect(webhook.validateExternalUrl('https://user:pass@example.com/file')).rejects.toThrow('credential-free');
        });
    });

    describe('dispatchWebhook', () => {
        test('returns false for empty URL', async () => {
            await expect(webhook.dispatchWebhook('', 'event', 's1', {})).resolves.toBe(false);
            expect(axios.post).not.toHaveBeenCalled();
        });

        test('returns false for SSRF-blocked URL', async () => {
            await expect(webhook.dispatchWebhook('https://127.0.0.1/hook', 'event', 's1', {})).resolves.toBe(false);
            expect(axios.post).not.toHaveBeenCalled();
        });

        test('posts the event payload and returns true', async () => {
            dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
            axios.post.mockResolvedValue({ status: 200 });
            const ok = await webhook.dispatchWebhook('https://example.com/hook', 'message.received', 's1', { text: 'hi' });
            expect(ok).toBe(true);
            expect(axios.post).toHaveBeenCalledTimes(1);
            const [url, payload, opts] = axios.post.mock.calls[0];
            expect(url).toBe('https://example.com/hook');
            expect(payload.event).toBe('message.received');
            expect(payload.sessionId).toBe('s1');
            expect(payload.data).toEqual({ text: 'hi' });
            expect(opts.maxRedirects).toBe(0);
            expect(opts.timeout).toBe(10000);
        });

        test('retries transient failures and gives up after 3 attempts', async () => {
            jest.useFakeTimers();
            try {
                dns.promises.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
                axios.post.mockRejectedValue(new Error('network down'));
                const promise = webhook.dispatchWebhook('https://example.com/hook', 'e', 's1', {});
                await jest.advanceTimersByTimeAsync(1000); // backoff after attempt 1
                await jest.advanceTimersByTimeAsync(2000); // backoff after attempt 2
                await expect(promise).resolves.toBe(false);
                expect(axios.post).toHaveBeenCalledTimes(3);
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('webhook config (DB-backed)', () => {
        test('set/get/remove webhook URL per session', () => {
            db.prepare("INSERT OR IGNORE INTO whatsapp_sessions (id, token) VALUES ('ws_webhook_test', 'tok')").run();
            webhook.setWebhookUrl('ws_webhook_test', 'https://example.com/hook');
            expect(webhook.getWebhookUrl('ws_webhook_test')).toBe('https://example.com/hook');
            webhook.removeWebhookUrl('ws_webhook_test');
            expect(webhook.getWebhookUrl('ws_webhook_test')).toBe('');
        });

        test('setWebhookUrl upserts (update does not duplicate)', () => {
            webhook.setWebhookUrl('ws_webhook_test', 'https://example.com/hook');
            webhook.setWebhookUrl('ws_webhook_test', 'https://example.com/hook2');
            expect(webhook.getWebhookUrl('ws_webhook_test')).toBe('https://example.com/hook2');
            const rows = webhook.getAllWebhookUrls().filter(r => r.session_id === 'ws_webhook_test');
            expect(rows).toHaveLength(1);
            webhook.removeWebhookUrl('ws_webhook_test');
        });

        test('getWebhookUrl returns empty string for unknown session', () => {
            expect(webhook.getWebhookUrl('ws_does_not_exist')).toBe('');
        });
    });
});
