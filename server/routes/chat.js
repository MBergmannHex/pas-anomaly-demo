/**
 * Chat routes - handles chatbot and AI chat functionality
 */

const express = require('express');
const router = express.Router();
const openaiProxy = require('../services/openai-proxy');

/**
 * POST /api/chat/send
 * Main chatbot message endpoint (Responses API with tools)
 */
router.post('/send', async (req, res, next) => {
    try {
        const { message, conversationHistory = [], modelConfig = {} } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Build input array from conversation history + new message
        const input = [
            ...conversationHistory.map(msg => ({
                type: 'message',
                role: msg.role,
                content: msg.content
            })),
            {
                type: 'message',
                role: 'user',
                content: message
            }
        ];

        // Call Responses API
        const result = await openaiProxy.callResponses(input, {
            deploymentType: modelConfig.deploymentType || 'general',
            reasoningEffort: modelConfig.reasoningEffort,
            maxOutputTokens: 16000
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/chat/follow-up
 * Chatbot follow-up with tool execution results (Responses API)
 */
router.post('/follow-up', async (req, res, next) => {
    try {
        const { inputMessages, tools, modelConfig = {} } = req.body;

        if (!inputMessages || !Array.isArray(inputMessages)) {
            return res.status(400).json({ error: 'inputMessages array is required' });
        }

        // Call Responses API with tool results
        const result = await openaiProxy.callResponses(inputMessages, {
            deploymentType: modelConfig.deploymentType || 'general',
            reasoningEffort: modelConfig.reasoningEffort,
            tools: tools,
            maxOutputTokens: 16000
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/chat/generate-report
 * Generate PDF report narrative (Chat Completions API)
 */
router.post('/generate-report', async (req, res, next) => {
    try {
        const { systemPrompt, temperature = 0.7 } = req.body;

        if (!systemPrompt) {
            return res.status(400).json({ error: 'systemPrompt is required' });
        }

        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        const result = await openaiProxy.callChatCompletions(messages, {
            deploymentType: 'general',
            temperature
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/chat/extract-philosophy
 * Extract alarm philosophy from PDF text (Responses API)
 */
router.post('/extract-philosophy', async (req, res, next) => {
    try {
        const { pdfText } = req.body;

        if (!pdfText) {
            return res.status(400).json({ error: 'pdfText is required' });
        }

        // Truncate to 15000 chars (matches frontend logic)
        const truncatedText = pdfText.substring(0, 15000);

        const input = [
            {
                type: 'message',
                role: 'user',
                content: `Extract alarm philosophy rules from this document:\n\n${truncatedText}`
            }
        ];

        const result = await openaiProxy.callResponses(input, {
            deploymentType: 'general',
            maxOutputTokens: 8000
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/chat/enrich-safety
 * Enrich with safety data from document (Responses API)
 */
router.post('/enrich-safety', async (req, res, next) => {
    try {
        const { safetyText } = req.body;

        if (!safetyText) {
            return res.status(400).json({ error: 'safetyText is required' });
        }

        // Truncate to 20000 chars (matches frontend logic)
        const truncatedText = safetyText.substring(0, 20000);

        const input = [
            {
                type: 'message',
                role: 'user',
                content: `Extract safety data from this document:\n\n${truncatedText}`
            }
        ];

        const result = await openaiProxy.callResponses(input, {
            deploymentType: 'general',
            maxOutputTokens: 8000
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
