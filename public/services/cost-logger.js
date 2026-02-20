// ─────────────────────────────────────────────────────────────────
// Cost Logger — Azure OpenAI inference cost tracking
// To disable all cost output: set COST_LOGGING_ENABLED = false
// ─────────────────────────────────────────────────────────────────

const COST_LOGGING_ENABLED = true;

// Pricing per 1M tokens: [input $, output $]
// Source: Azure OpenAI / OpenAI list pricing (update if your contract differs)
const MODEL_PRICING = {
    'gpt-4.1':      [2.00,  8.00],
    'gpt-4.1-mini': [0.40,  1.60],
    'gpt-4o':       [2.50, 10.00],
    'gpt-4o-mini':  [0.15,  0.60],
    'o1':           [15.00, 60.00],
    'o3':           [10.00, 40.00],
    'o3-mini':      [1.10,  4.40],
    'o4-mini':      [1.10,  4.40],
};

window.costLogger = {
    _session: { inputTokens: 0, outputTokens: 0, cost: 0, calls: [] },

    _getPrice(deployment) {
        if (!deployment) return [0, 0];
        const d = deployment.toLowerCase();
        // Match longest key first to avoid 'o3' matching inside 'o3-mini'
        const key = Object.keys(MODEL_PRICING)
            .sort((a, b) => b.length - a.length)
            .find(k => d.includes(k));
        return key ? MODEL_PRICING[key] : [0, 0];
    },

    _normalizeUsage(usage) {
        // Chat Completions API:  prompt_tokens / completion_tokens
        // Responses API:         input_tokens  / output_tokens
        return {
            input:  usage.prompt_tokens  ?? usage.input_tokens  ?? 0,
            output: usage.completion_tokens ?? usage.output_tokens ?? 0
        };
    },

    log(step, deployment, usage) {
        if (!COST_LOGGING_ENABLED || !usage) return;
        const { input, output } = this._normalizeUsage(usage);
        const [inPrice, outPrice] = this._getPrice(deployment);
        const cost = (input * inPrice + output * outPrice) / 1_000_000;
        const knownPrice = inPrice > 0 || outPrice > 0;

        this._session.inputTokens += input;
        this._session.outputTokens += output;
        this._session.cost += cost;
        this._session.calls.push({ step, deployment: deployment || 'unknown', input, output, cost });

        console.log(
            `%c[Cost] ${step}`,
            'color: #7C3AED; font-weight: bold',
            ` | model: ${deployment || 'unknown'}`,
            ` | in: ${input.toLocaleString()} tok`,
            `| out: ${output.toLocaleString()} tok`,
            `| ~$${knownPrice ? cost.toFixed(4) : '?.????'}`
        );
    },

    summary() {
        if (!COST_LOGGING_ENABLED || this._session.calls.length === 0) return;
        const s = this._session;
        const allKnown = s.calls.every(c => { const [ip, op] = this._getPrice(c.deployment); return ip > 0 || op > 0; });

        console.log('%c[Cost] ── Batch Session Summary ──', 'color: #059669; font-weight: bold; font-size: 13px');
        console.table(s.calls.map(c => ({
            'Step':            c.step,
            'Model':           c.deployment,
            'Input tokens':    c.input.toLocaleString(),
            'Output tokens':   c.output.toLocaleString(),
            'Est. cost ($)':   c.cost.toFixed(4)
        })));
        console.log(
            `%c[Cost] Total: ${s.inputTokens.toLocaleString()} in + ${s.outputTokens.toLocaleString()} out` +
            ` | Est. total: $${s.cost.toFixed(4)}` +
            (allKnown ? '' : '  ⚠ Some models unknown — add pricing to MODEL_PRICING in cost-logger.js'),
            'color: #059669; font-weight: bold'
        );
    },

    reset() {
        if (!COST_LOGGING_ENABLED) return;
        this._session = { inputTokens: 0, outputTokens: 0, cost: 0, calls: [] };
        console.log('%c[Cost] Session reset — tracking new batch', 'color: #6B7280; font-style: italic');
    }
};
