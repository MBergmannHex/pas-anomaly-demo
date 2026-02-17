// Global namespace for rationalization service - ISA 18.2 / IEC 62682 / EEMUA 191 compliant
window.rationalizationService = {

    detectSequentialPatterns: function (sessions) {
        const patternMap = new Map();
        const MIN_PATTERN_LENGTH = 2;
        const MAX_PATTERN_LENGTH = 5;

        sessions.forEach(session => {
            const alarms = session.events.filter(e => e.isAlarm);
            for (let len = MIN_PATTERN_LENGTH; len <= MAX_PATTERN_LENGTH; len++) {
                for (let i = 0; i <= alarms.length - len; i++) {
                    const pattern = alarms.slice(i, i + len).map(a => a.tag).join('-');
                    patternMap.set(pattern, (patternMap.get(pattern) || 0) + 1);
                }
            }
        });

        return Array.from(patternMap.entries())
            .filter(([pattern, count]) => count > 3)
            .map(([pattern, count]) => ({ sequence: pattern.split('-'), count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);
    },

    /**
     * ISA 18.2 / IEC 62682 / EEMUA 191 compliant chattering detection
     * Chattering: alarm activates 3+ times within 60 seconds
     */
    detectChatteringForAlarm: function (alarmEvents) {
        if (alarmEvents.length < 3) return 0;

        const CHATTER_WINDOW = 60 * 1000;
        const CHATTER_THRESHOLD = 3;
        let chatterCount = 0;

        for (let i = 0; i < alarmEvents.length - (CHATTER_THRESHOLD - 1); i++) {
            let activationsInWindow = 1;
            const windowStart = alarmEvents[i].timestamp;

            for (let j = i + 1; j < alarmEvents.length; j++) {
                const timeDiff = alarmEvents[j].timestamp - windowStart;

                if (timeDiff <= CHATTER_WINDOW) {
                    activationsInWindow++;
                } else {
                    break;
                }
            }

            if (activationsInWindow >= CHATTER_THRESHOLD) {
                chatterCount++;
                i += (activationsInWindow - 1);
            }
        }

        return chatterCount;
    },

    /**
     * Autonomous Rationalization Engine (High-Fidelity)
     * @param {Object} philosophyRules - Extracted from PDF
     * @param {Array} safetyContext - Extracted from HAZOP (List of objects with tag, causes[], impact_severity)
     * @param {Array} rawData - Raw CSV events
     * @param {Function} onProgress - Callback(percent, message)
     */
    runAutonomousRationalization: async function (philosophyRules, safetyContext, rawData, onProgress) {
        console.log("Starting Autonomous Rationalization (High-Fidelity)...");

        // 1. Calculate Statistics
        onProgress(10, "Calculating Alarm Metrics...");
        const uniqueTags = [...new Set(rawData.filter(d => d.isAlarm).map(d => d.tag))];
        const stats = {}; // Map tag -> { avgFreq, chatterRate, etc }

        // Helper to calculate stats per tag
        uniqueTags.forEach(tag => {
            const events = rawData.filter(d => d.tag === tag && d.isAlarm);
            if (events.length === 0) return;

            const totalTimeHours = (rawData[rawData.length - 1].timestamp - rawData[0].timestamp) / (1000 * 3600);

            stats[tag] = {
                count: events.length,
                avgFreqPerHour: events.length / (totalTimeHours || 1),
                chatterCount: this.detectChatteringForAlarm(events),
                lastActive: events[events.length - 1].timestamp
            };
        });

        // 2. Apply Rules & Build Relational Schema
        onProgress(30, "Applying Philosophy Rules & Building Schema...");
        const rationalizedData = [];
        let priorityChanges = 0;
        let rationalizedCount = 0;

        for (let i = 0; i < uniqueTags.length; i++) {
            const tag = uniqueTags[i];
            const tagStats = stats[tag];
            if (!tagStats) continue;

            // Find safety info for this tag (could be multiple entries, but we expect one consolidated object from parser)
            // The parser returns a list of objects, we need to find the one matching the tag
            const safetyInfo = safetyContext.find(s => s.causes && s.causes.some(c => c.tag === tag)) || { causes: [], impact_severity: {} };

            // Filter causes specific to this tag if the parser returned a grouped object
            const tagCauses = safetyInfo.causes ? safetyInfo.causes.filter(c => c.tag === tag) : [];

            // Determine Priority based on Impact Matrix
            let approvedPriority = 3; // Default Low
            let priorityReason = "Default (Low Impact)";

            const impact = safetyInfo.impact_severity || {};
            const safetyLevel = (impact.safety || 'None').toLowerCase();
            const envLevel = (impact.environment || 'None').toLowerCase();
            const costLevel = (impact.financial || 'None').toLowerCase();

            if (safetyLevel === 'high' || envLevel === 'high' || costLevel === 'high') {
                approvedPriority = 1;
                priorityReason = "Critical Impact (Safety/Env/Cost)";
            } else if (safetyLevel === 'medium' || envLevel === 'medium' || costLevel === 'medium') {
                approvedPriority = 2;
                priorityReason = "Medium Impact";
            } else {
                approvedPriority = 3;
                priorityReason = "Low Impact";
            }

            // Check Nuisance Rules
            let recommendation = "Keep";
            let onDelay = 0;
            let offDelay = 0;

            if (tagStats.chatterCount > (philosophyRules.thresholds?.chattering_count || 3)) {
                recommendation = "Modify";
                onDelay = philosophyRules.timers?.min_on_delay_sec || 2;
                priorityReason += "; High Chattering detected";
            }

            const staleHours = philosophyRules.thresholds?.stale_alarm_hours || 24;
            const hoursInactive = (new Date() - tagStats.lastActive) / (1000 * 3600);
            if (hoursInactive > staleHours) {
                recommendation = "Shelve";
                priorityReason += "; Stale Alarm";
            }

            // Track changes
            const originalPriorityStr = rawData.find(d => d.tag === tag)?.priority || "Low";
            // Map string priority to number for comparison (simplified)
            let originalPriority = 3;
            if (originalPriorityStr.toLowerCase().includes('high') || originalPriorityStr.includes('1')) originalPriority = 1;
            if (originalPriorityStr.toLowerCase().includes('med') || originalPriorityStr.includes('2')) originalPriority = 2;

            if (approvedPriority !== originalPriority) priorityChanges++;
            rationalizedCount++;

            // Construct High-Fidelity MADb Record
            rationalizedData.push({
                // Header Info
                tag: tag,
                descriptor: "PVLO", // Placeholder, would extract from description
                description: rawData.find(d => d.tag === tag)?.description || "",
                unit: rawData.find(d => d.tag === tag)?.unit || "Unknown",
                type: "REGCLNIM", // Placeholder

                // Priorities & Limits
                priorities: {
                    imported: originalPriority,
                    approved: approvedPriority,
                    override_reason: null
                },
                limits: {
                    imported: 0, // Placeholder
                    approved: 0  // Placeholder
                },
                response_time: approvedPriority === 1 ? "< 5 minutes" : "< 15 minutes",

                // Relational Lists (The "Cause Table")
                cause_consequence_map: tagCauses.map(c => ({
                    cause: c.cause_text || "Unknown Cause",
                    verification: c.verification_method || "Check DCS trends",
                    corrective_action: c.corrective_action || "Notify operator"
                })),

                // Global Consequence
                consequence_text: safetyInfo.consequence_summary || "Potential process upset",

                // Classification
                alarm_classes: ["IPL", "Reliability"], // Placeholder

                // Impact Matrix
                impacts: {
                    personnel_safety: impact.safety || "None",
                    environmental: impact.environment || "None",
                    cost: impact.financial || "None"
                },

                // Logic/Constraints
                constraints: {
                    constrains_me: [] // Placeholder
                },

                // Meta for reporting
                Recommendation: recommendation,
                PriorityReason: priorityReason
            });

            if (i % 50 === 0) {
                onProgress(30 + Math.floor((i / uniqueTags.length) * 40), `Rationalizing ${tag}...`);
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // 3. Finalize
        onProgress(90, "Finalizing Relational Database...");
        return {
            data: rationalizedData,
            stats: {
                totalAlarms: uniqueTags.length,
                rationalizedCount,
                priorityChanges
            }
        };
    },

    analyzeNuisanceAlarms: function (data, validSessions, allSessions) {
        const alarmAnalysis = {};
        const FLOOD_THRESHOLD = 10;

        const alarmTags = [...new Set(data.filter(d => d.isAlarm).map(d => d.tag))];
        alarmTags.forEach(tag => {
            alarmAnalysis[tag] = {
                tag,
                totalOccurrences: 0,
                actionsFollowing: 0,
                chatterOccurrences: 0,
                floodAppearances: 0,
                sessionsWithAlarm: 0,
                floodSessionsWithAlarm: 0,
                sequentialGroups: [],
                priority: 'low'
            };
        });

        allSessions.forEach(session => {
            const isFloodSession = session.alarmFrequency > FLOOD_THRESHOLD;
            const alarmsInThisSession = new Set();

            // Group alarm events by tag for chattering detection
            const alarmEventsByTag = {};

            session.events.forEach((event, idx) => {
                if (event.isAlarm && alarmAnalysis[event.tag]) {
                    alarmAnalysis[event.tag].totalOccurrences++;
                    alarmAnalysis[event.tag].priority = event.priority;
                    alarmsInThisSession.add(event.tag);

                    // Group for chattering detection
                    if (!alarmEventsByTag[event.tag]) {
                        alarmEventsByTag[event.tag] = [];
                    }
                    alarmEventsByTag[event.tag].push(event);

                    for (let j = idx + 1; j < session.events.length; j++) {
                        if (session.events[j].isChange) {
                            if (session.events[j].timestamp - event.timestamp < 5 * 60 * 1000) {
                                alarmAnalysis[event.tag].actionsFollowing++;
                            }
                            break;
                        }
                    }
                }
            });

            alarmsInThisSession.forEach(alarmTag => {
                alarmAnalysis[alarmTag].sessionsWithAlarm++;
                if (isFloodSession) {
                    alarmAnalysis[alarmTag].floodSessionsWithAlarm++;
                }
            });

            // Standards-compliant chattering detection per tag
            Object.entries(alarmEventsByTag).forEach(([tag, events]) => {
                const chatterCount = this.detectChatteringForAlarm(events);
                alarmAnalysis[tag].chatterOccurrences += chatterCount;
            });
        });

        const sequentialPatterns = this.detectSequentialPatterns(validSessions);
        sequentialPatterns.forEach(pattern => {
            pattern.sequence.forEach(tag => {
                if (alarmAnalysis[tag]) {
                    alarmAnalysis[tag].sequentialGroups.push({
                        pattern: pattern.sequence,
                        frequency: pattern.count,
                        isConsequential: pattern.sequence[0] !== tag
                    });
                }
            });
        });

        const nuisanceAlarmList = Object.values(alarmAnalysis)
            .filter(alarm => alarm.totalOccurrences > 5)
            .map(alarm => {
                const actionRate = alarm.totalOccurrences > 0 ? alarm.actionsFollowing / alarm.totalOccurrences : 0;
                const chatterRate = alarm.totalOccurrences > 0 ? alarm.chatterOccurrences / alarm.totalOccurrences : 0;
                const floodRate = alarm.sessionsWithAlarm > 0 ?
                    alarm.floodSessionsWithAlarm / alarm.sessionsWithAlarm : 0;

                const noActionScore = (1 - actionRate) * 30;
                const chatterScore = Math.min(chatterRate * 100, 25);
                const floodScore = Math.min(floodRate * 100, 25);
                const sequentialScore = alarm.sequentialGroups.filter(g => g.isConsequential).length > 0 ? 20 : 0;
                const nuisanceScore = Math.round(noActionScore + chatterScore + floodScore + sequentialScore);

                let recommendation = 'keep', recommendationReason = '';

                if (actionRate < 0.05 && alarm.totalOccurrences > 50) {
                    recommendation = 'suppress';
                    recommendationReason = 'Less than 5% operator response rate with high occurrence count - alarm provides no operational value.';
                } else if (alarm.sequentialGroups.filter(g => g.isConsequential).length > 0 && actionRate < 0.2) {
                    recommendation = 'suppress';
                    recommendationReason = 'Consequential alarm (triggered by other alarms) with low action rate - redundant alarm.';
                } else if (chatterRate > 0.5) {
                    recommendation = 'adjust';
                    recommendationReason = 'Excessive chattering (>50%) - increase deadband, add time delay, or adjust trigger threshold per ISA 18.2.';
                } else if (chatterRate > 0.3) {
                    recommendation = 'adjust';
                    recommendationReason = 'High chattering rate (>30%) - review and adjust alarm settings per ISA 18.2.';
                } else if (actionRate < 0.1 && alarm.totalOccurrences > 20) {
                    recommendation = 'convert';
                    recommendationReason = 'Low operator response (<10%) - consider converting to event or operator message.';
                } else if (floodRate > 0.3 && actionRate < 0.3) {
                    recommendation = 'adjust';
                    recommendationReason = 'Frequently appears in alarm floods - review alarm priority and settings.';
                } else if (nuisanceScore < 30 && actionRate > 0.7) {
                    recommendation = 'keep';
                    recommendationReason = 'Good alarm performance - high operator response rate and low nuisance factors.';
                } else {
                    recommendation = 'keep';
                    recommendationReason = 'Acceptable performance - continue monitoring for changes.';
                }

                return { ...alarm, actionRate, chatterRate, floodRate, nuisanceScore, recommendation, recommendationReason };
            })
            .sort((a, b) => b.nuisanceScore - a.nuisanceScore);

        const totalAlarms = alarmTags.length;
        const metrics = {
            totalAlarms,
            noActionAlarmRate: nuisanceAlarmList.filter(a => a.actionRate < 0.1).length / totalAlarms,
            chatteringAlarmRate: nuisanceAlarmList.filter(a => a.chatterRate > 0.3).length / totalAlarms,
            sequentialAlarmGroups: [...new Set(sequentialPatterns.map(p => p.sequence.join('-')))].length,
            alarmsInFloodRate: nuisanceAlarmList.filter(a => a.floodRate > 0.5).length / totalAlarms,
            overallHealth: 100 - (nuisanceAlarmList.reduce((sum, a) => sum + a.nuisanceScore, 0) / nuisanceAlarmList.length || 0)
        };

        return { alarms: nuisanceAlarmList, metrics };
    }
};
