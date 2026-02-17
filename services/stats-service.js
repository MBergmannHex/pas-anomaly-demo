// Global namespace for statistics service
window.statsService = {
    /**
     * Helper function to create a unique ID for an event
     * This distinguishes between Alarms and Changes with the same tag
     */
    _getUniqueEventId: function (event) {
        if (!event || !event.tag) return 'UNKNOWN';
        if (event.isAlarm) return `[A] ${event.tag}`;
        if (event.isChange) return `[C] ${event.tag}`;
        // Fallback for events that are neither
        return `[E] ${event.tag}`;
    },

    /**
     * Extracts a priority level ('high', 'medium', 'low') from a priority string.
     * @param {string} priorityStr The priority string (e.g., "PRIORITY(250)").
     * @returns {string} The priority level.
     */
    extractPriority: function (priorityStr) {
        if (!priorityStr) return 'low';
        const priorityNum = parseInt(priorityStr.match(/\d+/)?.[0] || '1000');
        if (priorityNum <= 250) return 'high';
        if (priorityNum <= 750) return 'medium';
        return 'low';
    },

    /**
     * Calculates a wide range of statistics from the data.
     * @param {Array} data The complete event data.
     * @param {Array} sessions The extracted sessions.
     * @returns {object} An object containing all calculated statistics.
     */
    calculateStatistics: function (data, sessions) {
        if (!data || data.length === 0) return null;

        const alarms = data.filter(d => d.isAlarm);
        const actions = data.filter(d => d.isChange);

        const totalDurationHours = (data[data.length - 1].timestamp - data[0].timestamp) / (1000 * 60 * 60);

        // ISA 18.2 KPIs
        const avgAlarmRate = totalDurationHours > 0 ? alarms.length / (totalDurationHours * 6) : 0;

        // Alarm Flood Detection
        const ALARM_FLOOD_THRESHOLD = 10;
        const ALARM_FLOOD_WINDOW = 10 * 60 * 1000;
        let timeInFlood = 0;
        let floodPeriods = 0;

        for (let i = 0; i < alarms.length; i++) {
            let j = i;
            while (j < alarms.length && alarms[j].timestamp - alarms[i].timestamp < ALARM_FLOOD_WINDOW) {
                j++;
            }
            if (j - i > ALARM_FLOOD_THRESHOLD) {
                timeInFlood += alarms[j - 1].timestamp - alarms[i].timestamp;
                floodPeriods++;
                i = j - 1; // Skip ahead
            }
        }

        const totalTime = data[data.length - 1].timestamp - data[0].timestamp;
        const percentTimeInFlood = totalTime > 0 ? (timeInFlood / totalTime) * 100 : 0;

        // Chattering Alarms
        const CHATTER_WINDOW = 1 * 60 * 1000;
        const chatterCounts = {};
        for (let i = 0; i < alarms.length - 1; i++) {
            if (alarms[i].tag === alarms[i + 1].tag &&
                (alarms[i + 1].timestamp - alarms[i].timestamp) < CHATTER_WINDOW) {
                chatterCounts[alarms[i].tag] = (chatterCounts[alarms[i].tag] || 1) + 1;
            }
        }
        const topChatteringAlarms = Object.entries(chatterCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // General Statistics
        // **FIX:** Use the unique event ID
        const tagFrequency = _.countBy(data, event => this._getUniqueEventId(event));
        const topTags = Object.entries(tagFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        // Pattern detection - find alarm to action patterns within a time window
        const patterns = {};
        const sessionsToAnalyze = sessions.slice(0, 200); // Analyze more sessions
        sessionsToAnalyze.forEach(session => {
            for (let i = 0; i < session.events.length; i++) {
                const current = session.events[i];

                if (current.isAlarm) {
                    // Look for the next operator action within the next 5 events
                    for (let j = i + 1; j < Math.min(i + 6, session.events.length); j++) {
                        const next = session.events[j];

                        if (next.isChange) {
                            // **FIX:** Use unique IDs for the pattern
                            const currentId = this._getUniqueEventId(current);
                            const nextId = this._getUniqueEventId(next);
                            const pattern = `${currentId} → ${nextId}`;
                            patterns[pattern] = (patterns[pattern] || 0) + 1;
                            break; // Found the action, stop looking
                        }
                    }
                }
            }
        });

        // If no patterns found, look for alarm sequences instead
        if (Object.keys(patterns).length === 0) {
            sessionsToAnalyze.forEach(session => {
                for (let i = 0; i < session.events.length - 1; i++) {
                    const current = session.events[i];
                    const next = session.events[i + 1];

                    if (current.isAlarm && next.isAlarm) {
                        // **FIX:** Use unique IDs for the pattern
                        const currentId = this._getUniqueEventId(current);
                        const nextId = this._getUniqueEventId(next);
                        const pattern = `${currentId} → ${nextId} (alarm sequence)`;
                        patterns[pattern] = (patterns[pattern] || 0) + 1;
                    }
                }
            });
        }

        const topPatterns = Object.entries(patterns)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            // **FIX:** Format the pattern for display, removing the [A] and [C]
            .map(([pattern, count]) => {
                const formattedPattern = pattern
                    .replace(/\[A\] /g, '⚠️ ')
                    .replace(/\[C\] /g, '✓ ')
                    .replace(/\[E\] /g, '');
                return [formattedPattern, count];
            });

        const hourlyDistribution = new Array(24).fill(0);
        data.forEach(event => {
            const hour = moment(event.timestamp).hour();
            hourlyDistribution[hour]++;
        });

        // **FIX:** Use unique ID for starting events, filtering ONLY for alarms
        const startingEvents = _.countBy(
            sessions
                .filter(s => s.events[0] && s.events[0].isAlarm) // Only consider sessions starting with an alarm
                .map(s => this._getUniqueEventId(s.events[0]))
        );
        const topStartingEvents = Object.entries(startingEvents)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            // **FIX:** Format the labels for display
            .map(([uniqueId, count]) => {
                const formattedId = uniqueId
                    .replace(/\[A\] /g, '⚠️ ')
                    .replace(/\[C\] /g, '✓ ')
                    .replace(/\[E\] /g, '');
                return [formattedId, count];
            });

        return {
            totalEvents: data.length,
            totalAlarms: alarms.length,
            totalActions: actions.length,
            totalSessions: sessions.length,
            avgSessionDuration: _.mean(sessions.map(s => s.duration)),
            avgAlarmsPerSession: _.mean(sessions.map(s => s.alarms)),
            avgActionsPerSession: _.mean(sessions.map(s => s.actions)),
            topTags,
            topPatterns,
            hourlyDistribution,
            priorityDistribution: _.countBy(alarms, 'priority'),
            topStartingEvents,
            avgAlarmRate,
            percentTimeInFlood,
            topChatteringAlarms
        };
    }
};