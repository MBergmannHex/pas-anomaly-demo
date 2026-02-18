// Global namespace for chatbot service - ISA 18.2 / IEC 62682 / EEMUA 191 compliant
window.chatbotService = {
    config: {
        // API key and endpoint are now handled server-side
        // These are kept for UI preferences only
        reasoningEffort: 'low' // For GPT-5/o-series models: 'low', 'medium', 'high', 'xhigh'
    },

    // Detect if a deployment name is a reasoning model (GPT-5, o1, o3, etc.)
    isReasoningModel: function (deploymentName) {
        const name = (deploymentName || this.config.generalDeploymentName || this.config.deploymentName).toLowerCase();
        return name.includes('gpt-5') || name.includes('o1') || name.includes('o3') || name.includes('o4');
    },

    // Check if DR model specifically is a reasoning model
    isDrReasoningModel: function () {
        const name = (this.config.drDeploymentName || this.config.deploymentName).toLowerCase();
        return name.includes('gpt-5') || name.includes('o1') || name.includes('o3') || name.includes('o4');
    },

    sessionData: null,
    descriptiveColumns: [],

    tokenUsage: {
        session: { prompt: 0, completion: 0, total: 0 },
        lastRequest: { prompt: 0, completion: 0, total: 0 }
    },

    initialize: function () {
        console.log('[Chatbot] Initializing service...');
        // Only load UI preferences (reasoning effort)
        this.config.reasoningEffort = localStorage.getItem('chatbotReasoningEffort') || 'low';
        console.log('[Chatbot] Configuration loaded');
    },

    saveConfig: function (config) {
        console.log('[Chatbot] Saving configuration...');
        // Only save UI preferences (reasoning effort)
        if (config.reasoningEffort) {
            this.config.reasoningEffort = config.reasoningEffort;
            localStorage.setItem('chatbotReasoningEffort', this.config.reasoningEffort);
        }
        console.log('[Chatbot] Configuration saved');
    },

    setSessionData: function (sessions, descriptiveColumns = []) {
        console.log(`[Chatbot] Session data updated: ${sessions.length} sessions`);
        this.sessionData = sessions;
        this.descriptiveColumns = descriptiveColumns;
    },

    isConfigured: function () {
        // Backend handles API configuration
        return true;
    },

    getTokenUsage: function () {
        return {
            lastRequest: { ...this.tokenUsage.lastRequest },
            session: { ...this.tokenUsage.session }
        };
    },

    resetTokenUsage: function () {
        console.log('[Chatbot] Resetting token usage tracking');
        this.tokenUsage = {
            session: { prompt: 0, completion: 0, total: 0 },
            lastRequest: { prompt: 0, completion: 0, total: 0 }
        };
    },

    collectDescriptions: function (event) {
        const descriptions = {};

        if (this.descriptiveColumns && this.descriptiveColumns.length > 0) {
            this.descriptiveColumns.forEach(colName => {
                if (event[colName] && String(event[colName]).trim() !== '') {
                    descriptions[colName] = event[colName];
                }
            });
        } else {
            const commonDescFields = [
                'DescOne', 'DescTwo', 'DescThree', 'DescFour', 'DescFive',
                'Desc1', 'Desc2', 'Desc3', 'Desc4', 'Desc5',
                'Description', 'Message', 'TagDescription', 'Module_Description',
                'ModuleDesc', 'Text', 'Comment', 'State_Source_Comment'
            ];

            commonDescFields.forEach(field => {
                if (event[field] && String(event[field]).trim() !== '') {
                    descriptions[field] = event[field];
                }
            });
        }

        return descriptions;
    },

    /**
     * ISA 18.2 / IEC 62682 / EEMUA 191 compliant chattering detection
     * Chattering: alarm activates 3+ times within 60 seconds
     */
    detectChattering: function (alarmEvents) {
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

    // Define available functions for OpenAI
    getToolDefinitions: function () {
        const tools = [
            {
                type: "function",
                function: {
                    name: "find_alarm_sessions",
                    description: "Find sessions containing a specific alarm tag (exact match prefered) and analyze alarm patterns",
                    parameters: {
                        type: "object",
                        properties: {
                            alarm_tag: {
                                type: "string",
                                description: "The FULL alarm tag to search for (e.g., 'LT50740 COMM_ALM', 'HS-901A'). Do not truncate suffixes."
                            },
                            analysis_type: {
                                type: "string",
                                enum: ["causes", "responses", "patterns", "general"],
                                description: "Type of analysis requested"
                            },
                            max_sessions: {
                                type: "number",
                                description: "Maximum number of sessions to analyze (default 10)"
                            }
                        },
                        required: ["alarm_tag", "analysis_type"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "find_action_sessions",
                    description: "Find sessions containing a specific operator action and analyze what alarms typically precede it",
                    parameters: {
                        type: "object",
                        properties: {
                            action_tag: {
                                type: "string",
                                description: "The FULL operator action tag to search for (e.g., 'TIC-101 SP', 'P-101 START')"
                            },
                            analysis_type: {
                                type: "string",
                                enum: ["preceding_alarms", "context", "effectiveness", "general"],
                                description: "Type of analysis requested"
                            },
                            max_sessions: {
                                type: "number",
                                description: "Maximum number of sessions to analyze (default 10)"
                            }
                        },
                        required: ["action_tag", "analysis_type"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "analyze_tag",
                    description: "Analyze any tag (alarm or action) to determine its type and usage patterns",
                    parameters: {
                        type: "object",
                        properties: {
                            tag: {
                                type: "string",
                                description: "The tag to analyze"
                            }
                        },
                        required: ["tag"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "analyze_session",
                    description: "Analyze a specific session by ID",
                    parameters: {
                        type: "object",
                        properties: {
                            session_id: {
                                type: "number",
                                description: "The session ID to analyze"
                            }
                        },
                        required: ["session_id"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "find_alarm_patterns",
                    description: "Find common alarm patterns, floods, or chattering alarms",
                    parameters: {
                        type: "object",
                        properties: {
                            pattern_type: {
                                type: "string",
                                enum: ["floods", "chattering", "sequences", "nuisance"],
                                description: "Type of pattern to search for"
                            },
                            limit: {
                                type: "number",
                                description: "Maximum number of results (default 10)"
                            }
                        },
                        required: ["pattern_type"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "get_alarm_statistics",
                    description: "Get statistics about specific alarms or overall system",
                    parameters: {
                        type: "object",
                        properties: {
                            alarm_tags: {
                                type: ["array", "null"],
                                items: { type: "string" },
                                description: "Specific alarm tags to analyze, or null for overall stats"
                            },
                            include_descriptions: {
                                type: "boolean",
                                description: "Include alarm descriptions in results"
                            }
                        },
                        required: ["alarm_tags"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "analyze_simulation_performance",
                    description: "Analyze a user's performance in the simulation game by comparing their decisions against historical 'golden path' data.",
                    parameters: {
                        type: "object",
                        properties: {
                            start_tag: {
                                type: "string",
                                description: "The alarm tag that started the simulation"
                            },
                            user_moves: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        event: { type: "string", description: "The alarm presented to user" },
                                        action: { type: "string", description: "The action user took" },
                                        result: { type: "string", description: "Game result (SUCCESS/FAILURE)" }
                                    }
                                },
                                description: "The sequence of moves the user made"
                            },
                            score: { type: "number" }
                        },
                        required: ["start_tag", "user_moves"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "scan_system_for_oscillation",
                    description: "Scans the entire system for potential oscillation issues. It automatically identifies the top 10 chattering alarms and runs a specialized control loop analysis on them to confirm if they are oscillating due to control issues.",
                    parameters: {
                        type: "object",
                        properties: {},
                        required: []
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "generate_compliance_report",
                    description: "Generates a formal PDF Audit Report compliant with ISA 18.2. Triggers a multi-agent workflow to analyze statistics, rationalization data, and bad actors, then compiles a downloadable PDF.",
                    parameters: {
                        type: "object",
                        properties: {
                            report_title: {
                                type: "string",
                                description: "Title of the report (e.g. 'Monthly Compliance Audit - May 2025')"
                            },
                            focus_area: {
                                type: "string",
                                description: "Optional focus area (e.g. 'Nuisance Alarms', 'Flood Analysis')"
                            }
                        },
                        required: ["report_title"]
                    }
                }
            }
        ];

        // Dynamically register the Control Loop Specialist tool if available
        if (window.controlLoopService && typeof window.controlLoopService.getToolDefinition === 'function') {
            tools.push(window.controlLoopService.getToolDefinition());
        } else {
            console.warn("[Chatbot] Control Loop Service not found. Loop analysis tool will be disabled.");
        }

        return tools;
    },

    // Execute function calls based on name
    executeFunction: async function (name, args) {
        console.log(`[Chatbot] Executing function: ${name}`, args);

        if (!this.sessionData) {
            return "Error: No alarm data has been loaded yet.";
        }

        switch (name) {
            case "find_alarm_sessions":
                return this.findAlarmSessions(args);
            case "find_action_sessions":
                return this.findActionSessions(args);
            case "analyze_tag":
                return this.analyzeTag(args);
            case "analyze_session":
                return this.analyzeSessionDetails(args);
            case "find_alarm_patterns":
                return this.findAlarmPatterns(args);
            case "get_alarm_statistics":
                return this.getAlarmStatistics(args);
            case "analyze_simulation_performance":
                return this.analyzeSimulationPerformance(args);
            case "generate_compliance_report":
                return await this.orchestrateReportGeneration(args);
            case "analyze_control_loop":
                if (window.controlLoopService) {
                    // Filter sessions to pass relevant data to the specialist
                    const relevantSessions = this.sessionData.filter(s =>
                        s.events.some(e => e.tag === args.tag || e.tag.includes(args.tag) || (e.baseTag && e.baseTag === args.tag))
                    );
                    return await window.controlLoopService.analyzeLoopPerformance(args.tag, relevantSessions);
                } else {
                    return "Error: Control Loop Service is not available.";
                }
            case "scan_system_for_oscillation":
                return await this.scanSystemForOscillation();
            default:
                console.error(`[Chatbot] Unknown function: ${name}`);
                return `Error: Unknown function ${name}`;
        }
    },

    // --- REPORT GENERATION LOGIC ---

    orchestrateReportGeneration: async function ({ report_title, focus_area }) {
        console.log(`[Chatbot] Orchestrating report generation: ${report_title}`);

        if (!window.jspdf) {
            return {
                success: false,
                message: "Error: PDF generation libraries (jspdf) are not loaded. Please ensure index.html includes the required scripts."
            };
        }

        // 1. DATA AGGREGATION AGENT (The 'Junior Consultant')
        // Gather raw data from your existing services
        // FIX: this.sessionData ALREADY contains session objects. Do not call extractSessions again.
        const sessions = this.sessionData;

        if (!sessions || sessions.length === 0) {
            return {
                success: false,
                message: "Error: No session data available to generate report."
            };
        }

        const allEvents = sessions.flatMap(s => s.events);

        const stats = window.statsService.calculateStatistics(allEvents, sessions);

        // Safety check if statistics could not be calculated (e.g. no events found)
        if (!stats) {
            return {
                success: false,
                message: "Error: Could not calculate statistics. Please check if data is loaded correctly."
            };
        }

        const rationalization = window.rationalizationService.analyzeNuisanceAlarms(allEvents, sessions, sessions);

        // Prepare a data summary for the AI Analyst
        const dataSummary = {
            kpis: {
                alarmRate: stats.avgAlarmRate ? stats.avgAlarmRate.toFixed(2) : "0.00",
                floodPercent: stats.percentTimeInFlood ? stats.percentTimeInFlood.toFixed(2) : "0.00",
                chatteringRate: rationalization.metrics.chatteringAlarmRate ? rationalization.metrics.chatteringAlarmRate.toFixed(2) : "0.00",
                healthScore: rationalization.metrics.overallHealth ? rationalization.metrics.overallHealth.toFixed(0) : "0"
            },
            topBadActors: rationalization.alarms.slice(0, 5).map(a => ({
                tag: a.tag,
                score: a.nuisanceScore,
                issue: a.recommendationReason
            })),
            focus: focus_area || "General Compliance"
        };

        // 2. ANALYST AGENT (The 'Senior Consultant')
        // We make a specialized LLM call just to write the Executive Summary
        // Prompt is now constructed server-side

        try {
            // Call backend API for report generation - send data only
            const narrativeResponse = await fetch('/api/chat/generate-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataSummary,
                    focusArea: focus_area || "General Health",
                    temperature: 0.7
                })
            });

            if (!narrativeResponse.ok) {
                throw new Error('API request failed');
            }

            const narrativeData = await narrativeResponse.json();
            const expertNarrative = narrativeData.content;

            // 3. PUBLISHING AGENT (The 'Formatter')
            // Now we generate the physical PDF
            this.generatePDF(report_title, expertNarrative, stats, rationalization);

            return {
                success: true,
                message: `Report "${report_title}" has been generated and downloaded. It includes analysis of ${rationalization.alarms.length} tags.`
            };

        } catch (error) {
            console.error("Report generation failed during AI analysis:", error);
            return {
                success: false,
                message: "Failed to generate AI narrative for report. Please check API configuration."
            };
        }
    },

    generatePDF: function (title, narrative, stats, rationalization) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // --- Header ---
        doc.setFillColor(79, 70, 229); // Purple header
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.text("Alarm Compliance Audit", 15, 25);
        doc.setFontSize(12);
        doc.text(title, 15, 35);

        // --- Executive Summary (AI Generated) ---
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.text("1. Executive Summary", 15, 50);

        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        const splitNarrative = doc.splitTextToSize(narrative, 180);
        doc.text(splitNarrative, 15, 60);

        let yPos = 60 + (splitNarrative.length * 5) + 10;

        // --- KPI Dashboard ---
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text("2. Performance KPIs (ISA 18.2)", 15, yPos);
        yPos += 10;

        const kpiData = [
            ["Metric", "Value", "ISA 18.2 Target", "Status"],
            ["Avg Alarm Rate", stats.avgAlarmRate.toFixed(2), "< 1 per 10m", stats.avgAlarmRate < 1 ? "PASS" : "FAIL"],
            ["% Time in Flood", stats.percentTimeInFlood.toFixed(1) + "%", "< 1%", stats.percentTimeInFlood < 1 ? "PASS" : "FAIL"],
            ["System Health", rationalization.metrics.overallHealth.toFixed(0) + "%", "> 95%", rationalization.metrics.overallHealth > 95 ? "GOOD" : "RISK"]
        ];

        doc.autoTable({
            startY: yPos,
            head: [kpiData[0]],
            body: kpiData.slice(1),
            theme: 'striped',
            headStyles: { fillColor: [79, 70, 229] }
        });

        yPos = doc.lastAutoTable.finalY + 15;

        // --- Bad Actors Table ---
        doc.text("3. Top Nuisance Alarms (Bad Actors)", 15, yPos);
        yPos += 5;

        const badActors = rationalization.alarms.slice(0, 10).map(a => [
            a.tag,
            a.nuisanceScore,
            (a.chatterRate * 100).toFixed(0) + "%",
            a.recommendation.toUpperCase()
        ]);

        doc.autoTable({
            startY: yPos,
            head: [["Tag", "Score", "Chatter %", "Action"]],
            body: badActors,
            theme: 'grid',
            headStyles: { fillColor: [220, 38, 38] } // Red header for bad actors
        });

        // --- Footer ---
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.text(`Generated by Alarm Analyzer Pro AI - ${new Date().toLocaleDateString()}`, 15, 290);
            doc.text(`Page ${i} of ${pageCount}`, 190, 290, { align: 'right' });
        }

        doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
    },

    // --- REVISED SIMULATION ANALYSIS LOGIC ---

    analyzeSimulationPerformance: function ({ start_tag, user_moves, score }) {
        console.log(`[Chatbot] Analyzing simulation performance for start tag: ${start_tag}`);

        // 1. Find relevant historical sessions
        // We look for sessions that started with or contained the start_tag early on
        let historicalSessions = this.sessionData.filter(session => {
            if (session.events.length === 0) return false;
            // Check if it starts with the tag OR contains it within first 3 events
            return session.events.slice(0, 3).some(e => e.tag === start_tag || e.tag.includes(start_tag));
        });

        const totalFound = historicalSessions.length;

        // --- NEW: Golden Path Filtering (Best Practices) ---
        // 1. Exclude Alarm Floods (unmanageable sessions)
        historicalSessions = historicalSessions.filter(s => s.alarmFrequency < 10);

        // 2. Prioritize Efficiency (Top 50% fastest resolution) if we have enough data
        if (historicalSessions.length > 5) {
            historicalSessions.sort((a, b) => a.duration - b.duration);
            const cutoff = Math.ceil(historicalSessions.length * 0.5);
            historicalSessions = historicalSessions.slice(0, cutoff);
        }
        // ----------------------------------------------------

        if (historicalSessions.length === 0) {
            // Fallback: If filtering removed everything (or nothing found), revert to all found or return error
            if (totalFound > 0) {
                // Revert to original set if 'Best Practice' filtering was too strict
                historicalSessions = this.sessionData.filter(session => {
                    if (session.events.length === 0) return false;
                    return session.events.slice(0, 3).some(e => e.tag === start_tag || e.tag.includes(start_tag));
                });
            } else {
                return {
                    start_tag,
                    found_history: false,
                    message: `No historical sessions found starting with ${start_tag}. Cannot compare against best practices.`
                };
            }
        }

        // 2. Build the "Golden Path" from High-Performing Sessions
        // Map: Alarm Tag -> { [Action Tag]: Count }
        const transitionMap = {};

        historicalSessions.forEach(session => {
            for (let i = 0; i < session.events.length - 1; i++) {
                const current = session.events[i];
                const next = session.events[i + 1];

                // We are interested in Alarm -> Action transitions
                if (current.isAlarm && next.isChange) {
                    if (!transitionMap[current.tag]) transitionMap[current.tag] = {};
                    const actionKey = next.tag;
                    transitionMap[current.tag][actionKey] = (transitionMap[current.tag][actionKey] || 0) + 1;
                }
            }
        });

        // 3. Compare User Moves against History
        const analysisReport = [];
        let deviations = 0;
        let correctMoves = 0;

        user_moves.forEach((move, index) => {
            const alarm = move.event;
            const userAction = move.action;

            // --- NEW: Get Descriptions for Context ---
            const sampleEvent = this.sessionData
                .flatMap(s => s.events)
                .find(e => e.tag === alarm && e.isAlarm);
            const descData = sampleEvent ? this.collectDescriptions(sampleEvent) : {};
            // Create a clean description string for the AI
            const descriptionStr = Object.values(descData).filter(v => v).join(' | ') || "No description available";
            // -----------------------------------------

            const historicalData = transitionMap[alarm];

            if (!historicalData) {
                analysisReport.push({
                    step: index + 1,
                    alarm: alarm,
                    description: descriptionStr,
                    user_action: userAction,
                    verdict: "UNKNOWN_ALARM",
                    detail: "This alarm does not have sufficient historical action data in high-performing sessions."
                });
                return;
            }

            // Find best historical action
            const sortedActions = Object.entries(historicalData).sort((a, b) => b[1] - a[1]);
            const bestAction = sortedActions[0][0];
            const bestActionCount = sortedActions[0][1];
            const totalActions = Object.values(historicalData).reduce((a, b) => a + b, 0);
            const consensus = (bestActionCount / totalActions) * 100;

            // Check if user matched best action
            const isMatch = userAction === bestAction;

            if (isMatch) {
                correctMoves++;
                analysisReport.push({
                    step: index + 1,
                    alarm: alarm,
                    description: descriptionStr,
                    user_action: userAction,
                    verdict: "OPTIMAL",
                    detail: `Correct. ${consensus.toFixed(0)}% of top operators take this action for ${descriptionStr || alarm}.`
                });
            } else {
                deviations++;
                analysisReport.push({
                    step: index + 1,
                    alarm: alarm,
                    description: descriptionStr,
                    user_action: userAction,
                    verdict: "DEVIATION",
                    detail: `Deviation. You chose '${userAction}', but historically '${bestAction}' is preferred (${consensus.toFixed(0)}% consensus) for ${descriptionStr || alarm}.`
                });
            }
        });

        return {
            start_tag,
            found_history: true,
            historical_sessions_count: historicalSessions.length,
            total_sessions_found: totalFound,
            filter_applied: totalFound !== historicalSessions.length ? "Efficiency & Flood Filters Applied" : "None",
            user_score: score,
            moves_analyzed: user_moves.length,
            correct_moves: correctMoves,
            deviations: deviations,
            step_by_step_analysis: analysisReport,
            summary: `Compared against ${historicalSessions.length} high-performing historical sessions (filtered from ${totalFound}). User made ${correctMoves} optimal decisions and ${deviations} deviations.`
        };
    },

    scanSystemForOscillation: async function () {
        console.log('[Chatbot] Scanning system for oscillation candidates...');

        if (!window.controlLoopService) {
            return "Error: Control Loop Service is not available.";
        }

        const chatteringResult = this.findAlarmPatterns({ pattern_type: 'chattering', limit: 10 });

        if (!chatteringResult.alarms || chatteringResult.alarms.length === 0) {
            return "No significant chattering alarms found to analyze for oscillation.";
        }

        const candidates = chatteringResult.alarms;
        const results = [];

        for (const candidate of candidates) {
            const tag = candidate.tag;
            const sessions = this.sessionData.filter(s => s.id && candidate.affected_sessions.includes(s.id));

            console.log(`[Chatbot] Analyzing candidate ${tag} in ${sessions.length} sessions...`);

            const diagnosis = await window.controlLoopService.analyzeLoopPerformance(tag, sessions);

            if (diagnosis.issues_detected && diagnosis.issues_detected.length > 0) {
                results.push({
                    tag: tag,
                    chatter_count: candidate.chatter_count,
                    issues: diagnosis.issues_detected
                });
            }
        }

        return {
            scan_summary: `Scanned top ${candidates.length} chattering alarms. Found definite oscillation/control issues in ${results.length} tags.`,
            confirmed_oscillations: results
        };
    },

    findAlarmSessions: function ({ alarm_tag, analysis_type, max_sessions = 10 }) {
        console.log(`[Chatbot] Finding sessions for alarm: ${alarm_tag}`);

        // Robust matching logic: Check exact match first, then case-insensitive, then baseTag match
        const allOccurrences = this.sessionData.filter(session =>
            session.events.some(e => {
                if (!e.tag) return false;
                if (e.tag === alarm_tag) return true;
                if (e.tag.toUpperCase() === alarm_tag.toUpperCase()) return true;
                return false;
            })
        );

        console.log(`[Chatbot] Found ${allOccurrences.length} sessions with tag ${alarm_tag} (any type)`);

        // Filter specifically for ALARM events
        const sessionsWithAlarm = this.sessionData.filter(session =>
            session.events.some(e => {
                if (!e.isAlarm) return false;
                if (e.tag === alarm_tag) return true;
                if (e.tag.toUpperCase() === alarm_tag.toUpperCase()) return true;
                return false;
            })
        );

        console.log(`[Chatbot] Found ${sessionsWithAlarm.length} sessions with ${alarm_tag} as alarm`);

        if (sessionsWithAlarm.length === 0 && allOccurrences.length > 0) {
            const eventTypes = new Set();
            allOccurrences.forEach(session => {
                session.events.forEach(e => {
                    if (e.tag === alarm_tag || e.tag.toUpperCase() === alarm_tag.toUpperCase()) {
                        eventTypes.add(e.isAlarm ? 'alarm' : (e.isChange ? 'action' : 'unknown'));
                    }
                });
            });

            return {
                found: false,
                alarm_tag: alarm_tag,
                message: `${alarm_tag} was found in ${allOccurrences.length} sessions but is not marked as an alarm. It appears as: ${Array.from(eventTypes).join(', ')}.`,
                occurrences_as_other_type: allOccurrences.length,
                event_types: Array.from(eventTypes)
            };
        }

        if (sessionsWithAlarm.length === 0) {
            return { found: false, alarm_tag: alarm_tag, message: `No sessions found containing ${alarm_tag}. Please ensure the tag matches exactly (including any suffixes like '_ALM').` };
        }

        const topSessions = sessionsWithAlarm.sort((a, b) => b.events.length - a.events.length).slice(0, max_sessions);

        const analysis = {
            alarm_tag: alarm_tag,
            total_occurrences: 0,
            sessions_analyzed: topSessions.length,
            total_sessions_with_alarm: sessionsWithAlarm.length,
            analysis_type: analysis_type,
            descriptions: {},
            units_affected: new Set(),
            chattering_instances: 0,
            sample_sessions: []
        };

        topSessions.forEach(session => {
            // Filter events using robust matching
            const alarmEvents = session.events.filter(e =>
                e.tag && e.isAlarm && (e.tag === alarm_tag || e.tag.toUpperCase() === alarm_tag.toUpperCase())
            );

            const sessionChatterCount = this.detectChattering(alarmEvents);
            analysis.chattering_instances += sessionChatterCount;

            analysis.sample_sessions.push({
                session_id: session.id,
                unit: session.unit,
                duration_ms: session.duration,
                alarm_frequency: session.alarmFrequency,
                alarm_activations: alarmEvents.length,
                chattering_incidents: sessionChatterCount,
                events: session.events.slice(0, 15).map(e => ({
                    time: new Date(e.timestamp).toISOString(),
                    tag: e.tag,
                    type: e.isAlarm ? 'ALARM' : 'ACTION',
                    descriptions: this.collectDescriptions(e)
                })),
                has_more_events: session.events.length > 15
            });

            session.events.forEach((event) => {
                if (event.tag && event.isAlarm && (event.tag === alarm_tag || event.tag.toUpperCase() === alarm_tag.toUpperCase())) {
                    analysis.total_occurrences++;
                    analysis.units_affected.add(session.unit);

                    Object.entries(this.collectDescriptions(event)).forEach(([colName, value]) => {
                        if (!analysis.descriptions[colName]) analysis.descriptions[colName] = new Set();
                        analysis.descriptions[colName].add(value);
                    });
                }
            });
        });

        Object.entries(analysis.descriptions).forEach(([colName, valueSet]) => {
            analysis.descriptions[colName] = Array.from(valueSet);
        });
        analysis.units_affected = Array.from(analysis.units_affected);

        console.log(`[Chatbot] Analysis complete for ${alarm_tag}:`, analysis);
        return analysis;
    },

    findActionSessions: function ({ action_tag, analysis_type, max_sessions = 10 }) {
        console.log(`[Chatbot] Finding sessions for action: ${action_tag}`);

        // Robust matching for actions
        const sessionsWithAction = this.sessionData.filter(session =>
            session.events.some(e => e.tag && e.isChange && (e.tag === action_tag || e.tag.toUpperCase() === action_tag.toUpperCase()))
        );

        console.log(`[Chatbot] Found ${sessionsWithAction.length} sessions with action ${action_tag}`);

        if (sessionsWithAction.length === 0) {
            const asAlarm = this.sessionData.filter(session =>
                session.events.some(e => e.tag && e.isAlarm && (e.tag === action_tag || e.tag.toUpperCase() === action_tag.toUpperCase()))
            );

            if (asAlarm.length > 0) {
                return {
                    found: false,
                    action_tag: action_tag,
                    message: `${action_tag} appears to be an alarm (found in ${asAlarm.length} sessions), not an operator action.`
                };
            }

            return { found: false, action_tag: action_tag, message: `No sessions found containing action ${action_tag}` };
        }

        const topSessions = sessionsWithAction.sort((a, b) => b.events.length - a.events.length).slice(0, max_sessions);

        const analysis = {
            action_tag: action_tag,
            total_occurrences: 0,
            sessions_analyzed: topSessions.length,
            total_sessions_with_action: sessionsWithAction.length,
            analysis_type: analysis_type,
            descriptions: {},
            preceding_alarms: {},
            alarm_to_action_times: [],
            units_affected: new Set(),
            effectiveness_metrics: {
                sessions_resolved_after: 0,
                avg_time_to_resolution: 0,
                common_alarm_causes: {}
            },
            sample_sessions: []
        };

        topSessions.forEach(session => {
            const sessionSample = {
                session_id: session.id,
                unit: session.unit,
                duration_ms: session.duration,
                context_events: []
            };

            session.events.forEach((event, idx) => {
                if (event.tag && event.isChange && (event.tag === action_tag || event.tag.toUpperCase() === action_tag.toUpperCase())) {
                    analysis.total_occurrences++;
                    analysis.units_affected.add(session.unit);

                    Object.entries(this.collectDescriptions(event)).forEach(([colName, value]) => {
                        if (!analysis.descriptions[colName]) analysis.descriptions[colName] = new Set();
                        analysis.descriptions[colName].add(value);
                    });

                    // Preceding alarms logic...
                    const lookbackTime = 5 * 60 * 1000;
                    const precedingAlarms = [];

                    for (let j = idx - 1; j >= 0 && j >= idx - 10; j--) {
                        const prevEvent = session.events[j];
                        if (event.timestamp - prevEvent.timestamp > lookbackTime) break;

                        if (prevEvent.isAlarm) {
                            precedingAlarms.push({
                                tag: prevEvent.tag,
                                time_before_action: event.timestamp - prevEvent.timestamp,
                                descriptions: this.collectDescriptions(prevEvent)
                            });

                            const pattern = `${prevEvent.tag} → ${action_tag}`;
                            analysis.preceding_alarms[pattern] = (analysis.preceding_alarms[pattern] || 0) + 1;

                            analysis.alarm_to_action_times.push({
                                alarm: prevEvent.tag,
                                action: action_tag,
                                response_time: event.timestamp - prevEvent.timestamp
                            });
                        }
                    }

                    const contextStart = Math.max(0, idx - 5);
                    const contextEnd = Math.min(session.events.length, idx + 6);
                    const context = session.events.slice(contextStart, contextEnd).map((e, i) => ({
                        time: new Date(e.timestamp).toISOString(),
                        tag: e.tag,
                        type: e.isAlarm ? 'ALARM' : 'ACTION',
                        is_target: (contextStart + i) === idx,
                        descriptions: this.collectDescriptions(e)
                    }));

                    sessionSample.context_events.push({
                        action_index: idx,
                        preceding_alarms: precedingAlarms,
                        context: context
                    });

                    const remainingAlarms = session.events.slice(idx + 1).filter(e => e.isAlarm).length;
                    const remainingTime = session.endTime - event.timestamp;
                    if (remainingAlarms < 3 && remainingTime < 10 * 60 * 1000) {
                        analysis.effectiveness_metrics.sessions_resolved_after++;
                    }
                }
            });

            if (sessionSample.context_events.length > 0) {
                analysis.sample_sessions.push(sessionSample);
            }
        });

        Object.entries(analysis.descriptions).forEach(([colName, valueSet]) => {
            analysis.descriptions[colName] = Array.from(valueSet);
        });
        analysis.units_affected = Array.from(analysis.units_affected);

        if (analysis.alarm_to_action_times.length > 0) {
            analysis.effectiveness_metrics.avg_time_to_resolution =
                analysis.alarm_to_action_times.reduce((sum, t) => sum + t.response_time, 0) /
                analysis.alarm_to_action_times.length;
        }

        analysis.effectiveness_metrics.common_alarm_causes = Object.entries(analysis.preceding_alarms)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([pattern, count]) => ({ pattern, count }));

        console.log(`[Chatbot] Analysis complete for action ${action_tag}:`, analysis);
        return analysis;
    },

    analyzeTag: function ({ tag }) {
        console.log(`[Chatbot] Analyzing tag: ${tag}`);

        const tagInfo = {
            tag: tag,
            is_alarm: false,
            is_action: false,
            is_unknown: true,
            total_occurrences: 0,
            session_count: 0,
            units: new Set(),
            descriptions: {},
            usage_context: []
        };

        this.sessionData.forEach(session => {
            let foundInSession = false;

            session.events.forEach(event => {
                // Robust matching
                if (event.tag && (event.tag === tag || event.tag.toUpperCase() === tag.toUpperCase())) {
                    tagInfo.total_occurrences++;
                    tagInfo.units.add(session.unit);
                    foundInSession = true;

                    if (event.isAlarm) {
                        tagInfo.is_alarm = true;
                        tagInfo.is_unknown = false;
                    } else if (event.isChange) {
                        tagInfo.is_action = true;
                        tagInfo.is_unknown = false;
                    }

                    Object.entries(this.collectDescriptions(event)).forEach(([colName, value]) => {
                        if (!tagInfo.descriptions[colName]) tagInfo.descriptions[colName] = new Set();
                        tagInfo.descriptions[colName].add(value);
                    });
                }
            });

            if (foundInSession) {
                tagInfo.session_count++;
            }
        });

        tagInfo.units = Array.from(tagInfo.units);
        Object.entries(tagInfo.descriptions).forEach(([colName, valueSet]) => {
            tagInfo.descriptions[colName] = Array.from(valueSet);
        });

        if (tagInfo.is_alarm && tagInfo.is_action) {
            tagInfo.primary_type = "mixed";
            tagInfo.message = `${tag} appears as both an alarm and an action in the data.`;
        } else if (tagInfo.is_alarm) {
            tagInfo.primary_type = "alarm";
            tagInfo.message = `${tag} is an alarm that appears ${tagInfo.total_occurrences} times across ${tagInfo.session_count} sessions.`;
        } else if (tagInfo.is_action) {
            tagInfo.primary_type = "action";
            tagInfo.message = `${tag} is an operator action that appears ${tagInfo.total_occurrences} times across ${tagInfo.session_count} sessions.`;
        } else if (tagInfo.total_occurrences > 0) {
            tagInfo.primary_type = "unknown";
            tagInfo.message = `${tag} was found ${tagInfo.total_occurrences} times but is not clearly marked.`;
        } else {
            tagInfo.primary_type = "not_found";
            tagInfo.message = `${tag} was not found in the historical data.`;
        }

        console.log(`[Chatbot] Tag analysis complete:`, tagInfo);
        return tagInfo;
    },

    analyzeSessionDetails: function ({ session_id }) {
        console.log(`[Chatbot] Analyzing session: ${session_id}`);
        const session = this.sessionData.find(s => s.id === session_id);
        if (!session) {
            return { found: false, session_id: session_id, message: `Session ${session_id} not found` };
        }
        return {
            session_id: session.id, unit: session.unit, duration_minutes: session.duration / 60000, total_events: session.events.length,
            alarms: session.alarms, actions: session.actions, alarm_frequency_per_10min: session.alarmFrequency, has_alarm_flood: session.alarmFrequency > 10,
            event_sequence: session.events.slice(0, 20).map(e => ({ tag: e.tag, type: e.isAlarm ? 'ALARM' : 'ACTION', descriptions: Object.values(this.collectDescriptions(e)) }))
        };
    },

    findAlarmPatterns: function ({ pattern_type, limit = 10 }) {
        console.log(`[Chatbot] Finding ${pattern_type} patterns`);

        switch (pattern_type) {
            case "floods":
                const floodSessions = this.sessionData
                    .filter(s => s.alarmFrequency > 10)
                    .sort((a, b) => b.alarmFrequency - a.alarmFrequency)
                    .slice(0, limit);

                return {
                    pattern_type: "floods",
                    count: floodSessions.length,
                    sessions: floodSessions.map(s => ({
                        session_id: s.id,
                        unit: s.unit,
                        alarm_frequency: s.alarmFrequency,
                        duration_minutes: s.duration / 60000,
                        alarm_count: s.alarms,
                        most_frequent_alarms: this.getMostFrequentTags(s.events.filter(e => e.isAlarm))
                    }))
                };

            case "chattering":
                const chatteringAlarms = {};
                this.sessionData.forEach(session => {
                    for (let i = 1; i < session.events.length; i++) {
                        const curr = session.events[i];
                        const prev = session.events[i - 1];
                        // Robust checking for chatter logic
                        if (curr.isAlarm && prev.isAlarm && curr.tag === prev.tag &&
                            (curr.timestamp - prev.timestamp) < 60000) {
                            if (!chatteringAlarms[curr.tag]) {
                                chatteringAlarms[curr.tag] = { count: 0, sessions: new Set() };
                            }
                            chatteringAlarms[curr.tag].count++;
                            chatteringAlarms[curr.tag].sessions.add(session.id);
                        }
                    }
                });

                return {
                    pattern_type: "chattering",
                    alarms: Object.entries(chatteringAlarms)
                        .map(([tag, data]) => ({
                            tag,
                            chatter_count: data.count,
                            affected_sessions: Array.from(data.sessions)
                        }))
                        .sort((a, b) => b.chatter_count - a.chatter_count)
                        .slice(0, limit)
                };

            case "sequences":
                const sequences = {};
                this.sessionData.forEach(session => {
                    const alarms = session.events.filter(e => e.isAlarm);
                    for (let i = 0; i < alarms.length - 1; i++) {
                        const seq = `${alarms[i].tag} → ${alarms[i + 1].tag}`;
                        sequences[seq] = (sequences[seq] || 0) + 1;
                    }
                });

                return {
                    pattern_type: "sequences",
                    sequences: Object.entries(sequences)
                        .map(([sequence, count]) => ({ sequence, count }))
                        .sort((a, b) => b.count - a.count)
                        .slice(0, limit)
                };

            default:
                return { error: `Unknown pattern type: ${pattern_type}` };
        }
    },

    getAlarmStatistics: function ({ alarm_tags, include_descriptions }) {
        console.log(`[Chatbot] Getting statistics for:`, alarm_tags);

        if (!alarm_tags || alarm_tags.length === 0) {
            const totalAlarms = this.sessionData.reduce((sum, s) => sum + s.alarms, 0);
            const totalActions = this.sessionData.reduce((sum, s) => sum + s.actions, 0);
            const avgAlarmFreq = this.sessionData.reduce((sum, s) => sum + s.alarmFrequency, 0) / this.sessionData.length;

            return {
                overall: true,
                total_sessions: this.sessionData.length,
                total_alarms: totalAlarms,
                total_actions: totalActions,
                avg_alarm_frequency: avgAlarmFreq,
                alarm_to_action_ratio: totalAlarms / (totalActions || 1)
            };
        }

        const stats = {};
        alarm_tags.forEach(tag => {
            stats[tag] = {
                occurrences: 0,
                sessions: 0,
                units: new Set(),
                descriptions: include_descriptions ? {} : null
            };
        });

        this.sessionData.forEach(session => {
            const foundTags = new Set();
            session.events.forEach(event => {
                if (event.isAlarm && alarm_tags.includes(event.tag)) {
                    stats[event.tag].occurrences++;
                    stats[event.tag].units.add(session.unit);
                    foundTags.add(event.tag);

                    if (include_descriptions) {
                        Object.entries(this.collectDescriptions(event)).forEach(([col, val]) => {
                            if (!stats[event.tag].descriptions[col]) {
                                stats[event.tag].descriptions[col] = new Set();
                            }
                            stats[event.tag].descriptions[col].add(val);
                        });
                    }
                }
            });
            foundTags.forEach(tag => stats[tag].sessions++);
        });

        Object.values(stats).forEach(stat => {
            stat.units = Array.from(stat.units);
            if (stat.descriptions) {
                Object.keys(stat.descriptions).forEach(col => {
                    stat.descriptions[col] = Array.from(stat.descriptions[col]);
                });
            }
        });

        return { alarm_statistics: stats };
    },

    getMostFrequentTags: function (events) {
        const counts = {};
        events.forEach(e => {
            counts[e.tag] = (counts[e.tag] || 0) + 1;
        });
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([tag, count]) => ({ tag, count }));
    },

    formatMessageContent: function (content) {
        if (!content) {
            return '<p>I apologize, but I couldn\'t generate a proper response. Please try rephrasing your question.</p>';
        }

        let formatted = String(content);
        formatted = formatted.replace(/<strong>([^<]+)<\/strong>/g,
            '<div style="font-weight: 600; color: #4F46E5; margin-top: 16px; margin-bottom: 8px; font-size: 1.05em;">$1</div>');
        formatted = formatted.replace(/\b([A-Z]+-?\d+[A-Z\d-]*)\b/gi,
            '<code style="background-color: #FEF3C7; color: #92400E; padding: 1px 4px; border-radius: 3px; font-weight: normal;">$1</code>');
        formatted = formatted.replace(/\b(critical|flood|excessive chattering)\b/gi,
            '<span style="color: #DC2626;">$1</span>');
        formatted = formatted.replace(/(Recommendation:|Action Required:|Summary:)/gi,
            '<div style="color: #1E40AF; font-weight: 600; margin-top: 12px; margin-bottom: 4px;">$1</div>');
        formatted = formatted.replace(/(Patterns:|Pattern Analysis:|Common Sequences:)/gi,
            '<div style="color: #059669; font-weight: 600; margin-top: 12px; margin-bottom: 4px;">$1</div>');
        formatted = formatted.replace(/\n{2,}/g, '</p><p>');
        if (!formatted.startsWith('<p>') && !formatted.startsWith('<div')) {
            formatted = '<p>' + formatted + '</p>';
        }
        return formatted.trim();
    },


    sendMessage: async function (message, context = null, conversationHistory = []) {
        if (!this.isConfigured()) {
            throw new Error('Chatbot service is not configured');
        }

        console.log('[Chatbot] Sending message:', message);

        const thoughts = [];

        // Prepare messages for conversation history
        const conversationMessages = conversationHistory.map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        try {
            thoughts.push({
                stage: 'intent',
                text: 'Analyzing user query to understand intent and determine if external data tools are required...',
                details: { query: message },
                timestamp: new Date()
            });

            console.log('[Chatbot] Making initial API call...');

            const response = await fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    conversationHistory: conversationMessages,
                    modelConfig: {
                        deploymentType: 'general',
                        reasoningEffort: this.config.reasoningEffort
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }

            const data = await response.json();

            // Response Parsing for Responses API
            const outputItems = data.output || [];

            // Check for tool calls
            const toolCallItems = outputItems.filter(item => item.type === 'tool_call' || item.type === 'custom_tool_call');

            if (toolCallItems.length > 0) {
                console.log(`[Chatbot] Model requested function call(s):`, toolCallItems);
                // Note: Messages array not strictly needed for history in the same way, but keeping track locally is good practice.
                // However, Responses API handles conversation context slightly differently usually. 
                // For now, we mimic the tool execution flow.

                const toolNames = toolCallItems.map(t => t.function ? t.function.name : t.tool_name).join(', '); // Handle potential variance
                thoughts.push({
                    stage: 'plan',
                    text: `The model determined that specific data is needed. Selected tool(s): ${toolNames}.`,
                    timestamp: new Date()
                });

                const toolResults = [];

                for (const toolCall of toolCallItems) {
                    // Extract function name and args. structure might vary slightly for custom_tool_call vs tool_call
                    const functionName = toolCall.function ? toolCall.function.name : toolCall.tool_name;
                    let functionArgs = {};
                    try {
                        functionArgs = toolCall.function ? JSON.parse(toolCall.function.arguments) : toolCall.tool_args;
                    } catch (e) {
                        console.error("Error parsing tool arguments", e);
                    }

                    thoughts.push({
                        stage: 'action',
                        text: `Executing tool '${functionName}' to search the in-memory database...`,
                        details: functionArgs,
                        timestamp: new Date()
                    });

                    const result = await this.executeFunction(functionName, functionArgs);

                    let resultSummary = "Data retrieved successfully";
                    if (result.error) resultSummary = `Error: ${result.error}`;
                    else if (result.found === false) resultSummary = result.message || "No data found";
                    else if (Array.isArray(result)) resultSummary = `Retrieved ${result.length} items`;
                    else if (result.total_occurrences) resultSummary = `Analyzed ${result.total_occurrences} occurrences`;
                    else if (result.alarm_statistics) resultSummary = `Statistics retrieved for ${Object.keys(result.alarm_statistics).length} tags`;
                    else if (result.pattern_type) resultSummary = `Found ${result.count || (result.sequences ? result.sequences.length : 0)} ${result.pattern_type}`;
                    else if (result.moves_analyzed) resultSummary = `Analyzed ${result.moves_analyzed} simulation moves against history`;
                    else if (result.success && functionName === "generate_compliance_report") resultSummary = "Report PDF Generated Successfully";

                    thoughts.push({
                        stage: 'observation',
                        text: `Tool execution complete. ${resultSummary}. Adding data to context.`,
                        data: resultSummary,
                        timestamp: new Date()
                    });

                    // Add tool result to messages for next turn
                    // For Responses API, we likely need to append these to input
                    toolResults.push({
                        type: "tool_result",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(result, null, 2)
                    });
                }

                // Add Assistant's tool call message + Tool Results to history
                // In Responses API "input", we need to sequence: user -> assistant(tool_calls) -> tool_result
                // Construct the "assistant" message part from the output items for history
                // But simplified: we just push the tool results to the new request's input

                // Add the tool calls themselves to the history (as assistant message)
                inputMessages.push({
                    type: "message",
                    role: "assistant",
                    content: [], // Usually null content for tool calls in Chat Completions, but here array
                    tool_calls: toolCallItems.map(tc => ({
                        id: tc.id,
                        type: "function",
                        function: tc.function || { name: tc.tool_name, arguments: JSON.stringify(tc.tool_args) }
                    }))
                });

                // Add results
                toolResults.forEach(tr => inputMessages.push(tr));

                thoughts.push({
                    stage: 'synthesis',
                    text: 'All data retrieved. Feeding results back to LLM for final response.',
                    timestamp: new Date()
                });

                console.log('[Chatbot] Making final API call with function results...');

                // Build final request body with model-appropriate params
                // Note: System prompt (chatbot persona) is now injected server-side in /api/chat/follow-up
                const isReasoningFinal = this.isReasoningModel();
                const finalRequestBody = {
                    model: this.config.generalDeploymentName || this.config.deploymentName,
                    input: inputMessages,
                    tools: this.getToolDefinitions(),
                    tool_choice: "none",
                    temperature: isReasoningFinal ? 1 : 0.5
                };

                if (isReasoningFinal) {
                    finalRequestBody.max_output_tokens = 16000;
                    finalRequestBody.reasoning_effort = this.config.reasoningEffort;
                } else {
                    finalRequestBody.max_output_tokens = 1500;
                }

                const finalResponse = await fetch('/api/chat/follow-up', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        inputMessages: finalRequestBody.input,
                        tools: this.getToolDefinitions(),
                        modelConfig: {
                            deploymentType: 'general',
                            reasoningEffort: this.config.reasoningEffort
                        }
                    })
                });

                if (!finalResponse.ok) {
                    const errorData = await finalResponse.json();
                    throw new Error(`Final API request failed: ${finalResponse.status} - ${errorData.error || 'Unknown error'}`);
                }

                const finalData = await finalResponse.json();

                // Parse final message
                const finalOutputItems = finalData.output || [];
                const finalMessageItem = finalOutputItems.find(item => item.type === 'message');
                const finalTextContent = finalMessageItem ? finalMessageItem.content.find(c => c.type === 'output_text') : { text: '' };

                return {
                    type: 'response',
                    text: this.formatMessageContent(finalTextContent.text),
                    thoughts: thoughts
                };

            } else {
                console.log('[Chatbot] No function call needed. Direct response.');

                thoughts.push({
                    stage: 'direct_response',
                    text: 'The model determined that no external tools were needed.',
                    timestamp: new Date()
                });

                const messageItem = outputItems.find(item => item.type === 'message');
                const textContent = messageItem ? messageItem.content.find(c => c.type === 'output_text') : { text: '' };

                return {
                    type: 'response',
                    text: this.formatMessageContent(textContent.text),
                    thoughts: thoughts
                };
            }
        } catch (error) {
            console.error('[Chatbot] Error in sendMessage:', error);
            return {
                type: 'error',
                text: this.formatMessageContent('An error occurred while processing your request. Please check the console for details.'),
                thoughts: thoughts,
                error: error.message
            };
        }
    },

    analyzeAlarm: async function (alarmTag, sessions) {
        this.setSessionData(sessions);
        const response = await this.sendMessage(`Analyze alarm ${alarmTag}`);
        return response.text;
    },
    analyzeSession: async function (sessionId, sessions) {
        this.setSessionData(sessions);
        const response = await this.sendMessage(`Analyze session ${sessionId}`);
        return response.text;
    },

    // --- D&R AUTO-PILOT PARSERS ---

    extractPhilosophyRules: async function (text) {
        console.log('[Chatbot] Extracting Philosophy Rules...');
        console.log(`[Chatbot] PDF text length: ${text.length} characters`);

        try {
            // Call backend API (backend handles truncation if needed)
            const response = await fetch('/api/chat/extract-philosophy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pdfText: text  // Send full text, backend will truncate if necessary
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }

            const data = await response.json();

            // Check if truncation occurred
            if (data.wasTruncated) {
                console.warn(`[Chatbot] PDF was truncated from ${data.originalLength} to ${data.truncatedLength} characters (${Math.round(data.truncatedLength / data.originalLength * 100)}% processed)`);
                // Display user notification
                if (window.addLog) {
                    window.addLog(`⚠️ Philosophy document was truncated: ${Math.round(data.truncatedLength / data.originalLength * 100)}% of content processed (${data.originalLength} → ${data.truncatedLength} chars)`);
                }
            }

            // Updated response parsing
            const messageOutput = data.output.find(item => item.type === 'message');
            const textContent = messageOutput ? messageOutput.content.find(c => c.type === 'output_text') : null;
            let content = textContent ? textContent.text : '';

            // Clean up markdown code blocks if present
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();

            return JSON.parse(content);
        } catch (error) {
            console.error("Philosophy Parsing Failed:", error);
            throw new Error("Failed to parse Alarm Philosophy. Please check API configuration.");
        }
    },

    enrichWithSafetyData: async function (tagList, safetyText) {
        console.log('[Chatbot] Enriching Safety Data (High-Fidelity)...');
        console.log(`[Chatbot] Safety document length: ${safetyText.length} characters`);

        try {
            // Call backend API (backend handles truncation if needed)
            const response = await fetch('/api/chat/enrich-safety', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    safetyText: safetyText  // Send full text, backend will truncate if necessary
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }

            const data = await response.json();

            // Check if truncation occurred
            if (data.wasTruncated) {
                console.warn(`[Chatbot] Safety document was truncated from ${data.originalLength} to ${data.truncatedLength} characters (${Math.round(data.truncatedLength / data.originalLength * 100)}% processed)`);
                // Display user notification
                if (window.addLog) {
                    window.addLog(`⚠️ Safety document was truncated: ${Math.round(data.truncatedLength / data.originalLength * 100)}% of content processed (${data.originalLength} → ${data.truncatedLength} chars)`);
                }
            }

            // Updated response parsing
            const messageOutput = data.output.find(item => item.type === 'message');
            const textContent = messageOutput ? messageOutput.content.find(c => c.type === 'output_text') : null;
            let content = textContent ? textContent.text : '';

            content = content.replace(/```json/g, '').replace(/```/g, '').trim();

            return JSON.parse(content);
        } catch (error) {
            console.error("Safety Parsing Failed:", error);
            return []; // Return empty list on failure to allow process to continue
        }
    }
};