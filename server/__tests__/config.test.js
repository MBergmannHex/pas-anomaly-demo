

describe('server/config', () => {
    it('exports expected structure', () => {
        const config = require('../config');
        expect(config).toHaveProperty('azureOpenAI');
        expect(config).toHaveProperty('server');
        expect(config).toHaveProperty('rateLimiting');
    });

    it('has sensible defaults when env vars are missing', () => {
        const config = require('../config');
        expect(config.azureOpenAI.generalDeployment).toBe(process.env.AZURE_OPENAI_GENERAL_DEPLOYMENT || 'gpt-4.1');
        expect(config.azureOpenAI.drDeployment).toBe(process.env.AZURE_OPENAI_DR_DEPLOYMENT || 'gpt-5.2');
        expect(config.azureOpenAI.apiVersion).toBeDefined();
        expect(config.azureOpenAI.defaultReasoningEffort).toBeDefined();
    });

    it('server defaults to port 8080', () => {
        const config = require('../config');
        expect(config.server.port).toBe(process.env.PORT || 8080);
    });

    it('rate limiting has valid window and max', () => {
        const config = require('../config');
        expect(config.rateLimiting.windowMs).toBe(15 * 60 * 1000);
        expect(config.rateLimiting.maxRequests).toBeGreaterThan(0);
    });
});
