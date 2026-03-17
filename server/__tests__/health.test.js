
const request = require('supertest');
const app = require('../app');

describe('GET /api/health', () => {
    it('returns status ok with version', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.version).toBe('5.0.0');
        expect(res.body.timestamp).toBeDefined();
    });

    it('returns a valid ISO timestamp', async () => {
        const res = await request(app).get('/api/health');
        const date = new Date(res.body.timestamp);
        expect(date.toISOString()).toBe(res.body.timestamp);
    });
});
