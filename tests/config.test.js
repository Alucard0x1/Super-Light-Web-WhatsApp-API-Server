const config = require('../config');

describe('Configuration Tests', () => {
    test('config should have all required sections', () => {
        expect(config).toHaveProperty('server');
        expect(config).toHaveProperty('security');
        expect(config).toHaveProperty('whatsapp');
        expect(config).toHaveProperty('storage');
        expect(config).toHaveProperty('webhook');
        expect(config).toHaveProperty('logging');
    });

    test('server config should have required properties', () => {
        expect(config.server).toHaveProperty('port');
        expect(config.server).toHaveProperty('host');
        expect(config.server).toHaveProperty('environment');
        
        expect(typeof config.server.port).toBe('number');
        expect(typeof config.server.host).toBe('string');
        expect(typeof config.server.environment).toBe('string');
    });

    test('security config should have required properties', () => {
        expect(config.security).toHaveProperty('jwtSecret');
        expect(config.security).toHaveProperty('adminUser');
        expect(config.security).toHaveProperty('adminPass');
        expect(config.security).toHaveProperty('sessionTimeout');
        expect(config.security).toHaveProperty('rateLimitWindow');
        expect(config.security).toHaveProperty('rateLimitMax');
        
        expect(typeof config.security.jwtSecret).toBe('string');
        expect(config.security.jwtSecret.length).toBeGreaterThan(10);
        expect(typeof config.security.rateLimitWindow).toBe('number');
        expect(typeof config.security.rateLimitMax).toBe('number');
    });

    test('whatsapp config should have required properties', () => {
        expect(config.whatsapp).toHaveProperty('qrTimeout');
        expect(config.whatsapp).toHaveProperty('retryCount');
        expect(config.whatsapp).toHaveProperty('reconnectDelay');
        expect(config.whatsapp).toHaveProperty('browser');
        
        expect(typeof config.whatsapp.qrTimeout).toBe('number');
        expect(typeof config.whatsapp.retryCount).toBe('number');
        expect(typeof config.whatsapp.reconnectDelay).toBe('number');
        expect(typeof config.whatsapp.browser).toBe('string');
    });

    test('storage config should have valid paths', () => {
        expect(config.storage).toHaveProperty('authDir');
        expect(config.storage).toHaveProperty('mediaDir');
        expect(config.storage).toHaveProperty('tokensFile');
        expect(config.storage).toHaveProperty('logsDir');
        
        expect(typeof config.storage.authDir).toBe('string');
        expect(typeof config.storage.mediaDir).toBe('string');
        expect(typeof config.storage.tokensFile).toBe('string');
        expect(typeof config.storage.logsDir).toBe('string');
    });

    test('webhook config should have timeout and retries', () => {
        expect(config.webhook).toHaveProperty('timeout');
        expect(config.webhook).toHaveProperty('retries');
        
        expect(typeof config.webhook.timeout).toBe('number');
        expect(typeof config.webhook.retries).toBe('number');
        expect(config.webhook.timeout).toBeGreaterThan(0);
        expect(config.webhook.retries).toBeGreaterThan(0);
    });

    test('logging config should have valid settings', () => {
        expect(config.logging).toHaveProperty('level');
        expect(config.logging).toHaveProperty('fileLogging');
        expect(config.logging).toHaveProperty('maxFileSize');
        expect(config.logging).toHaveProperty('maxFiles');
        
        expect(typeof config.logging.level).toBe('string');
        expect(typeof config.logging.fileLogging).toBe('boolean');
        expect(typeof config.logging.maxFiles).toBe('number');
        
        const validLevels = ['error', 'warn', 'info', 'debug'];
        expect(validLevels.includes(config.logging.level)).toBe(true);
    });

    test('rate limiting values should be reasonable', () => {
        expect(config.security.rateLimitWindow).toBeGreaterThan(0);
        expect(config.security.rateLimitMax).toBeGreaterThan(0);
        expect(config.security.rateLimitWindow).toBeLessThan(24 * 60 * 60 * 1000); // Less than 24 hours
        expect(config.security.rateLimitMax).toBeLessThan(10000); // Reasonable upper limit
    });

    test('timeout values should be reasonable', () => {
        expect(config.whatsapp.qrTimeout).toBeGreaterThan(1000); // At least 1 second
        expect(config.whatsapp.qrTimeout).toBeLessThan(300000); // Less than 5 minutes
        expect(config.webhook.timeout).toBeGreaterThan(100); // At least 100ms
        expect(config.webhook.timeout).toBeLessThan(60000); // Less than 1 minute
    });
}); 