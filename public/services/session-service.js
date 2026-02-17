// Global namespace for session service
window.sessionService = {
    // Configurable session filtering limits
    SESSION_FILTERS: {
        MIN_EVENTS: 4,           // Minimum number of events in a session to be saved
        MAX_EVENTS: 400,         // Maximum number of events in a session
        MAX_DURATION_HOURS: 2,   // Maximum session duration in hours
        SESSION_TIMEOUT_MINUTES: 5  // Timeout (gap) between sessions in minutes
    },

    /**
     * Extracts sessions from event data based on time window per UNIT.
     * REFINED LOGIC: Uses a Map to track multiple active units simultaneously.
     * This ensures that interleaved events (e.g., Unit A -> Unit B -> Unit A) do not 
     * prematurely close the session for Unit A.
     * * @param {Array} data The sorted event data.
     * @returns {Array} An array of session objects.
     */
    extractSessions: function(data) {
        const sessions = [];
        const SESSION_TIMEOUT = this.SESSION_FILTERS.SESSION_TIMEOUT_MINUTES * 60 * 1000; 
        const MAX_DURATION = this.SESSION_FILTERS.MAX_DURATION_HOURS * 60 * 60 * 1000;

        // 1. Sort data by timestamp first to ensure linear time processing
        const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);

        // 2. State tracking: Map of Active Sessions
        // Key = Unit Name (e.g., "FCCU", "BW"), Value = Current Session Object
        const activeSessions = {};

        for (let i = 0; i < sortedData.length; i++) {
            const event = sortedData[i];
            const unitKey = event.unit || 'Unknown';
            
            // Retrieve the specific active session for THIS unit
            let unitSession = activeSessions[unitKey];

            // Check if we need to close the EXISTING session for this unit
            if (unitSession) {
                const timeSinceLastEvent = event.timestamp - unitSession.endTime;
                const duration = event.timestamp - unitSession.startTime;

                // Close session if gap is too large OR max duration exceeded
                if (timeSinceLastEvent > SESSION_TIMEOUT || duration > MAX_DURATION) {
                    this._finalizeSession(unitSession, sessions);
                    delete activeSessions[unitKey]; // Remove from map
                    unitSession = null; // Signal to create a new one
                }
            }

            // Start a new session if none exists for this unit
            if (!unitSession) {
                unitSession = {
                    // Temporary ID, will be re-indexed at the end
                    id: sessions.length + Object.keys(activeSessions).length, 
                    unit: unitKey,
                    events: [],
                    startTime: event.timestamp,
                    endTime: event.timestamp,
                    alarms: 0,
                    actions: 0,
                    units: new Set([unitKey]), // Kept for compatibility structure
                    tags: new Set(),
                    descriptions: new Map(),
                    eventDescriptions: []
                };
                activeSessions[unitKey] = unitSession;
            }

            // Add event to the correct unit's session
            unitSession.events.push(event);
            unitSession.endTime = event.timestamp;
            
            // Update counters
            if (event.isAlarm) unitSession.alarms++;
            if (event.isChange) unitSession.actions++;
            unitSession.tags.add(event.tag);
            
            // Capture descriptions
            if (event.Desc1 || event.Desc2) {
                unitSession.descriptions.set(event.tag, {
                    desc1: event.Desc1 || '',
                    desc2: event.Desc2 || ''
                });
                unitSession.eventDescriptions.push({
                    tag: event.tag,
                    desc1: event.Desc1 || '',
                    desc2: event.Desc2 || '',
                    timestamp: event.timestamp,
                    isAlarm: event.isAlarm
                });
            }
        }

        // 3. Finalize all remaining open sessions in the map
        Object.values(activeSessions).forEach(session => {
            this._finalizeSession(session, sessions);
        });

        // 4. Sort final list by start time and assign sequential IDs
        sessions.sort((a, b) => a.startTime - b.startTime);
        sessions.forEach((session, index) => {
            session.id = index;
        });

        console.log(`Session extraction complete. 
            - Logic: Concurrent Unit Tracking
            - Filters: Min ${this.SESSION_FILTERS.MIN_EVENTS} events, >${this.SESSION_FILTERS.SESSION_TIMEOUT_MINUTES}m gap
            - Valid sessions found: ${sessions.length}`);

        return sessions;
    },

    /**
     * Helper: Finalizes a session object, calculates metrics, applies filters, 
     * and pushes valid sessions to the main list.
     */
    _finalizeSession: function(session, sessionsList) {
        const sessionDuration = session.endTime - session.startTime;
        const eventCount = session.events.length;
        
        // Filter Logic: Only keep sessions that meet the criteria
        if (eventCount >= this.SESSION_FILTERS.MIN_EVENTS && 
            eventCount <= this.SESSION_FILTERS.MAX_EVENTS) {
            
            // Convert Sets to Arrays for final storage
            session.units = Array.from(session.units);
            session.tags = Array.from(session.tags);
            session.duration = sessionDuration;
            
            // Calculate frequency (Alarms per 10 mins)
            const durationMinutes = sessionDuration / (60 * 1000);
            session.alarmFrequency = durationMinutes > 0 ? (session.alarms / durationMinutes) * 10 : 0;
            
            // Convert descriptions Map to object
            session.tagDescriptions = Object.fromEntries(session.descriptions);

            sessionsList.push(session);
        } else {
            // Optional: Log filtered out sessions for debugging
            // console.log(`Filtered session: ${eventCount} events (Unit: ${session.unit})`);
        }
    },

    /**
     * Updates session filter configuration.
     * @param {Object} newFilters Object with new filter values
     */
    updateSessionFilters: function(newFilters) {
        this.SESSION_FILTERS = { ...this.SESSION_FILTERS, ...newFilters };
        console.log('Session filters updated:', this.SESSION_FILTERS);
    },

    /**
     * Gets unit-specific statistics from sessions.
     * @param {Array} sessions All sessions
     * @returns {Object} Statistics per unit
     */
    getUnitStatistics: function(sessions) {
        const unitStats = new Map();
        
        sessions.forEach(session => {
            const unit = session.unit;
            if (!unitStats.has(unit)) {
                unitStats.set(unit, {
                    unit: unit,
                    sessionCount: 0,
                    totalEvents: 0,
                    totalAlarms: 0,
                    totalActions: 0,
                    avgSessionDuration: 0,
                    avgAlarmFrequency: 0,
                    totalDuration: 0
                });
            }
            
            const stats = unitStats.get(unit);
            stats.sessionCount++;
            stats.totalEvents += session.events.length;
            stats.totalAlarms += session.alarms;
            stats.totalActions += session.actions;
            stats.totalDuration += session.duration;
            stats.avgAlarmFrequency = (stats.avgAlarmFrequency * (stats.sessionCount - 1) + session.alarmFrequency) / stats.sessionCount;
        });
        
        // Calculate average session duration
        unitStats.forEach(stats => {
            stats.avgSessionDuration = stats.sessionCount > 0 ? stats.totalDuration / stats.sessionCount : 0;
        });
        
        return Array.from(unitStats.values());
    },

    /**
     * Finds similar sessions based on various criteria.
     * @param {Object} targetSession The session to find similarities for
     * @param {Array} allSessions All available sessions
     * @param {Object} options Search options
     * @returns {Array} Array of similar sessions with scores
     */
    findSimilarSessions: function(targetSession, allSessions, options = {}) {
        const {
            maxResults = 10,
            minSimilarity = 0.3,
            includeDescriptions = false
        } = options;

        const targetTags = new Set(targetSession.tags);
        const targetAlarms = targetSession.events.filter(e => e.isAlarm).map(e => e.tag);
        const targetDescriptions = targetSession.tagDescriptions || {};

        const similarities = allSessions
            .filter(session => session.id !== targetSession.id)
            .map(session => {
                let score = 0;
                const matches = {};

                // Tag overlap
                const sessionTags = new Set(session.tags);
                const commonTags = new Set([...targetTags].filter(tag => sessionTags.has(tag)));
                const tagScore = commonTags.size / Math.max(targetTags.size, sessionTags.size);
                score += tagScore * 0.4;
                matches.tags = {
                    common: Array.from(commonTags),
                    score: tagScore
                };

                // Unit match
                if (session.unit === targetSession.unit) {
                    score += 0.2;
                    matches.unit = true;
                }

                // Alarm pattern similarity
                const sessionAlarms = session.events.filter(e => e.isAlarm).map(e => e.tag);
                const commonAlarms = targetAlarms.filter(tag => sessionAlarms.includes(tag));
                if (targetAlarms.length > 0 && sessionAlarms.length > 0) {
                    const patternScore = commonAlarms.length / Math.max(targetAlarms.length, sessionAlarms.length);
                    score += patternScore * 0.5;
                    matches.alarmPattern = {
                        common: commonAlarms,
                        score: patternScore
                    };
                }

                // Description similarity
                if (includeDescriptions) {
                    const sessionDescriptions = session.tagDescriptions || {};
                    let descMatches = 0;
                    let totalDescs = 0;

                    Object.keys(targetDescriptions).forEach(tag => {
                        if (sessionDescriptions[tag]) {
                            totalDescs++;
                            const targetDesc = targetDescriptions[tag];
                            const sessionDesc = sessionDescriptions[tag];
                            
                            if (targetDesc.desc1 === sessionDesc.desc1 || targetDesc.desc2 === sessionDesc.desc2) {
                                descMatches++;
                            }
                        }
                    });

                    if (totalDescs > 0) {
                        const descScore = descMatches / totalDescs;
                        score += descScore * 0.3;
                        matches.descriptions = {
                            matches: descMatches,
                            total: totalDescs,
                            score: descScore
                        };
                    }
                }

                return {
                    session,
                    score,
                    matches
                };
            })
            .filter(result => result.score >= minSimilarity)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults);

        return similarities;
    },

    /**
     * Get alarm context for chatbot responses.
     * @param {string} alarmTag The alarm tag to get context for
     * @param {Array} sessions All sessions
     * @returns {Object} Context information about the alarm
     */
    getAlarmContext: function(alarmTag, sessions) {
        const context = {
            tag: alarmTag,
            occurrences: 0,
            descriptions: new Set(),
            commonSequences: [],
            typicalResponses: [],
            units: new Set(),
            avgResolutionTime: 0,
            resolutionTimes: []
        };

        sessions.forEach(session => {
            const alarmIndex = session.events.findIndex(e => e.tag === alarmTag && e.isAlarm);
            if (alarmIndex !== -1) {
                context.occurrences++;
                context.units.add(session.unit);

                // Get descriptions
                if (session.tagDescriptions[alarmTag]) {
                    const desc = session.tagDescriptions[alarmTag];
                    if (desc.desc1) context.descriptions.add(desc.desc1);
                    if (desc.desc2) context.descriptions.add(desc.desc2);
                }

                // Analyze what happens after this alarm
                const subsequentEvents = session.events.slice(alarmIndex + 1, alarmIndex + 5);
                const sequence = subsequentEvents.map(e => ({
                    tag: e.tag,
                    type: e.isAlarm ? 'alarm' : 'action',
                    delay: e.timestamp - session.events[alarmIndex].timestamp
                }));

                if (sequence.length > 0) {
                    context.commonSequences.push(sequence);
                }

                // Find operator responses
                const firstAction = session.events.slice(alarmIndex + 1).find(e => e.isChange);
                if (firstAction) {
                    const responseTime = firstAction.timestamp - session.events[alarmIndex].timestamp;
                    context.resolutionTimes.push(responseTime);
                    context.typicalResponses.push({
                        action: firstAction.tag,
                        responseTime,
                        description: session.tagDescriptions[firstAction.tag]
                    });
                }
            }
        });

        // Calculate average resolution time
        if (context.resolutionTimes.length > 0) {
            context.avgResolutionTime = context.resolutionTimes.reduce((a, b) => a + b, 0) / context.resolutionTimes.length;
        }

        // Convert sets to arrays
        context.descriptions = Array.from(context.descriptions);
        context.units = Array.from(context.units);

        // Find most common sequences
        const sequencePatterns = {};
        context.commonSequences.forEach(seq => {
            const pattern = seq.map(e => e.tag).join(' → ');
            sequencePatterns[pattern] = (sequencePatterns[pattern] || 0) + 1;
        });
        
        context.mostCommonPatterns = Object.entries(sequencePatterns)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([pattern, count]) => ({ pattern, count }));

        return context;
    },

    /**
     * Get session details for chatbot analysis.
     * @param {number} sessionId The session ID to analyze
     * @param {Array} sessions All sessions
     * @returns {Object|null} Session details or null if not found
     */
    getSessionDetails: function(sessionId, sessions) {
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return null;

        // Analyze alarm patterns
        const alarmClusters = [];
        let currentCluster = null;
        
        session.events.forEach((event, idx) => {
            if (event.isAlarm) {
                if (!currentCluster) {
                    currentCluster = {
                        alarms: [event],
                        startTime: event.timestamp,
                        endTime: event.timestamp,
                        actions: []
                    };
                } else if (event.timestamp - currentCluster.endTime < 60000) { // Within 1 minute
                    currentCluster.alarms.push(event);
                    currentCluster.endTime = event.timestamp;
                } else {
                    alarmClusters.push(currentCluster);
                    currentCluster = {
                        alarms: [event],
                        startTime: event.timestamp,
                        endTime: event.timestamp,
                        actions: []
                    };
                }
            } else if (event.isChange && currentCluster) {
                currentCluster.actions.push(event);
            }
        });
        
        if (currentCluster) {
            alarmClusters.push(currentCluster);
        }

        // Calculate metrics
        const operatorResponseTimes = [];
        for (let i = 0; i < session.events.length - 1; i++) {
            if (session.events[i].isAlarm) {
                for (let j = i + 1; j < session.events.length; j++) {
                    if (session.events[j].isChange) {
                        operatorResponseTimes.push(session.events[j].timestamp - session.events[i].timestamp);
                        break;
                    }
                }
            }
        }

        return {
            ...session,
            alarmClusters,
            avgOperatorResponseTime: operatorResponseTimes.length > 0 ? 
                operatorResponseTimes.reduce((a, b) => a + b, 0) / operatorResponseTimes.length : null,
            hasAlarmFlood: session.alarmFrequency > 10,
            operatorEffectiveness: session.alarms > 0 ? session.actions / session.alarms : 0
        };
    }
};