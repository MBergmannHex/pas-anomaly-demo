// Rationalization Service - thin API wrapper
// Algorithms are secured server-side at /api/analysis/nuisance-alarms
window.rationalizationService = {

    analyzeNuisanceAlarms: async function(data, validSessions, allSessions) {
        const response = await fetch('/api/analysis/nuisance-alarms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data, validSessions, allSessions })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Nuisance analysis failed (${response.status})`);
        }
        return response.json();
    },

    runAutonomousRationalization: async function(philosophyRules, safetyContext, rawData, onProgress) {
        if (onProgress) onProgress(10, 'Sending data to server...');
        const response = await fetch('/api/analysis/autonomous-rationalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ philosophyRules, safetyContext, rawData })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Rationalization failed (${response.status})`);
        }
        const result = await response.json();
        if (onProgress) onProgress(100, 'Complete');
        return result;
    }
};
