// Session Service - thin API wrapper
// Algorithms are secured server-side at /api/analysis/extract-sessions
window.sessionService = {
    _lastUnitStatistics: null,

    extractSessions: async function(data) {
        const response = await fetch('/api/analysis/extract-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Session extraction failed (${response.status})`);
        }
        const result = await response.json();
        this._lastUnitStatistics = result.unitStatistics;
        return result.sessions;
    },

    // Unit statistics are returned alongside sessions in the same API call.
    // Call extractSessions first, then this returns the cached result.
    getUnitStatistics: function(sessions) {
        return this._lastUnitStatistics || [];
    }
};
