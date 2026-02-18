/**
 * Prompt Builder Utility
 * Assembles complex AI prompts from structured data for D&R rationalization
 */

/**
 * Build the user prompt for batch rationalization
 * @param {Object} data - Structured input data
 * @param {Array} data.alarms - Array of alarm objects to rationalize
 * @param {String} data.processContext - Process description
 * @param {Object} data.philosophyRules - Extracted philosophy rules (priority_matrix, severity_matrix)
 * @param {Object} data.processAnalysis - Process analysis results (optional)
 * @param {Array} data.referenceAlarms - D&R-complete reference alarms (optional)
 * @param {Array} data.previousDrafts - Previously drafted alarms in this batch (optional)
 * @param {String} data.detectedPriorityScheme - 'descriptive' or 'numeric'
 * @returns {String} - Assembled user prompt
 */
function buildBatchRationalizationPrompt(data) {
    const {
        alarms,
        processContext,
        philosophyRules,
        processAnalysis,
        referenceAlarms,
        previousDrafts,
        detectedPriorityScheme
    } = data;

    // Build alarm list with full alarm names
    const alarmList = alarms.map((a, i) => {
        const fullName = getFullAlarmName(a);
        const desc = a.Description || a.description || '';
        return `${i + 1}. Full Alarm Name: ${fullName}\n   Description: ${desc}`;
    }).join('\n\n');

    // Build philosophy rules context
    const rulesContext = philosophyRules ?
        `\nPhilosophy Rules:\n- Priority Matrix: ${JSON.stringify(philosophyRules.priority_matrix || [])}\n- Severity Matrix: ${JSON.stringify(philosophyRules.severity_matrix || [])}`
        : '';

    // Build process analysis context
    let processAnalysisContext = '';
    if (processAnalysis) {
        processAnalysisContext = `\n\n## PROCESS ANALYSIS CONTEXT (Use for process-focused Causes and Consequences)\n`;
        processAnalysisContext += `Process Summary: ${processAnalysis.process_summary || 'Not available'}\n\n`;

        if (processAnalysis.failure_patterns) {
            processAnalysisContext += `### Typical Failure Patterns by Equipment Type:\n`;
            Object.entries(processAnalysis.failure_patterns).forEach(([eqType, patterns]) => {
                processAnalysisContext += `**${eqType}**:\n`;
                if (Array.isArray(patterns)) {
                    patterns.forEach(p => {
                        processAnalysisContext += `- Cause: ${p.cause} → Consequence: ${p.consequence}\n`;
                    });
                }
            });
            processAnalysisContext += '\n';
        }

        if (processAnalysis.guidance_for_d_and_r) {
            processAnalysisContext += `### D&R Guidance:\n${processAnalysis.guidance_for_d_and_r}\n`;
        }

        processAnalysisContext += `\nIMPORTANT: Use specific process conditions from the failure patterns above (e.g., "Plugged strainer", "Pump tripped", "Loss of cooling water") rather than generic alarm descriptions.\n`;
    }

    // Build reference alarms context
    let referenceContext = '';
    if (referenceAlarms && referenceAlarms.length > 0) {
        const examples = referenceAlarms.map(a => {
            const fullName = getFullAlarmName(a);
            return `- ${fullName}:\n    Cause: ${a.Cause1 || 'N/A'}\n    Consequence: ${a.Consequence1 || 'N/A'}\n    Corrective Action: ${a['Corrective Action1'] || 'N/A'}\n    Priority: ${a['Proposed Priority'] || a.Priority || 'N/A'}`;
        }).join('\n');
        referenceContext = `\n\nREFERENCE ALARMS (D&R Complete - use as templates for similar alarms):\n${examples}\nIMPORTANT: When you use a reference alarm's pattern, cite it in your Reasoning like: "Based on similar alarm [AlarmName]..."\n`;
    }

    // Build previously drafted alarms context
    let previousContext = '';
    if (previousDrafts && previousDrafts.length > 0) {
        const prevSummary = previousDrafts.map(r =>
            `- ${r.fullAlarmName}: Priority=${r.draft['Proposed Priority']}, ResponseTime=${r.draft['Max Time to Respond']}`
        ).join('\n');
        previousContext = `\n\nPREVIOUSLY DRAFTED ALARMS ON SAME TAGS (for consistency):\n${prevSummary}\nEnsure new alarms on the same tag use consistent priority logic.\n`;
    }

    // Build priority scheme instruction
    let prioritySchemeInstruction = '';
    if (philosophyRules && philosophyRules.priority_matrix && philosophyRules.priority_matrix.length > 0) {
        // Extract unique priority values from the matrix
        const uniquePriorities = [...new Set(philosophyRules.priority_matrix.map(item => item.priority))];
        const priorityList = uniquePriorities.map(p => `"${p}"`).join(', ');
        prioritySchemeInstruction = `\n\nCRITICAL - PRIORITY VALUES: You MUST use ONLY these exact priority values from the philosophy priority matrix: ${priorityList}. Also include "REMOVE" when applicable. Do NOT use any other priority naming (no "Priority 1/2/3" unless those exact strings are in the list above).\n`;
    } else {
        // Fallback to detected scheme if no priority matrix
        prioritySchemeInstruction = detectedPriorityScheme === 'descriptive'
            ? `\n\nIMPORTANT - PRIORITY NAMING: The source data uses DESCRIPTIVE priority names (High, Medium, Low, Urgent, etc.). Your Proposed Priority values MUST use the same descriptive naming style (e.g., "High", "Medium", "Low", "Urgent", "None", "Remove"). Do NOT use numeric priority names like "Priority 1" for this dataset.\n`
            : `\n\nIMPORTANT - PRIORITY NAMING: The source data uses NUMERIC priority names (Priority 1, Priority 2, Priority 3, etc.). Your Proposed Priority values MUST use the same numeric naming style (e.g., "Priority 1", "Priority 2", "Priority 3", "No Alarm", "Remove"). Do NOT use descriptive names like "High" for this dataset.\n`;
    }

    // Assemble final user prompt
    const userPrompt = `Process Context: ${processContext || 'Industrial process equipment'}
${rulesContext}${processAnalysisContext}${referenceContext}${previousContext}${prioritySchemeInstruction}
Alarms to rationalize:
${alarmList}

Generate rationalization for ALL ${alarms.length} alarms.

CRITICAL REASONING REQUIREMENTS:
- In your Reasoning field, ALWAYS clearly state the source of your priority decision
- If based on a D&R-complete reference alarm, cite it: "Based on reference alarm [AlarmName]..."
- If based on philosophy rules/matrix, cite it: "Per philosophy matrix: [consequence] + [response time] = [priority]"
- If based on vendor preset rules from prompt knowledge, cite it: "Per [Vendor] preset: [rule applied]"
- If based on Combination Alarm, ESD Bypass, or Rate of Change rules, cite the specific rule section`;

    return userPrompt;
}

/**
 * Helper function to build full alarm name from alarm object
 * Matches frontend logic in dr-processor.js
 */
function getFullAlarmName(alarm) {
    const tag = alarm.Tag || alarm.tag || '';
    const alarmType = alarm.AlarmDisplayName || alarm.alarmDisplayName || alarm['Alarm Display Name'] || '';
    return `${tag} ${alarmType}`.trim();
}

module.exports = {
    buildBatchRationalizationPrompt
};
