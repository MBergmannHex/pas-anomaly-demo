/**
 * Configuration loader for Alarm Analyzer Pro
 * Loads settings from environment variables
 */

require('dotenv').config();

module.exports = {
    azureOpenAI: {
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        generalDeployment: process.env.AZURE_OPENAI_GENERAL_DEPLOYMENT || 'gpt-4.1',
        drDeployment: process.env.AZURE_OPENAI_DR_DEPLOYMENT || 'gpt-5',
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-03-01-preview',
        defaultReasoningEffort: process.env.AZURE_OPENAI_REASONING_EFFORT || 'medium'
    },
    server: {
        port: process.env.PORT || 8080,
        nodeEnv: process.env.NODE_ENV || 'development',
        corsOrigin: process.env.CORS_ORIGIN || '*',
        bodyLimit: process.env.BODY_LIMIT || '50mb'
    },
    rateLimiting: {
        windowMs: 15 * 60 * 1000,  // 15 minutes
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX) || 100
    }
};
