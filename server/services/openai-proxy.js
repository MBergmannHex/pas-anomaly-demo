/**
 * Azure OpenAI Proxy Service
 * Handles all communication with Azure OpenAI API
 */

const config = require('../config');

class OpenAIProxy {
    constructor() {
        this.apiKey = config.azureOpenAI.apiKey;
        this.endpoint = config.azureOpenAI.endpoint;
        this.generalDeployment = config.azureOpenAI.generalDeployment;
        this.drDeployment = config.azureOpenAI.drDeployment;
        this.apiVersion = config.azureOpenAI.apiVersion;
        this.defaultReasoningEffort = config.azureOpenAI.defaultReasoningEffort;

        // Validate configuration
        if (!this.apiKey || !this.endpoint) {
            throw new Error('Azure OpenAI API key and endpoint must be configured');
        }
    }

    /**
     * Resolve deployment name based on type
     */
    resolveDeployment(deploymentType) {
        if (deploymentType === 'dr') {
            return this.drDeployment;
        }
        return this.generalDeployment;
    }

    /**
     * Check if deployment is a reasoning model (GPT-5, o1, o3, o4)
     */
    isReasoningModel(deploymentName) {
        const name = (deploymentName || '').toLowerCase();
        return name.includes('gpt-5') || name.includes('o1') || name.includes('o3') || name.includes('o4');
    }

    /**
     * Build request body for Chat Completions API
     * Mirrors the logic from dr-processor.js buildApiRequestBody()
     */
    buildChatCompletionsBody(messages, options = {}) {
        const deployment = options.deployment || this.generalDeployment;
        const isReasoning = options.isReasoning !== undefined ? options.isReasoning : this.isReasoningModel(deployment);
        const reasoningEffort = options.reasoningEffort || this.defaultReasoningEffort;

        const body = { messages };

        // For reasoning models (GPT-5, o1, o3), use reasoning_effort instead of temperature
        if (isReasoning) {
            body.reasoning_effort = reasoningEffort;
        } else {
            body.temperature = options.temperature !== undefined ? options.temperature : 0.7;
        }

        // Add token limit - reasoning models use max_completion_tokens instead of max_tokens
        if (options.maxTokens) {
            if (isReasoning) {
                body.max_completion_tokens = options.maxTokens;
            } else {
                body.max_tokens = options.maxTokens;
            }
        }

        return body;
    }

    /**
     * Call Chat Completions API
     * Pattern: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
     */
    async callChatCompletions(messages, options = {}) {
        const deployment = options.deployment || this.resolveDeployment(options.deploymentType || 'general');
        const body = this.buildChatCompletionsBody(messages, { ...options, deployment });

        const url = `${this.endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${this.apiVersion}`;

        console.log(`[OpenAI] Chat Completions - Deployment: ${deployment}, Reasoning: ${this.isReasoningModel(deployment)}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': this.apiKey
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[OpenAI] Error ${response.status}:`, errorText);

            const error = new Error(`Azure OpenAI API error: ${response.status}`);
            error.statusCode = response.status;
            error.details = errorText;
            throw error;
        }

        const data = await response.json();

        return {
            content: data.choices?.[0]?.message?.content || '',
            usage: data.usage || {}
        };
    }

    /**
     * Call Responses API
     * Pattern: {endpoint}/openai/v1/responses
     */
    async callResponses(input, options = {}) {
        const deployment = options.deployment || this.resolveDeployment(options.deploymentType || 'general');
        const isReasoning = this.isReasoningModel(deployment);
        const reasoningEffort = options.reasoningEffort || this.defaultReasoningEffort;

        const body = {
            model: deployment,
            input: input
        };

        // Add reasoning effort for reasoning models
        if (isReasoning) {
            body.reasoning_effort = reasoningEffort;
        } else if (options.temperature !== undefined) {
            body.temperature = options.temperature;
        }

        // Add other parameters
        if (options.maxOutputTokens) {
            body.max_output_tokens = options.maxOutputTokens;
        }
        if (options.tools) {
            body.tools = options.tools;
        }

        const url = `${this.endpoint}/openai/v1/responses`;

        console.log(`[OpenAI] Responses API - Model: ${deployment}, Reasoning: ${isReasoning}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': this.apiKey
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[OpenAI] Error ${response.status}:`, errorText);

            // Handle context_length_exceeded specifically
            if (errorText.includes('context_length_exceeded')) {
                const error = new Error('Context length exceeded');
                error.statusCode = 400;
                error.code = 'context_length_exceeded';
                error.details = errorText;
                throw error;
            }

            const error = new Error(`Azure OpenAI API error: ${response.status}`);
            error.statusCode = response.status;
            error.details = errorText;
            throw error;
        }

        const data = await response.json();

        return {
            output: data.output || [],
            usage: data.usage || {}
        };
    }

    /**
     * Call Responses API with retry logic for context_length_exceeded
     */
    async callResponsesWithRetry(input, options = {}) {
        try {
            return await this.callResponses(input, options);
        } catch (error) {
            // Retry with smaller token limit if context exceeded
            if (error.code === 'context_length_exceeded' && options.maxOutputTokens > 4096) {
                console.log('[OpenAI] Context exceeded, retrying with 4096 tokens...');
                return await this.callResponses(input, {
                    ...options,
                    maxOutputTokens: 4096
                });
            }
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new OpenAIProxy();
