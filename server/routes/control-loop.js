/**
 * Control Loop routes - handles control loop analysis
 */

const express = require('express');
const router = express.Router();
const openaiProxy = require('../services/openai-proxy');

/**
 * POST /api/control-loop/extract
 * Extract numerical values from operator logs (Responses API)
 */
router.post('/extract', async (req, res, next) => {
    try {
        const { systemPrompt, userPrompt, maxOutputTokens = 1000, temperature = 0 } = req.body;

        if (!systemPrompt || !userPrompt) {
            return res.status(400).json({ error: 'systemPrompt and userPrompt are required' });
        }

        const input = [
            {
                type: 'message',
                role: 'system',
                content: systemPrompt
            },
            {
                type: 'message',
                role: 'user',
                content: userPrompt
            }
        ];

        const result = await openaiProxy.callResponses(input, {
            deploymentType: 'general',
            maxOutputTokens,
            temperature
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
