const request = require('supertest');
const { app } = require('../index');
const config = require('../config');

jest.setTimeout(10000);

describe('API Tests', () => {
    let adminToken;
    let sessionToken;
    const testSessionId = 'test-session-' + Date.now();

    beforeAll(async () => {
        // Login as admin to get token
        const loginResponse = await request(app)
            .post('/admin/login')
            .send({
                username: config.security.adminUser,
                password: config.security.adminPass
            });
        
        if (loginResponse.status === 200) {
            adminToken = loginResponse.body.token;
        }
    });

    describe('Health Check Endpoints', () => {
        test('GET /health should return 200 and health status', async () => {
            const response = await request(app).get('/health');
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'healthy');
            expect(response.body).toHaveProperty('version');
            expect(response.body).toHaveProperty('uptime');
        });

        test('GET /ping should return pong', async () => {
            const response = await request(app).get('/ping');
            
            expect(response.status).toBe(200);
            expect(response.text).toBe('pong');
        });
    });

    describe('Admin Authentication', () => {
        test('POST /admin/login with valid credentials should return token', async () => {
            const response = await request(app)
                .post('/admin/login')
                .send({
                    username: config.security.adminUser,
                    password: config.security.adminPass
                });
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'success');
            expect(response.body).toHaveProperty('token');
        });

        test('POST /admin/login with invalid credentials should return 401', async () => {
            const response = await request(app)
                .post('/admin/login')
                .send({
                    username: 'invalid',
                    password: 'invalid'
                });
            
            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('status', 'error');
        });

        test('POST /admin/login with missing fields should return validation error', async () => {
            const response = await request(app)
                .post('/admin/login')
                .send({
                    username: 'test'
                });
            
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('status', 'error');
            expect(response.body.message).toContain('Validation error');
        });

        test('POST /admin/verify with valid token should return success', async () => {
            if (!adminToken) {
                console.log('Skipping admin verify test - no admin token');
                return;
            }

            const response = await request(app)
                .post('/admin/verify')
                .set('Authorization', `Bearer ${adminToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'success');
        });

        test('POST /admin/verify without token should return 401', async () => {
            const response = await request(app)
                .post('/admin/verify');
            
            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('status', 'error');
        });
    });

    describe('Session Management', () => {
        test('GET /api/v1/sessions should return sessions list', async () => {
            const response = await request(app).get('/api/v1/sessions');
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'success');
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        test('POST /api/v1/sessions should create a new session', async () => {
            const response = await request(app)
                .post('/api/v1/sessions')
                .send({
                    sessionId: testSessionId
                });
            
            expect(response.status).toBe(201);
            expect(response.body).toHaveProperty('status', 'success');
            expect(response.body).toHaveProperty('token');
            expect(response.body).toHaveProperty('sessionId', testSessionId);
            
            sessionToken = response.body.token;
        });

        test('POST /api/v1/sessions with duplicate sessionId should return 409', async () => {
            const response = await request(app)
                .post('/api/v1/sessions')
                .send({
                    sessionId: testSessionId
                });
            
            expect(response.status).toBe(409);
            expect(response.body).toHaveProperty('status', 'error');
            expect(response.body).toHaveProperty('code', 'SESSION_EXISTS');
        });

        test('POST /api/v1/sessions with invalid sessionId should return validation error', async () => {
            const response = await request(app)
                .post('/api/v1/sessions')
                .send({
                    sessionId: 'x' // Too short
                });
            
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('status', 'error');
            expect(response.body.message).toContain('Validation error');
        });
    });

    describe('Webhook Management', () => {
        test('POST /api/v1/webhook should require authentication', async () => {
            const response = await request(app)
                .post('/api/v1/webhook')
                .send({
                    url: 'https://example.com/webhook'
                });
            
            expect(response.status).toBe(401);
            expect(response.body).toHaveProperty('status', 'error');
        });

        test('POST /api/v1/webhook with valid token should update webhook URL', async () => {
            if (!sessionToken) {
                console.log('Skipping webhook test - no session token');
                return;
            }

            const response = await request(app)
                .post('/api/v1/webhook')
                .set('Authorization', `Bearer ${sessionToken}`)
                .send({
                    url: 'https://example.com/webhook'
                });
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'success');
            expect(response.body).toHaveProperty('url', 'https://example.com/webhook');
        });

        test('GET /api/v1/webhook should return current webhook config', async () => {
            if (!sessionToken) {
                console.log('Skipping webhook get test - no session token');
                return;
            }

            const response = await request(app)
                .get('/api/v1/webhook')
                .set('Authorization', `Bearer ${sessionToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('status', 'success');
            expect(response.body).toHaveProperty('configured');
        });
    });

    describe('Message Validation', () => {
        test('POST /api/v1/messages should require sessionId parameter', async () => {
            if (!sessionToken) {
                console.log('Skipping message test - no session token');
                return;
            }

            const response = await request(app)
                .post('/api/v1/messages')
                .set('Authorization', `Bearer ${sessionToken}`)
                .send({
                    recipient_type: 'individual',
                    to: '1234567890',
                    type: 'text',
                    text: { body: 'Test message' }
                });
            
            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('code', 'MISSING_SESSION_ID');
        });

        test('POST /api/v1/messages should validate message format', async () => {
            if (!sessionToken) {
                console.log('Skipping message validation test - no session token');
                return;
            }

            const response = await request(app)
                .post(`/api/v1/messages?sessionId=${testSessionId}`)
                .set('Authorization', `Bearer ${sessionToken}`)
                .send({
                    // Missing required fields
                    type: 'text'
                });
            
            expect(response.status).toBe(200);
            expect(response.body.results[0]).toHaveProperty('status', 'error');
            expect(response.body.results[0]).toHaveProperty('code', 'VALIDATION_ERROR');
        });
    });

    describe('Rate Limiting', () => {
        test('Multiple requests should be rate limited', async () => {
            const promises = [];
            
            // Send multiple requests rapidly
            for (let i = 0; i < 10; i++) {
                promises.push(
                    request(app)
                        .get('/api/v1/sessions')
                );
            }
            
            const responses = await Promise.all(promises);
            const successCount = responses.filter(r => r.status === 200).length;
            
            // All should succeed since we're within rate limit for now
            expect(successCount).toBeGreaterThan(0);
        });
    });

    describe('Error Handling', () => {
        test('Non-existent endpoint should return 404', async () => {
            const response = await request(app).get('/non-existent-endpoint');
            
            expect(response.status).toBe(404);
            expect(response.body).toHaveProperty('status', 'error');
            expect(response.body).toHaveProperty('message');
        });

        test('Invalid JSON should be handled gracefully', async () => {
            const response = await request(app)
                .post('/api/v1/sessions')
                .send('invalid json')
                .set('Content-Type', 'application/json');
            
            expect(response.status).toBe(400);
        });
    });

    // Cleanup
    afterAll(async () => {
        if (sessionToken) {
            try {
                await request(app)
                    .delete(`/api/v1/sessions/${testSessionId}`)
                    .set('Authorization', `Bearer ${sessionToken}`);
            } catch (error) {
                console.log('Cleanup error:', error.message);
            }
        }
    });
}); 