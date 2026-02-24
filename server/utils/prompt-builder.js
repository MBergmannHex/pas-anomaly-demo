/**
 * Prompt Builder Utility
 * Assembles complex AI prompts from structured data for D&R rationalization
 */

// Alarm level detection — mirrors dr-processor.js getAlarmLevel() logic (server-side copy).
// Returns 2 for HH/LL, 1 for H/L, 0 for non-threshold alarms.
function getAlarmLevel(alarmDisplayName) {
    if (!alarmDisplayName) return 0;
    const name = alarmDisplayName.toUpperCase();
    if (/HIGHHIGH/.test(name)) return 2;
    if (/LOWLOW/.test(name))   return 2;
    if (/HIHI/.test(name))     return 2;
    if (/LOLO/.test(name))     return 2;
    if (/HH$/.test(name))      return 2;
    if (/LL$/.test(name))      return 2;
    if (/HIGH/.test(name))     return 1;
    if (/LOW/.test(name))      return 1;
    if (/HI$/.test(name))      return 1;
    if (/LO$/.test(name))      return 1;
    return 0;
}

/**
 * Find tags in the batch that have both a H/L alarm and a HH/LL alarm.
 * Returns an array of tag strings, or empty array if no such pairs exist.
 */
function detectHHLLPairs(alarms) {
    const tagLevels = {};
    alarms.forEach(a => {
        const tag = a.Tag || a.tag || '';
        const level = getAlarmLevel(a.AlarmDisplayName || a.alarmDisplayName || '');
        if (!tagLevels[tag]) tagLevels[tag] = new Set();
        tagLevels[tag].add(level);
    });
    return Object.entries(tagLevels)
        .filter(([, levels]) => levels.has(1) && levels.has(2))
        .map(([tag]) => tag);
}

// Category keywords that indicate a philosophy rule is relevant to per-alarm rationalization.
// Used as fallback when philosophyRules.site_specific_rules is absent (e.g., legacy extractions).
const RATIONALIZATION_RULE_KEYWORDS = [
    'alarm objective',
    'alarm definition',
    'alarm qualification',
    'priority determination',
    'priority levels',
    'consequence assessment',
    'rationalization guidance',
    'response time',
    'pre-alarm',
    'pre-trip',
    'bad value',
    'esd valve',
    'gas detection',
    'building alarms',
    'duplicate alarms',
    'trip vs',
    'trips / initiator',
    'voting',
    'redundant',
    'manual task',
];

/**
 * Extract rationalization-relevant rules from a philosophy object.
 * Prefers philosophyRules.site_specific_rules (new extractions).
 * Falls back to filtering philosophyRules.rules by category keywords (legacy extractions).
 * Returns null if no rules are available.
 * @param {Object} philosophyRules
 * @returns {Array|null}
 */
function extractSiteSpecificRules(philosophyRules) {
    if (!philosophyRules) return null;

    // Prefer explicitly curated subset from new extractions
    if (Array.isArray(philosophyRules.site_specific_rules) && philosophyRules.site_specific_rules.length > 0) {
        return philosophyRules.site_specific_rules;
    }

    // Fallback: filter full rules array by relevant category keywords
    if (Array.isArray(philosophyRules.rules) && philosophyRules.rules.length > 0) {
        const filtered = philosophyRules.rules.filter(r => {
            if (!r.category) return false;
            const cat = r.category.toLowerCase();
            return RATIONALIZATION_RULE_KEYWORDS.some(kw => cat.includes(kw));
        });
        return filtered.length > 0 ? filtered : null;
    }

    return null;
}

/**
 * Build the user prompt for batch rationalization
 * @param {Object} data - Structured input data
 * @param {Array} data.alarms - Array of alarm objects to rationalize
 * @param {String} data.processContext - Process description
 * @param {Object} data.philosophyRules - Extracted philosophy rules (priority_matrix, severity_matrix, site_specific_rules)
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

    // Build philosophy rules context (matrices + site-specific rationalization rules)
    let rulesContext = '';
    if (philosophyRules) {
        rulesContext = `\nPhilosophy Rules:\n- Priority Matrix: ${JSON.stringify(philosophyRules.priority_matrix || [])}\n- Severity Matrix: ${JSON.stringify(philosophyRules.severity_matrix || [])}`;

        const siteRules = extractSiteSpecificRules(philosophyRules);
        if (siteRules) {
            const ruleLines = siteRules.map(r => `  [${r.id}] ${r.category}: ${r.rule}`).join('\n');
            rulesContext += `\n- Site-Specific Rationalization Rules (apply these when relevant):\n${ruleLines}`;
        }
    }

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

    // Build HH/LL processing-order instruction when the batch contains paired alarms
    const hhllPairTags = detectHHLLPairs(alarms);
    const hhllOrderInstruction = hhllPairTags.length > 0
        ? `\n\nPROCESSING ORDER — H/L BEFORE HH/LL: This batch contains single-threshold (H/L) and double-threshold (HH/LL) alarms on the same tag(s): ${hhllPairTags.join(', ')}. For each of these tags, rationalize the H/L alarm FIRST, then use its cause/consequence/priority as the baseline for the corresponding HH/LL alarm. The HH/LL alarm MUST represent a clear escalation: more severe consequence if ignored, shorter maximum response time, and equal or higher priority compared to its H/L counterpart. If no meaningful escalation is possible, recommend REMOVE for the HH/LL alarm.\n`
        : '';

    // Assemble final user prompt
    const userPrompt = `Process Context: ${processContext || 'Industrial process equipment'}
${rulesContext}${processAnalysisContext}${referenceContext}${previousContext}${prioritySchemeInstruction}${hhllOrderInstruction}
Alarms to rationalize:
${alarmList}

Generate rationalization for ALL ${alarms.length} alarms.

CRITICAL REASONING REQUIREMENTS:
- In your Reasoning field, ALWAYS clearly state the source of your priority decision
- If based on a D&R-complete reference alarm, cite it: "Based on reference alarm [AlarmName]..."
- If based on philosophy rules/matrix, cite it: "Per philosophy matrix: [consequence] + [response time] = [priority]"
- If based on DCS platform preset rules from prompt knowledge, cite it: "Per [Platform] preset: [rule applied]"
- If based on Combination Alarm, ESD Bypass, or Rate of Change rules, cite the specific rule section
- If a HH/LL alarm is based on its H/L counterpart in this batch, cite it: "Escalation of [AlarmName] H/L rationalization"`;

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
