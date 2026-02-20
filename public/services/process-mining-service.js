// Process Mining Service - thin API wrapper
// Algorithms are secured server-side at /api/analysis/process-mine
window.processMiningService = {

    async _call(operation, sessions, extra = {}) {
        const response = await fetch('/api/analysis/process-mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessions, operation, ...extra })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Process mining failed (${response.status})`);
        }
        return response.json();
    },

    buildProcessGraph: async function(sessions, filters = {}) {
        return this._call('buildProcessGraph', sessions, { filters });
    },

    createDFG: async function(sessions) {
        return this._call('createDFG', sessions);
    },

    discoverProcessVariants: async function(sessions) {
        return this._call('discoverProcessVariants', sessions);
    }
};
