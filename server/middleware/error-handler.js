/**
 * Centralized error handling middleware
 */

module.exports = (err, req, res, next) => {
    console.error('Error:', err);

    // Default error response
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server error';

    // Sanitize Azure OpenAI errors (don't leak API keys or endpoints)
    const sanitizedMessage = message
        .replace(/api-key[:\s]+[a-zA-Z0-9]+/gi, 'api-key: [REDACTED]')
        .replace(/https:\/\/[^\/]+\.openai\.azure\.com/gi, '[AZURE_ENDPOINT]');

    res.status(statusCode).json({
        error: sanitizedMessage,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};
