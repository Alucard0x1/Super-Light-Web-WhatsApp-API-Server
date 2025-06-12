const request = require('supertest');
const { app } = require('../index'); // Only import app

jest.setTimeout(5000); // Very short timeout

describe('Hyper Minimal Test Suite', () => {

  describe('GET /ping', () => {
    it('should return 200 and pong', async () => {
      const response = await request(app).get('/ping');
      expect(response.status).toBe(200);
      expect(response.text).toBe('pong');
    });
  });

  describe('GET /sessions (hyper-minimal)', () => {
    it('should return 200 and an empty array', async () => {
        const response = await request(app).get('/sessions');
        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      });
  });
});

// afterAll is not strictly necessary for this hyper-minimal test if it exits cleanly
// afterAll(done => {
//   done();
// });
