
const request = require('supertest');
const app = require('../app');
const modelsData = require('../models.json');

describe('GET /api/models', () => {
    it('returns the models.json data', async () => {
        const res = await request(app).get('/api/models');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(modelsData);
    });

    it('includes chatModels array', async () => {
        const res = await request(app).get('/api/models');
        expect(Array.isArray(res.body.chatModels)).toBe(true);
        expect(res.body.chatModels.length).toBeGreaterThan(0);
    });

    it('each model has required fields', async () => {
        const res = await request(app).get('/api/models');
        for (const model of res.body.chatModels) {
            expect(model).toHaveProperty('deployment');
            expect(model).toHaveProperty('model');
            expect(model).toHaveProperty('sku');
            expect(typeof model.preferred).toBe('boolean');
        }
    });

    it('has at least one preferred model', async () => {
        const res = await request(app).get('/api/models');
        const preferred = res.body.chatModels.filter(m => m.preferred);
        expect(preferred.length).toBeGreaterThanOrEqual(1);
    });
});
