/**
 * D&R Processing routes - handles alarm rationalization AI calls
 */

const express = require('express');
const router = express.Router();
const openaiProxy = require('../services/openai-proxy');
const prompts = require('../prompts');
const { buildBatchRationalizationPrompt } = require('../utils/prompt-builder');

/**
 * POST /api/dr/analyze-process
 * Process context analysis Step 1 (Responses API, may include P&ID image)
 *
 * Injects server-side process-analyzer.js prompt as system instructions.
 */
router.post('/analyze-process', async (req, res, next) => {
    try {
        const { userPrompt, pidImageBase64, modelConfig = {}, maxOutputTokens = 32000 } = req.body;

        if (!userPrompt) {
            return res.status(400).json({ error: 'userPrompt is required' });
        }

        // Build user message content (text + optional image)
        let userContent = userPrompt;

        if (pidImageBase64) {
            // Multi-modal input with image
            userContent = [
                { type: 'text', text: userPrompt },
                {
                    type: 'image_url',
                    image_url: {
                        url: pidImageBase64.startsWith('data:') ? pidImageBase64 : `data:image/png;base64,${pidImageBase64}`
                    }
                }
            ];
        }

        // Build input array (user messages only)
        const input = [
            {
                type: 'message',
                role: 'user',
                content: userContent
            }
        ];

        // Call with retry logic for context_length_exceeded
        // Server-side prompt injection: use prompts.processAnalyzer from server/prompts/
        const result = await openaiProxy.callResponsesWithRetry(input, {
            deploymentType: modelConfig.deploymentType || 'dr',
            reasoningEffort: modelConfig.reasoningEffort,
            maxOutputTokens,
            instructions: prompts.processAnalyzer  // Server-side system prompt
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/dr/web-search
 * Process context analysis Step 2 with web search enrichment (Responses API)
 */
router.post('/web-search', async (req, res, next) => {
    try {
        const { userPrompt, modelConfig = {}, maxOutputTokens = 128000 } = req.body;

        if (!userPrompt) {
            return res.status(400).json({ error: 'userPrompt is required' });
        }

        const input = [
            {
                type: 'message',
                role: 'user',
                content: userPrompt
            }
        ];

        // Enable web search tool
        const result = await openaiProxy.callResponses(input, {
            deploymentType: modelConfig.deploymentType || 'dr',
            reasoningEffort: modelConfig.reasoningEffort,
            maxOutputTokens,
            tools: [{ type: 'web_search_preview' }]
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/dr/extract-philosophy
 * Extract alarm philosophy rules from PDF text (Chat Completions API)
 */
router.post('/extract-philosophy', async (req, res, next) => {
    try {
        const { pdfText, modelConfig = {} } = req.body;

        if (!pdfText) {
            return res.status(400).json({ error: 'pdfText is required' });
        }

        const messages = [
            {
                role: 'system',
                content: prompts.philosophyExtraction
            },
            {
                role: 'user',
                content: pdfText
            }
        ];

        const result = await openaiProxy.callChatCompletions(messages, {
            deploymentType: modelConfig.deploymentType || 'dr',
            reasoningEffort: modelConfig.reasoningEffort,
            maxTokens: 16000
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/dr/derive-regex
 * Derive a regex pattern from example tag/prefix pairs using AI
 */
router.post('/derive-regex', async (req, res, next) => {
    try {
        const { examples } = req.body;

        if (!examples || !Array.isArray(examples) || examples.length === 0) {
            return res.status(400).json({ error: 'examples array is required and must not be empty' });
        }

        // Filter valid examples and format as text
        const validExamples = examples.filter(e => e.tag && e.prefix);
        if (validExamples.length === 0) {
            return res.status(400).json({ error: 'No valid examples provided (each must have tag and prefix)' });
        }

        const examplesText = validExamples.map(e => `Tag: "${e.tag}" -> Prefix: "${e.prefix}"`).join('\n');

        // Build prompt using template function
        const prompt = prompts.regexDerivation(examplesText);

        // Use general deployment for regex derivation (simpler, faster than D&R model)
        const messages = [
            { role: 'user', content: prompt }
        ];

        const result = await openaiProxy.callChatCompletions(messages, {
            deploymentType: 'general',
            maxTokens: 1000,
            temperature: 0.3
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/dr/batch-rationalize
 * Batch D&R rationalization for 10 alarms (Chat Completions API, may include P&ID image)
 *
 * Accepts structured data instead of pre-assembled messages for better separation of concerns.
 * The backend constructs the user prompt from the provided data.
 */
router.post('/batch-rationalize', async (req, res, next) => {
    try {
        const {
            alarms,
            processContext,
            philosophyRules,
            processAnalysis,
            referenceAlarms,
            previousDrafts,
            detectedPriorityScheme,
            pidImageBase64,
            modelConfig = {},
            maxTokens = 32000,
            temperature = 0.2
        } = req.body;

        // Validate required fields
        if (!alarms || !Array.isArray(alarms) || alarms.length === 0) {
            return res.status(400).json({ error: 'alarms array is required and must not be empty' });
        }

        // Build user prompt from structured data
        const userPrompt = buildBatchRationalizationPrompt({
            alarms,
            processContext,
            philosophyRules,
            processAnalysis,
            referenceAlarms,
            previousDrafts,
            detectedPriorityScheme: detectedPriorityScheme || 'numeric'
        });

        // Construct messages array with system prompt from server-side
        let userContent = userPrompt;

        // Add P&ID image if provided (multimodal content)
        if (pidImageBase64) {
            userContent = [
                { type: 'text', text: userPrompt },
                {
                    type: 'image_url',
                    image_url: {
                        url: pidImageBase64.startsWith('data:') ? pidImageBase64 : `data:image/jpeg;base64,${pidImageBase64}`
                    }
                }
            ];
        }

        const messages = [
            { role: 'system', content: prompts.batchDrafter },
            { role: 'user', content: userContent }
        ];

        const result = await openaiProxy.callChatCompletions(messages, {
            deploymentType: modelConfig.deploymentType || 'dr',
            reasoningEffort: modelConfig.reasoningEffort,
            isReasoning: modelConfig.isReasoning,
            maxTokens,
            temperature
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
