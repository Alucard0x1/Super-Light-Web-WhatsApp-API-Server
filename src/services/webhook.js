/**
 * Webhook Service
 * - Persistent per-session webhook configuration (webhook_configs table)
 * - SSRF-guarded URL validation (shared with media link validation)
 * - Dispatch with retry/backoff
 */

const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const { db } = require('../config/database');

function isPrivateAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            // Documentation / reserved ranges (RFC 5737, 6890)
            (a === 192 && (b === 0 || b === 2)) ||
            (a === 198 && b === 51) ||
            (a === 203 && b === 0) ||
            a >= 224;
    }

    if (net.isIP(address) === 6) {
        const normalized = address.toLowerCase();
        if (normalized.startsWith('::ffff:')) {
            return isPrivateAddress(normalized.slice(7));
        }
        const firstGroup = normalized.split(':')[0];
        return normalized === '::' || normalized === '::1' ||
            normalized.startsWith('fc') || normalized.startsWith('fd') ||
            normalized.startsWith('fe80:') ||
            // Link-local / unique-local / multicast / documentation ranges
            normalized.startsWith('ff') || // ff00::/8 multicast
            firstGroup === '2001' && normalized.startsWith('2001:db8:'); // 2001:db8::/32
    }

    return true;
}

function isLocalHostname(hostname) {
    const lower = hostname.toLowerCase().replace(/\.$/, '');
    return lower === 'localhost' || lower.endsWith('.localhost') ||
        lower.endsWith('.local') || lower.endsWith('.internal') ||
        lower.endsWith('.lan') || lower.endsWith('.home.arpa');
}

/**
 * Validate an HTTPS webhook URL (no credentials, no private/reserved targets)
 */
async function validateWebhookUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('Webhook URL must be a valid HTTPS URL');
    }

    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Webhook URL must be a credential-free HTTPS URL');
    }

    return validateResolvedTarget(url, 'Webhook URL');
}

/**
 * Validate a URL that the server will fetch (media links, webhooks).
 * Allows http/https but blocks private, reserved, and local addresses.
 */
async function validateExternalUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('URL must be a valid http(s) URL');
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('URL must be a credential-free http(s) URL');
    }

    return validateResolvedTarget(url, 'URL');
}

async function validateResolvedTarget(url, label) {
    const hostname = url.hostname;

    // Literal IP targets: check directly
    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            throw new Error(`${label} must not point to a private or reserved address`);
        }
        return url.toString();
    }

    if (isLocalHostname(hostname)) {
        throw new Error(`${label} must not point to a local address`);
    }

    // DNS resolution (best-effort; on failure the request itself will fail)
    try {
        const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
            throw new Error(`${label} must not resolve to a private or reserved address`);
        }
    } catch (err) {
        if (err instanceof Error && err.message.includes('must not')) {
            throw err;
        }
        // DNS failure: let the actual request fail with a normal error
    }

    return url.toString();
}

/**
 * Dispatch a webhook event with retry/backoff. Never throws.
 * @returns {Promise<boolean>} true if delivered
 */
async function dispatchWebhook(url, event, sessionId, data) {
    if (!url) return false;

    let target;
    try {
        target = await validateWebhookUrl(url);
    } catch (err) {
        console.error(`[Webhook] Invalid webhook URL for session ${sessionId}: ${err.message}`);
        return false;
    }

    const payload = {
        event,
        sessionId,
        data,
        timestamp: new Date().toISOString()
    };

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await axios.post(target, payload, {
                timeout: 10000,
                maxRedirects: 0,
                validateStatus: status => status >= 200 && status < 300,
                headers: { 'Content-Type': 'application/json' }
            });
            return true;
        } catch (err) {
            if (attempt === maxAttempts) {
                console.error(`[Webhook] Delivery failed for session ${sessionId} (${event}):`, err.message);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
    }

    return false;
}

// --- Persistent configuration ---

function setWebhookUrl(sessionId, url) {
    const stmt = db.prepare(`
        INSERT INTO webhook_configs (session_id, url, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(session_id) DO UPDATE SET
            url = excluded.url,
            updated_at = datetime('now')
    `);
    stmt.run(sessionId, url);
}

function getWebhookUrl(sessionId) {
    const stmt = db.prepare('SELECT url FROM webhook_configs WHERE session_id = ?');
    const row = stmt.get(sessionId);
    return (row && row.url) || process.env.WEBHOOK_URL || '';
}

function removeWebhookUrl(sessionId) {
    const stmt = db.prepare('DELETE FROM webhook_configs WHERE session_id = ?');
    stmt.run(sessionId);
}

function getAllWebhookUrls() {
    const stmt = db.prepare('SELECT session_id, url FROM webhook_configs');
    return stmt.all();
}

module.exports = {
    dispatchWebhook,
    validateWebhookUrl,
    validateExternalUrl,
    isPrivateAddress,
    setWebhookUrl,
    getWebhookUrl,
    removeWebhookUrl,
    getAllWebhookUrls
};
