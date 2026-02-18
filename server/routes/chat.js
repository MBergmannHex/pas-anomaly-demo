/**
 * Chat routes - handles chatbot and AI chat functionality
 */

const express = require('express');
const router = express.Router();
const openaiProxy = require('../services/openai-proxy');
const prompts = require('../prompts');

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

        // Call Responses API with chatbot persona system prompt
        const result = await openaiProxy.callResponses(input, {
            deploymentType: modelConfig.deploymentType || 'general',
            reasoningEffort: modelConfig.reasoningEffort,
            maxOutputTokens: 16000,
            instructions: prompts.chatbotPersona
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

        // Call Responses API with tool results and chatbot persona
        const result = await openaiProxy.callResponses(inputMessages, {
            deploymentType: modelConfig.deploymentType || 'general',
            reasoningEffort: modelConfig.reasoningEffort,
            tools: tools,
            maxOutputTokens: 16000,
            instructions: prompts.chatbotPersona
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
        const { dataSummary, focusArea, temperature = 0.7 } = req.body;

        if (!dataSummary) {
            return res.status(400).json({ error: 'dataSummary is required' });
        }

        // Construct prompt server-side
        const systemPrompt = prompts.reportGeneration(dataSummary, focusArea);

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

        // Truncate to 100000 chars to utilize 128k token capacity (~75k tokens for input)
        const maxChars = 100000;
        const wasTruncated = pdfText.length > maxChars;
        const truncatedText = pdfText.substring(0, maxChars);

        if (wasTruncated) {
            console.log(`[Chat Philosophy Extract] PDF truncated from ${pdfText.length} to ${maxChars} characters`);
        }

        const input = [
            {
                type: 'message',
                role: 'user',
                content: `${prompts.chatPhilosophyExtract}${truncatedText}`
            }
        ];

        const result = await openaiProxy.callResponses(input, {
            deploymentType: 'general',
            maxOutputTokens: 16000
        });

        // Add truncation info to response if applicable
        if (wasTruncated) {
            result.wasTruncated = true;
            result.originalLength = pdfText.length;
            result.truncatedLength = maxChars;
        }

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

        // Truncate to 100000 chars to utilize 128k token capacity (~75k tokens for input)
        const maxChars = 100000;
        const wasTruncated = safetyText.length > maxChars;
        const truncatedText = safetyText.substring(0, maxChars);

        if (wasTruncated) {
            console.log(`[Safety Enrichment] Document truncated from ${safetyText.length} to ${maxChars} characters`);
        }

        const input = [
            {
                type: 'message',
                role: 'user',
                content: `${prompts.safetyEnrichment}${truncatedText}`
            }
        ];

        const result = await openaiProxy.callResponses(input, {
            deploymentType: 'general',
            maxOutputTokens: 16000
        });

        // Add truncation info to response if applicable
        if (wasTruncated) {
            result.wasTruncated = true;
            result.originalLength = safetyText.length;
            result.truncatedLength = maxChars;
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
