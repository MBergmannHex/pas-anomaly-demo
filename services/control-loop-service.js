// Global namespace for Control Loop Performance Monitoring (CLPM) service
window.controlLoopService = {
    // Configuration matches chatbot service to reuse credentials
    config: {
        apiKey: localStorage.getItem('chatbotApiKey') || '',
        endpoint: localStorage.getItem('chatbotEndpoint') || '',
        deploymentName: localStorage.getItem('chatbotDeploymentName') || 'gpt-4',
        apiVersion: localStorage.getItem('chatbotApiVersion') || '2024-02-15-preview'
    },

    /**
     * Main Entry Point: Analyzes a specific tag across provided sessions for control loop performance issues.
     * @param {string} tag - The tag to analyze. Can be a Base Tag (TIC-101) or Composite (TIC-101 HI_ALM).
     * @param {Array} sessions - The sessions containing data for this tag
     * @returns {Promise<Object>} - Diagnostic report
     */
    analyzeLoopPerformance: async function (tag, sessions) {
        // 1. Normalize Tag: If user provides "LT50740 COMM_ALM", we must identify "LT50740" 
        // to find the associated Setpoint/Output changes.
        const baseTag = this._deriveBaseTag(tag, sessions);
        console.log(`[ControlLoop] Analyzing request for "${tag}". Derived Base Tag: "${baseTag}"`);

        // 2. Aggregate all relevant events using the Base Tag
        const relevantEvents = this._gatherEventsForLLM(baseTag, sessions);

        if (relevantEvents.length === 0) {
            return {
                status: 'no_data',
                message: `No detailed event logs found for ${tag} (Base: ${baseTag}) to analyze control performance.`
            };
        }

        // 3. Call Sub-Agent (LLM) to parse text into numbers
        const extractedChanges = await this._extractValuesWithLLM(baseTag, relevantEvents);

        // 4. Perform Mathematical Analysis (Deterministic Logic)
        const diagnosis = this._calculateOscillation(baseTag, extractedChanges, sessions);

        return diagnosis;
    },

    /**
     * Helper: Derives the Base Tag from a specific input.
     * E.g., "LT50740 COMM_ALM" -> "LT50740"
     */
    _deriveBaseTag: function (inputTag, sessions) {
        // Strategy 1: Check if the input matches a known 'baseTag' in the session data
        for (const session of sessions) {
            const event = session.events.find(e => e.tag === inputTag);
            if (event && event.baseTag) {
                return event.baseTag;
            }
        }

        // Strategy 2: Heuristic - Split by space and take the first part if it looks like a tag
        // (Matches logic in data-service.js)
        if (inputTag.includes(' ')) {
            return inputTag.split(' ')[0];
        }

        // Strategy 3: Fallback - use input as is
        return inputTag;
    },

    /**
     * Prepares raw event logs for the LLM extractor.
     * Uses the Base Tag to capture ALL aspects of the loop (Alarms AND Actions).
     */
    _gatherEventsForLLM: function (baseTag, sessions) {
        const events = [];
        const seenTimestamps = new Set();

        sessions.forEach(session => {
            session.events.forEach(e => {
                // Check matches against Base Tag to ensure we catch Actions (SP changes) 
                // even if the user queried the Alarm Tag.
                const isMatch = e.tag === baseTag ||
                    e.tag.startsWith(baseTag) ||
                    (e.baseTag && e.baseTag === baseTag);

                if (isMatch) {
                    // We are interested in 'Change' events or events with descriptions
                    if (e.isChange || e.Desc1 || e.Desc2 || e.description) {
                        // Avoid duplicates
                        if (!seenTimestamps.has(e.timestamp)) {
                            seenTimestamps.add(e.timestamp);

                            // Construct a readable string for the LLM
                            const desc = [e.Desc1, e.Desc2, e.description, e.message]
                                .filter(d => d && d.trim() !== '').join(' | ');

                            if (desc || e.isChange) {
                                events.push({
                                    id: events.length,
                                    timestamp: e.timestamp,
                                    text: `Time: ${new Date(e.timestamp).toISOString()} | Tag: ${e.tag} | Event: ${e.isChange ? 'Action' : 'Alarm'} | Text: ${desc}`
                                });
                            }
                        }
                    }
                }
            });
        });

        // Limit to recent/relevant history to save tokens (max 50 significant events)
        return events.slice(-50);
    },

    /**
     * The "Extractor Sub-Agent".
     * Uses LLM to parse unstructured operator logs into structured numerical data.
     */
    _extractValuesWithLLM: async function (tag, logEntries) {
        console.log(`[ControlLoop] sending ${logEntries.length} logs to LLM for value extraction`);

        const systemPrompt = `You are a Control Loop Data Parser. 
        Your ONLY job is to extract numerical changes from log messages for loop "${tag}".
        
        Look for:
        1. Set Point (SP) changes (e.g., "SP changed to 50", "Set 50.5", "Tag: ${tag} SP")
        2. Output (OP) changes (e.g., "Output 10%", "Manual 55", "Tag: ${tag} CV")
        3. Mode changes (e.g., "Auto to Manual")
        
        Return a raw JSON array ONLY. No markdown, no explanation.
        Format: [{"timestamp": number, "type": "SP"|"OP"|"MODE", "old_val": number|null, "new_val": number|string}]
        
        If a log entry has no relevant control change, ignore it.`;

        const userPrompt = `Analyze these logs:\n${logEntries.map(e => e.text).join('\n')}`;

        try {
            // Updated to Responses API endpoint
            const response = await fetch(`${this.config.endpoint}/openai/v1/responses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'api-key': this.config.apiKey },
                body: JSON.stringify({
                    model: this.config.deploymentName,
                    input: [{ type: "message", role: "user", content: userPrompt }],
                    instructions: systemPrompt,
                    temperature: 0, // Deterministic output desired
                    max_output_tokens: 1000,
                    response_format: { type: "text" }
                })
            });

            const data = await response.json();

            // Updated response parsing
            const messageOutput = data.output.find(item => item.type === 'message');
            const textContent = messageOutput ? messageOutput.content.find(c => c.type === 'output_text') : null;
            let content = textContent ? textContent.text : '';

            // Clean potential markdown wrapping
            const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr);

        } catch (error) {
            console.error('[ControlLoop] Extraction failed:', error);
            return []; // Fail gracefully
        }
    },

    /**
     * The "Math Engine".
     * Correlates the extracted setpoint changes with subsequent alarm behavior.
     */
    _calculateOscillation: function (baseTag, changes, sessions) {
        // Flatten all alarms for this LOOP (using baseTag)
        const allAlarms = [];
        sessions.forEach(s => {
            s.events.forEach(e => {
                if (e.isAlarm && (e.tag.startsWith(baseTag) || e.baseTag === baseTag)) {
                    allAlarms.push(e);
                }
            });
        });
        allAlarms.sort((a, b) => a.timestamp - b.timestamp);

        const issues = [];
        let oscillationDetected = false;

        // Analyze each control change found by the LLM
        changes.forEach(change => {
            // Define a "Reaction Window" (e.g., 15 minutes after the change)
            const windowStart = new Date(change.timestamp).getTime();
            const windowEnd = windowStart + (15 * 60 * 1000);

            const subsequentAlarms = allAlarms.filter(a =>
                a.timestamp > windowStart && a.timestamp < windowEnd
            );

            // Logic 1: Check for "Ringing" (Step Response Instability)
            if (subsequentAlarms.length >= 3) {
                const uniqueAlarmTypes = new Set(subsequentAlarms.map(a => a.tag));

                if (uniqueAlarmTypes.size >= 1) {
                    issues.push({
                        type: "Ringing / Aggressive Tuning",
                        confidence: "High",
                        evidence: `After changing ${change.type} to ${change.new_val}, the loop generated ${subsequentAlarms.length} alarms (${Array.from(uniqueAlarmTypes).join(', ')}) within 15 minutes.`,
                        recommendation: "Check PID tuning (Gain/Integral). The loop is overshootng the new setpoint."
                    });
                    oscillationDetected = true;
                }
            }

            // Logic 2: Check for "Constraint Hugging"
            if (subsequentAlarms.length > 0 && change.type === 'SP') {
                const timeToFirstAlarm = subsequentAlarms[0].timestamp - windowStart;
                if (timeToFirstAlarm < 2 * 60 * 1000) {
                    issues.push({
                        type: "Constraint Violation",
                        confidence: "Medium",
                        evidence: `Alarm ${subsequentAlarms[0].tag} triggered ${Math.round(timeToFirstAlarm / 1000)}s after Set Point change.`,
                        recommendation: "The new Set Point is too close to the alarm limit."
                    });
                }
            }
        });

        // Logic 3: Detect Pure Oscillation (Limit Cycle) independent of specific changes
        if (allAlarms.length > 10) {
            let intervals = [];
            for (let i = 1; i < allAlarms.length; i++) {
                if (allAlarms[i].timestamp - allAlarms[i - 1].timestamp < 20 * 60 * 1000) {
                    intervals.push(allAlarms[i].timestamp - allAlarms[i - 1].timestamp);
                }
            }

            if (intervals.length > 5) {
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                const variance = intervals.reduce((a, b) => a + Math.pow(b - avgInterval, 2), 0) / intervals.length;
                const stdDev = Math.sqrt(variance);

                if (stdDev < avgInterval * 0.2) {
                    issues.push({
                        type: "Limit Cycle Oscillation",
                        confidence: "High",
                        evidence: `Detected periodic alarming every ~${Math.round(avgInterval / 1000 / 60)} minutes regardless of operator changes.`,
                        recommendation: "Likely Stiction in the valve or aggressive I-term tuning."
                    });
                }
            }
        }

        return {
            tag: baseTag,
            input_tag: baseTag !== arguments[0] ? arguments[0] : baseTag,
            analysis_timestamp: new Date().toISOString(),
            events_analyzed: changes.length,
            issues_detected: issues,
            raw_changes: changes,
            summary: issues.length > 0
                ? `Detected ${issues.length} control performance issues for loop ${baseTag}.`
                : `Control loop ${baseTag} appears stable relative to operator actions.`
        };
    },

    /**
     * Helper to get the tool definition for the Chatbot
     */
    getToolDefinition: function () {
        return {
            type: "function",
            function: {
                name: "analyze_control_loop",
                description: "Specialized analysis for control loops. Use this to check stability, oscillation, or tuning issues. You MUST provide the FULL tag name exactly as it appears in the data (e.g., 'LT50740 COMM_ALM'). The system will automatically derive the base controller tag to find correlated actions.",
                parameters: {
                    type: "object",
                    properties: {
                        tag: {
                            type: "string",
                            description: "The FULL tag name to analyze (e.g. 'LT50740 COMM_ALM')"
                        }
                    },
                    required: ["tag"]
                }
            }
        };
    }
};