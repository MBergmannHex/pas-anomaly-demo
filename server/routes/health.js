/**
 * Health check route
 */

const express = require('express');
const router = express.Router();
const openaiProxy = require('../services/openai-proxy');

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '5.0.0'
    });
});

/**
 * POST /api/test-connection
 * Test Azure OpenAI API connection
 */
router.post('/test-connection', async (req, res, next) => {
    try {
        const { deploymentType = 'dr' } = req.body;

        const messages = [
            { role: 'user', content: 'Respond with "API_TEST_OK"' }
        ];

        const result = await openaiProxy.callChatCompletions(messages, {
            deploymentType,
            maxTokens: 10
        });

        const deployment = openaiProxy.resolveDeployment(deploymentType);
        const isReasoning = openaiProxy.isReasoningModel(deployment);

        res.json({
            success: true,
            message: `API connection successful. Model: ${deployment}`,
            modelInfo: {
                deployment,
                isReasoning,
                reasoningEffort: isReasoning ? openaiProxy.defaultReasoningEffort : null,
                response: result.content.trim()
            }
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
