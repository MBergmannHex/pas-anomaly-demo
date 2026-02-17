/**
 * Control Loop routes - handles control loop analysis
 */

const express = require('express');
const router = express.Router();
const openaiProxy = require('../services/openai-proxy');
const prompts = require('../prompts');

/**
 * POST /api/control-loop/extract
 * Extract numerical values from operator logs (Responses API)
 */
router.post('/extract', async (req, res, next) => {
    try {
        const { tag, logEntries, maxOutputTokens = 1000, temperature = 0 } = req.body;

        if (!tag || !logEntries || !Array.isArray(logEntries)) {
            return res.status(400).json({ error: 'tag and logEntries array are required' });
        }

        // Construct prompts server-side
        const systemPrompt = prompts.controlLoopParser(tag);
        const userPrompt = `Analyze these logs:\n${logEntries.map(e => e.text || e).join('\n')}`;

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
