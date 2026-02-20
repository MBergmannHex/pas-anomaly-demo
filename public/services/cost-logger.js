// ─────────────────────────────────────────────────────────────────
// Cost Logger — Azure OpenAI inference cost tracking
// To disable all cost output: set COST_LOGGING_ENABLED = false
// ─────────────────────────────────────────────────────────────────

const COST_LOGGING_ENABLED = true;

// Pricing per 1M tokens: [input $, output $, cached input $]
// Source: OpenAI list pricing — update if your Azure contract differs
// Cached input applies automatically when the prompt prefix is reused (>1024 tokens).
// The D&R system prompt (~3400 tokens) is identical for every batch, so batches 2-N
// get the cache discount on those tokens automatically — no code changes needed.
const MODEL_PRICING = {
    // GPT-5 family
    'gpt-5.2':          [1.75, 14.00,  0.44],  // cached ~75% off (estimated)
    'gpt-5':            [1.75, 14.00,  0.44],  // Alias

    // GPT-4.1 family  (cached = 75% off input)
    'gpt-4.1-nano':     [0.02,  0.15,  0.005],
    'gpt-4.1-mini':     [0.40,  1.60,  0.10],
    'gpt-4.1':          [2.00,  8.00,  0.50],

    // GPT-4o family  (cached = 50% off input)
    'gpt-4o-mini':      [0.15,  0.60,  0.075],
    'gpt-4o':           [2.50, 10.00,  1.25],

    // o-series reasoning models  (cached = 75% off input)
    'o4-mini':          [1.10,  4.40,  0.275],
    'o3-mini':          [1.10,  4.40,  0.275],
    'o3':               [10.00, 40.00, 2.50],
    'o1':               [15.00, 60.00, 3.75],
};

window.costLogger = {
    _session: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, saved: 0, calls: [] },

    _getPrice(deployment) {
        if (!deployment) return [0, 0, 0];
        const d = deployment.toLowerCase();
        // Match longest key first to avoid 'o3' matching inside 'o3-mini'
        const key = Object.keys(MODEL_PRICING)
            .sort((a, b) => b.length - a.length)
            .find(k => d.includes(k));
        return key ? MODEL_PRICING[key] : [0, 0, 0];
    },

    _normalizeUsage(usage) {
        // Chat Completions API:  prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens
        // Responses API:         input_tokens  / output_tokens    / input_tokens_details.cached_tokens
        return {
            input:  usage.prompt_tokens   ?? usage.input_tokens   ?? 0,
            output: usage.completion_tokens ?? usage.output_tokens ?? 0,
            cached: usage.prompt_tokens_details?.cached_tokens
                 ?? usage.input_tokens_details?.cached_tokens
                 ?? 0
        };
    },

    log(step, deployment, usage) {
        if (!COST_LOGGING_ENABLED || !usage) return;
        const { input, output, cached } = this._normalizeUsage(usage);
        const [inPrice, outPrice, cachedPrice] = this._getPrice(deployment);
        const knownPrice = inPrice > 0 || outPrice > 0;

        // Actual cost: cached tokens at discounted rate, rest at full rate
        const regularInput = input - cached;
        const cost = ((regularInput * inPrice) + (cached * cachedPrice) + (output * outPrice)) / 1_000_000;
        const savedVsNoCaching = (cached * (inPrice - cachedPrice)) / 1_000_000;

        this._session.inputTokens += input;
        this._session.outputTokens += output;
        this._session.cachedTokens += cached;
        this._session.cost += cost;
        this._session.saved += savedVsNoCaching;
        this._session.calls.push({ step, deployment: deployment || 'unknown', input, output, cached, cost, savedVsNoCaching });

        const cacheNote = cached > 0 ? ` | cached: ${cached.toLocaleString()} tok (saved ~$${savedVsNoCaching.toFixed(4)})` : '';
        console.log(
            `%c[Cost] ${step}`,
            'color: #7C3AED; font-weight: bold',
            ` | model: ${deployment || 'unknown'}`,
            ` | in: ${input.toLocaleString()} tok`,
            `| out: ${output.toLocaleString()} tok`,
            `| ~$${knownPrice ? cost.toFixed(4) : '?.????'}`,
            cacheNote
        );
    },

    summary() {
        if (!COST_LOGGING_ENABLED || this._session.calls.length === 0) return;
        const s = this._session;
        const allKnown = s.calls.every(c => { const [ip] = this._getPrice(c.deployment); return ip > 0; });

        console.log('%c[Cost] ── Batch Session Summary ──', 'color: #059669; font-weight: bold; font-size: 13px');
        console.table(s.calls.map(c => ({
            'Step':              c.step,
            'Model':             c.deployment,
            'Input tokens':      c.input.toLocaleString(),
            'Cached tokens':     c.cached > 0 ? c.cached.toLocaleString() : '—',
            'Output tokens':     c.output.toLocaleString(),
            'Est. cost ($)':     c.cost.toFixed(4),
            'Cache saved ($)':   c.savedVsNoCaching > 0 ? c.savedVsNoCaching.toFixed(4) : '—'
        })));
        const savedNote = s.saved > 0 ? ` | cache saved: ~$${s.saved.toFixed(4)}` : '';
        console.log(
            `%c[Cost] Total: ${s.inputTokens.toLocaleString()} in (${s.cachedTokens.toLocaleString()} cached)` +
            ` + ${s.outputTokens.toLocaleString()} out` +
            ` | Est. total: $${s.cost.toFixed(4)}${savedNote}` +
            (allKnown ? '' : '  ⚠ Some models unknown — add pricing to MODEL_PRICING in cost-logger.js'),
            'color: #059669; font-weight: bold'
        );
    },

    reset() {
        if (!COST_LOGGING_ENABLED) return;
        this._session = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0, saved: 0, calls: [] };
        console.log('%c[Cost] Session reset — tracking new batch', 'color: #6B7280; font-style: italic');
    }
};
