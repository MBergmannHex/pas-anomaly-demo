/**
 * D&R Processing routes - handles alarm rationalization AI calls
 */

const express = require('express');
const router = express.Router();
const openaiProxy = require('../services/openai-proxy');

/**
 * POST /api/dr/analyze-process
 * Process context analysis Step 1 (Responses API, may include P&ID image)
 */
router.post('/analyze-process', async (req, res, next) => {
    try {
        const { userPrompt, systemInstructions, pidImageBase64, modelConfig = {}, maxOutputTokens = 32000 } = req.body;

        if (!userPrompt) {
            return res.status(400).json({ error: 'userPrompt is required' });
        }

        // Build input with system instructions and user prompt
        const input = [];

        if (systemInstructions) {
            input.push({
                type: 'message',
                role: 'system',
                content: systemInstructions
            });
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

        input.push({
            type: 'message',
            role: 'user',
            content: userContent
        });

        // Call with retry logic for context_length_exceeded
        const result = await openaiProxy.callResponsesWithRetry(input, {
            deploymentType: modelConfig.deploymentType || 'dr',
            reasoningEffort: modelConfig.reasoningEffort,
            maxOutputTokens
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
                content: `You are an alarm management expert specializing in ISA 18.2, IEC 62682, and EEMUA 191 standards.
Extract structured alarm philosophy rules from the provided document.

Output MUST be valid JSON with this exact structure:
{
  "document": {
    "title": "...",
    "site": "...",
    "date": "...",
    "vendor_system": "..."
  },
  "priority_matrix": [
    {
      "time_range": "<3 min",
      "minor": "High",
      "major": "Emergency",
      "severe": "Emergency"
    },
    {
      "time_range": "3-10 min",
      "minor": "Low",
      "major": "High",
      "severe": "High"
    },
    {
      "time_range": "10-30 min",
      "minor": "Low",
      "major": "Low",
      "severe": "High"
    },
    {
      "time_range": ">30 min",
      "minor": "No Alarm",
      "major": "No Alarm",
      "severe": "No Alarm"
    }
  ],
  "severity_matrix": [
    {
      "category": "consequence_severity_basis",
      "rule": "Use worst-case severity across Personnel, Public/Environment, Plant Equipment/Production Loss",
      "minor": "Minor injury, <$10k loss, minor environmental impact",
      "major": "Lost time injury, $10k-$100k loss, reportable environmental impact",
      "severe": "Serious injury/fatality, >$100k loss, serious environmental impact"
    }
  ],
  "rules": [
    {
      "id": "ALM-001",
      "category": "...",
      "rule": "...",
      "source": ["Section X.Y"]
    }
  ]
}

Return ONLY the JSON object. Do not include markdown code blocks.`
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
 * POST /api/dr/batch-rationalize
 * Batch D&R rationalization for 10 alarms (Chat Completions API, may include P&ID image)
 */
router.post('/batch-rationalize', async (req, res, next) => {
    try {
        const { messages, modelConfig = {}, maxTokens = 32000, temperature = 0.2 } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array is required' });
        }

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
