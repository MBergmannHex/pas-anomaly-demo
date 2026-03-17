
const errorHandler = require('../middleware/error-handler');

function callErrorHandler(err) {
    let statusCode, body;
    const req = {};
    const res = {
        status(code) { statusCode = code; return this; },
        json(data) { body = data; }
    };
    const next = () => {};
    errorHandler(err, req, res, next);
    return { statusCode, body };
}

describe('error-handler middleware', () => {
    it('returns 500 for generic errors', () => {
        const { statusCode, body } = callErrorHandler(new Error('Something broke'));
        expect(statusCode).toBe(500);
        expect(body.error).toBe('Something broke');
    });

    it('uses err.statusCode when provided', () => {
        const err = new Error('Not found');
        err.statusCode = 404;
        const { statusCode, body } = callErrorHandler(err);
        expect(statusCode).toBe(404);
        expect(body.error).toBe('Not found');
    });

    it('sanitizes Azure API keys from error messages', () => {
        const err = new Error('Failed: api-key: abc123secret');
        const { body } = callErrorHandler(err);
        expect(body.error).not.toContain('abc123secret');
        expect(body.error).toContain('[REDACTED]');
    });

    it('sanitizes Azure OpenAI endpoints from error messages', () => {
        const err = new Error('Error connecting to https://myresource.openai.azure.com/deployments');
        const { body } = callErrorHandler(err);
        expect(body.error).not.toContain('myresource');
        expect(body.error).toContain('[AZURE_ENDPOINT]');
    });

    it('includes stack trace in development', () => {
        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        // Re-require to pick up env change? No - the middleware checks at call time
        const { body } = callErrorHandler(new Error('dev error'));
        process.env.NODE_ENV = origEnv;
        expect(body.stack).toBeDefined();
    });

    it('omits stack trace in production', () => {
        const origEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const { body } = callErrorHandler(new Error('prod error'));
        process.env.NODE_ENV = origEnv;
        expect(body.stack).toBeUndefined();
    });
});
