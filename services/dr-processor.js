/**
 * D&R Processor Service - ISA 18.2 / IEC 62682 Compliant
 * Enhanced with PDF parsing, batch processing, value propagation
 */
window.drProcessor = {
    // Fields that CAN be filled in by AI or propagated from D&R complete records
    PROPAGATABLE_FIELDS: [
        'Max Time to Respond', 'Max Response Time', 'Proposed Priority', 'Override Priority', 'Override Reason'
    ],

    // Fields that AI generates (finds next available slot)
    AI_GENERATED_FIELDS: ['Cause', 'Consequence', 'Corrective Action', 'Verification'],

    // Priority scheme mappings for adaptive priority naming
    PRIORITY_SCHEMES: {
        numeric: ['Priority 1', 'Priority 2', 'Priority 3', 'No Alarm', 'Remove', 'Diagnostic', 'Journal'],
        descriptive: ['Urgent', 'High', 'Medium', 'Low', 'None', 'Remove', 'Diagnostic', 'Journal']
    },

    // Priority numeric values for comparison (higher number = lower urgency)
    PRIORITY_VALUES: {
        'priority 1': 1, 'urgent': 1, 'critical': 1, 'emergency': 1,
        'priority 2': 2, 'high': 2,
        'priority 3': 3, 'medium': 3,
        'low': 4, 'priority 4': 4,
        'diagnostic': 5, 'journal': 5, 'log': 5,
        'none': 6, 'no alarm': 6, 'remove': 7
    },

    // Alarm Display Name Dictionary - provides AI with domain knowledge
    ALARM_DISPLAY_NAMES: {
        "ABORT": { description: "Sequence Abort. The logic sequence or batch phase has been forced to stop execution immediately, often due to a safety condition or operator command.", synonyms: ["SEQ_ABORT", "Phase Abort"] },
        "ADVDEV": { description: "Advisory Deviation. The difference between the Process Variable (PV) and the Setpoint (SP) has exceeded a limit intended for operator advisory rather than critical action.", synonyms: ["ADVD", "Advisory Dev"] },
        "BAD PV": { description: "Bad Process Variable. The input signal from the sensor is invalid, out of range, or has bad status (e.g., broken wire, transmitter failure).", synonyms: ["Bad Input", "Sensor Fail", "BAD_PV"] },
        "BADCTL": { description: "Bad Control. The control loop cannot execute properly, often because a secondary input is bad, the slot is inactive, or the output hardware is failing.", synonyms: ["Bad Control Action", "Loop Broken"] },
        "CHGOFST": { description: "Change of State. An alarm event triggered whenever a discrete signal transitions between current and new state. Change of state alarms are often inappropriate because at least one state typically does not indicate an abnormal condition requiring operator action.", synonyms: ["State Change", "COS", "Discrete Change"] },
        "CMDDIS": { description: "Command Disagree. The controller commanded a device (e.g., valve) to a state, but the feedback signal did not match the command within the specified time (e.g., Valve told to Open, but Limit Switch says Closed).", synonyms: ["Command Mismatch", "Valve Stiction", "Travel Alarm", "CMD_DIS"] },
        "CMFAIL": { description: "Command Fail. The output command could not be successfully transmitted or executed by the hardware/interface.", synonyms: ["CMD_FAIL", "Output Fail"] },
        "DEV": { description: "Deviation Alarm. The difference between the Process Variable (PV) and the Setpoint (SP) exceeds the configured deviation limit.", synonyms: ["DEV_ALM", "Error Alarm"] },
        "DEVCTLA.OFFNRMPVALM": { description: "Device Control A - Off Normal PV Alarm. A specific control module (DEVCTLA) is reporting that its process variable is not in the expected 'Normal' state (e.g., a valve is open when it should be closed).", synonyms: ["Device Off Normal", "State Mismatch"] },
        "DEVCTLA_B3.OFFNRMPVALM": { description: "Device Control B3 - Off Normal PV Alarm. Instance 'B3' of the Device Control module is in an off-normal state.", synonyms: ["Unit B3 Off Normal"] },
        "DEVCTLA_B3_ANL.OFFNRMPVALM": { description: "Device Control B3 Analog - Off Normal PV Alarm. The analog component of the B3 Device Control module is in an off-normal state.", synonyms: ["B3 Analog Off Normal"] },
        "DEVCTLA_OME.OFFNRMPVALM": { description: "Device Control OME - Off Normal PV Alarm. Instance 'OME' of the Device Control module is in an off-normal state.", synonyms: ["OME Off Normal"] },
        "DEVCTLA_P5.OFFNRMPVALM": { description: "Device Control P5 - Off Normal PV Alarm. Instance 'P5' (likely Pump 5) of the Device Control module is in an off-normal state.", synonyms: ["Pump 5 Off Normal"] },
        "DEVCTLA_P5_ANL.OFFNRMPVALM": { description: "Device Control P5 Analog - Off Normal PV Alarm. The analog component of the P5 Device Control module is in an off-normal state.", synonyms: ["P5 Analog Off Normal"] },
        "DEVCTLA_P9.OFFNRMPVALM": { description: "Device Control P9 - Off Normal PV Alarm. Instance 'P9' (likely Pump 9) of the Device Control module is in an off-normal state.", synonyms: ["Pump 9 Off Normal"] },
        "DEVCTLA_R3.OFFNRMPVALM": { description: "Device Control R3 - Off Normal PV Alarm. Instance 'R3' (likely Reactor 3) of the Device Control module is in an off-normal state.", synonyms: ["R3 Off Normal"] },
        "DEVCTLA_R4.OFFNRMPVALM": { description: "Device Control R4 - Off Normal PV Alarm. Instance 'R4' (likely Reactor 4) of the Device Control module is in an off-normal state.", synonyms: ["R4 Off Normal"] },
        "DEVCTLA_R6.OFFNRMPVALM": { description: "Device Control R6 - Off Normal PV Alarm. Instance 'R6' (likely Reactor 6) of the Device Control module is in an off-normal state.", synonyms: ["R6 Off Normal"] },
        "DEVCTLA_SS4.OFFNRMPVALM": { description: "Device Control SS4 - Off Normal PV Alarm. Instance 'SS4' (likely Sub-System 4) of the Device Control module is in an off-normal state.", synonyms: ["SS4 Off Normal"] },
        "DEVCTLA_SS45.OFFNRMPVALM": { description: "Device Control SS45 - Off Normal PV Alarm. Instance 'SS45' of the Device Control module is in an off-normal state.", synonyms: ["SS45 Off Normal"] },
        "DEVCTLA_SS54.OFFNRMPVALM": { description: "Device Control SS54 - Off Normal PV Alarm. Instance 'SS54' of the Device Control module is in an off-normal state.", synonyms: ["SS54 Off Normal"] },
        "DEVCTLA_T3.OFFNRMPVALM": { description: "Device Control T3 - Off Normal PV Alarm. Instance 'T3' (likely Tank 3) of the Device Control module is in an off-normal state.", synonyms: ["Tank 3 Off Normal"] },
        "DEVCTLA_T3_ANL.OFFNRMPVALM": { description: "Device Control T3 Analog - Off Normal PV Alarm. The analog component of the T3 Device Control module is in an off-normal state.", synonyms: ["T3 Analog Off Normal"] },
        "DEVCTLA_T4.OFFNRMPVALM": { description: "Device Control T4 - Off Normal PV Alarm. Instance 'T4' (likely Tank 4) of the Device Control module is in an off-normal state.", synonyms: ["Tank 4 Off Normal"] },
        "DEVCTLA_T6.OFFNRMPVALM": { description: "Device Control T6 - Off Normal PV Alarm. Instance 'T6' (likely Tank 6) of the Device Control module is in an off-normal state.", synonyms: ["Tank 6 Off Normal"] },
        "DEVCTLA_U09.OFFNRMPVALM": { description: "Device Control U09 - Off Normal PV Alarm. Instance 'U09' (likely Unit 09) of the Device Control module is in an off-normal state.", synonyms: ["Unit 09 Off Normal"] },
        "DEVHI": { description: "Deviation High. The Process Variable (PV) is higher than the Setpoint (SP) by an amount exceeding the High Deviation limit.", synonyms: ["DEV_HI", "High Deviation", "+DEV"] },
        "DEVLOW": { description: "Deviation Low. The Process Variable (PV) is lower than the Setpoint (SP) by an amount exceeding the Low Deviation limit.", synonyms: ["DEV_LO", "Low Deviation", "-DEV"] },
        "FAIL": { description: "Module Failure. A generic failure alarm indicating the control module, device, or hardware slot has failed.", synonyms: ["FAILURE", "HW_FAIL"] },
        "FLOWCOMPA.BADCOMPTERM": { description: "Flow Compensation A - Bad Compensation Term. A standard flow compensation block cannot calculate the corrected flow because one of its compensation inputs (usually Temperature or Pressure) has a 'Bad' status.", synonyms: ["Bad Comp Input", "Flow Calc Error"] },
        "HOLD": { description: "Sequence Hold. The automated sequence has been paused (held) and is waiting for an operator command to resume or abort.", synonyms: ["PAUSED", "Held"] },
        "OFFNRM": { description: "Off Normal. A discrete device is in a state other than its configured 'Normal' state (e.g., a switch configured to be normally Closed is now Open).", synonyms: ["Not Normal", "Unexpected State", "OFF_NORMAL"] },
        "OPHIGH": { description: "Output High Limit. The controller output (OP) has reached its maximum high limit (usually 100%). The loop is now saturated high.", synonyms: ["OPH", "Out High", "Windup High"] },
        "OPLOW": { description: "Output Low Limit. The controller output (OP) has reached its minimum low limit (usually 0%). The loop is now saturated low.", synonyms: ["OPL", "Out Low", "Windup Low"] },
        "OVRDI0": { description: "Override Interlock 0. An override logic condition (Input 0) is active, forcing the controller or device into a safe or fallback state.", synonyms: ["Override 0", "Interlock Active"] },
        "OVRDI1": { description: "Override Interlock 1. An override logic condition (Input 1) is active.", synonyms: ["Override 1"] },
        "OVRDI2": { description: "Override Interlock 2. An override logic condition (Input 2) is active.", synonyms: ["Override 2"] },
        "OVRDSI": { description: "Override Select Input. The controller has automatically switched to a different input source or control strategy due to an override condition.", synonyms: ["Override Select", "Sel Input"] },
        "PVHIGH": { description: "Process Variable High. The PV has exceeded the configured High Alarm limit.", synonyms: ["PV_HI", "High Alarm"] },
        "PVHIHI": { description: "Process Variable High-High. The PV has exceeded the Critical High (High-High) limit. Usually indicates a trip condition or safety hazard.", synonyms: ["PV_HH", "Critical High", "HiHi"] },
        "PVLOLO": { description: "Process Variable Low-Low. The PV has dropped below the Critical Low (Low-Low) limit. Usually indicates a trip condition or safety hazard.", synonyms: ["PV_LL", "Critical Low", "LoLo"] },
        "PVLOW": { description: "Process Variable Low. The PV has dropped below the configured Low Alarm limit.", synonyms: ["PV_LO", "Low Alarm"] },
        "ROCNEG": { description: "Rate of Change Negative. The PV is decreasing faster than the allowed negative rate limit.", synonyms: ["ROC Down", "Fall Rate Limit"] },
        "ROCPOS": { description: "Rate of Change Positive. The PV is increasing faster than the allowed positive rate limit.", synonyms: ["ROC Up", "Rise Rate Limit"] },
        "STEPTO": { description: "Step Timeout. A step in a batch or logic sequence has taken longer than the configured maximum time to complete.", synonyms: ["Sequence Timeout", "Phase Timeout"] },
        "STOP": { description: "Sequence Stop. The sequence has completed or has been stopped.", synonyms: ["SEQ_STOP"] },
        "UNCMD": { description: "Uncommanded Change. A field device (like a valve or motor) changed its state (e.g., Closed to Open) without receiving a command from the control system.", synonyms: ["Uncommanded Motion", "UCMD", "Drift"] },
        "UNCMDCHG": { description: "Uncommanded Change. The device changed state without a system command. Identical to UNCMD.", synonyms: ["Uncommanded Change", "Ghost Operation"] }
    },

    // Detected priority scheme (set during CSV parsing)
    detectedPriorityScheme: null,

    // ============================================
    // TAG PARSING & GROUPING FUNCTIONS
    // ============================================

    // ISA 5.1 First Letters (Measured / Initiating Variable)
    ISA_FIRST_LETTERS: {
        'A': 'Analysis', 'B': 'Burner/Combustion', 'C': 'Conductivity',
        'D': 'Density/Specific Gravity', 'E': 'Voltage (EMF)', 'F': 'Flow Rate',
        'G': 'Gauging/Gaging', 'H': 'Hand (Manual)', 'I': 'Current',
        'J': 'Power', 'K': 'Time/Time Schedule', 'L': 'Level',
        'M': 'Moisture/Humidity', 'N': 'User Choice', 'O': 'User Choice',
        'P': 'Pressure/Vacuum', 'Q': 'Quantity', 'R': 'Radiation',
        'S': 'Speed/Frequency', 'T': 'Temperature', 'U': 'Multivariable',
        'V': 'Vibration/Mechanical', 'W': 'Weight/Force', 'X': 'Unclassified',
        'Y': 'Event/State/Presence', 'Z': 'Position/Dimension'
    },

    // ISA 5.1 Succeeding Letters (Readout/Passive Function or Output/Active Function)
    ISA_SUCCEEDING_LETTERS: {
        'A': 'Alarm', 'C': 'Controller', 'D': 'Differential (modifier)',
        'E': 'Element (primary)', 'F': 'Ratio (modifier)', 'G': 'Glass/Gauge/Viewing',
        'H': 'High', 'I': 'Indicator', 'K': 'Control Station',
        'L': 'Light/Low', 'M': 'Middle/Momentary', 'N': 'User Choice',
        'O': 'Orifice/Restriction', 'P': 'Point (test)', 'Q': 'Integrate/Totalize',
        'R': 'Record', 'S': 'Switch/Safety', 'T': 'Transmit',
        'V': 'Valve/Damper/Louver', 'W': 'Well', 'X': 'Unclassified',
        'Y': 'Relay/Compute/Convert', 'Z': 'Actuator/Driver'
    },

    /**
     * Extract code letter from a tag using its Unit column value (Unit-Aware mode).
     * Algorithm:
     *   1. Try stripping the full unit value from the start of the tag
     *   2. If no match, try the base unit (before '_') 
     *   3. Extract leading letters from the remainder
     *   4. If unit doesn't match at all, fall back to first alphabetic segment
     * @param {string} tag - The full tag name
     * @param {string} unit - The Unit column value for this tag
     * @returns {string} Extracted code letter (uppercase)
     */
    extractCodeLetterFromUnit(tag, unit) {
        let processed = String(tag || '').trim().toUpperCase();
        const upperUnit = String(unit || '').trim().toUpperCase();

        // 1. Specific Optimization: If tag exactly starts with Unit, strip it immediately
        if (upperUnit && processed.startsWith(upperUnit)) {
            processed = processed.substring(upperUnit.length);
        }



        // 2. The Grinder: Iteratively strip leading non-letter noise (digits, spaces, symbols)
        // We loop because we might have "Digits - Digits Letter" (e.g. "01 - 01E...")
        let iterations = 0;
        let changed = true;
        while (changed && iterations < 5) { // Safety break
            changed = false;
            const original = processed;

            // Strip leading separators/spaces
            processed = processed.replace(/^[\s\-_]+/, '');

            // Strip leading digits
            processed = processed.replace(/^[0-9]+/, '');

            if (processed !== original) changed = true;
            iterations++;
        }

        // 3. Extract Leading Letters
        const match = processed.match(/^([A-Z]+)/);
        return match ? match[1] : (tag || '').trim();
    },



    /**
     * Validate whether a code letter conforms to ISA 5.1 naming convention.
     * @param {string} codeLetter - The extracted code letter (e.g., "TI", "FZV", "XLS")
     * @returns {Object} { valid: boolean, firstLetter: string, firstLetterDesc: string, 
     *                      succeedingLetters: Array<{letter, desc}>, description: string }
     */
    validateISACodeLetter(codeLetter) {
        if (!codeLetter || codeLetter.length === 0) {
            return { valid: false, description: 'Empty code letter' };
        }

        const upper = codeLetter.toUpperCase();
        const first = upper[0];
        const firstDesc = this.ISA_FIRST_LETTERS[first];

        if (!firstDesc) {
            return { valid: false, firstLetter: first, description: `'${first}' is not a valid ISA first letter` };
        }

        const succeeding = [];
        let allValid = true;

        for (let i = 1; i < upper.length; i++) {
            const letter = upper[i];
            const desc = this.ISA_SUCCEEDING_LETTERS[letter];
            if (desc) {
                succeeding.push({ letter, desc });
            } else {
                succeeding.push({ letter, desc: 'Not standard ISA' });
                allValid = false;
            }
        }

        const fullDesc = `${firstDesc}` + (succeeding.length > 0
            ? ' + ' + succeeding.map(s => s.desc).join(' + ')
            : '');

        return {
            valid: allValid,
            firstLetter: first,
            firstLetterDesc: firstDesc,
            succeedingLetters: succeeding,
            description: fullDesc
        };
    },

    /**
     * Generate a parsing rule from a user-provided example
     * @param {string} fullTag - The complete tag (e.g., "TI200A", "FIC-101")
     * @param {string} prefix - User-identified prefix (e.g., "TI", "FIC")
     * @returns {Object} Rule object with type and parsing instructions
     */
    deriveConsolidatedRule(examples) {
        if (!examples || examples.length === 0) return null;

        // Filter valid examples that roughly match the structure
        const validExamples = examples.filter(e => e.tag && e.prefix);
        if (validExamples.length === 0) return null;

        // Strategy 1: Common Delimiter
        // Check if all examples split by the same delimiter match the prefix
        const delimiters = ['-', '_', '.', '/', ':'];
        for (const char of delimiters) {
            const allMatch = validExamples.every(e => {
                const parts = e.tag.split(char);
                // Check if any part matches the prefix (to support 10-FI-001 -> FI)
                return parts.some(p => p.trim().toUpperCase() === e.prefix.trim().toUpperCase());
            });

            if (allMatch) {
                // If the prefix is always the FIRST part, standard delimiter rule
                const allFirst = validExamples.every(e => e.tag.split(char)[0].trim().toUpperCase() === e.prefix.trim().toUpperCase());
                if (allFirst) {
                    return { type: 'delimiter', char: char, description: `Split by '${char}'` };
                }
                // Otherwise custom regex to find the part
                return {
                    type: 'regex',
                    regex: `(?:^|[${char}])([A-Za-z0-9]+)(?:$|[${char}])`, // Match between delimiters
                    // We need to return the group that matches the prefix structure. 
                    // This is getting complex. Let's stick to standard delimiter if first part.
                    description: `Contains part separated by '${char}'`
                };
            }
        }

        // Strategy 2: Alpha/Numeric Boundary (Letters before Digits)
        // Use leadingLetters type for reliable extraction without regex
        const allLettersBeforeDigits = validExamples.every(e => {
            // Manual check: extract leading letters and compare
            let extractedPrefix = '';
            for (const char of e.tag.toUpperCase()) {
                if (char >= 'A' && char <= 'Z') {
                    extractedPrefix += char;
                } else {
                    break;
                }
            }
            return extractedPrefix === e.prefix.trim().toUpperCase();
        });
        if (allLettersBeforeDigits) {
            return { type: 'leadingLetters', description: 'Extract leading letters' };
        }

        // Strategy 3: Fixed Length
        const firstLen = validExamples[0].prefix.length;
        const allSameLength = validExamples.every(e => e.prefix.length === firstLen && e.tag.toUpperCase().startsWith(e.prefix.toUpperCase()));
        if (allSameLength) {
            return { type: 'fixedLength', length: firstLen, description: `First ${firstLen} characters` };
        }

        // Strategy 4: Specific Segment
        // Check if the prefix always matches the Nth segment (e.g. 3rd segment for T4PI30171C -> PI)
        // We check indices 1 to 10
        for (let i = 1; i <= 10; i++) {
            const allMatch = validExamples.every(e => {
                const segs = this.splitTagIntoSegments(e.tag);
                // Convert 1-based index to 0-based
                const seg = segs[i - 1];
                return seg && seg.toUpperCase() === e.prefix.toUpperCase();
            });

            if (allMatch) {
                return {
                    type: 'segments',
                    prefixSegment: i,
                    description: `Segment ${i} (after ${i - 1} switches)`
                };
            }
        }

        // Fallback: Generate rule from the first example
        try {
            return this.generateParsingRule(validExamples[0].tag, validExamples[0].prefix);
        } catch (e) {
            // If even the first one fails strict checks, return a catch-all
            return { type: 'leadingLetters', description: 'Default (Leading Letters)' };
        }
    },

    /**
     * Derive a parsing rule using AI (LLM) based on examples
     * @param {Array} examples - Array of { tag, prefix } objects
     * @returns {Promise<Object>} Rule object { type: 'regex', regex: '...', description: '...' }
     */
    async deriveRuleWithAI(examples) {
        if (!examples || examples.length === 0) return null;

        const validExamples = examples.filter(e => e.tag && e.prefix);
        if (validExamples.length === 0) return null;

        const examplesText = validExamples.map(e => `Tag: "${e.tag}" -> Prefix: "${e.prefix}"`).join('\n');

        const prompt = `
You are a Regex expert. I have a list of alarm tags and the desired prefix to extract for grouping.
Your task is to write a single JavaScript Regular Expression that can extract these prefixes from the tags.

Examples:
${examplesText}

Requirements:
1. The regex must have exactly one capturing group that captures the prefix.
2. It must work for ALL the provided examples.
3. Be robust but concise.
4. If a clear pattern exists (e.g., "letters before the first digit", "everything before the first dash"), target that pattern.
5. If the examples are "XIL5705 -> XIL" and "TI0199 -> TI", a good regex is "^([A-Za-z]+)".
6. If the examples are "10-FI-001 -> FI", a good regex might be "(?:^|[-_])([A-Za-z]+)(?:[-_])".

Respond with ONLY a JSON object:
{
  "regex": "YOUR_REGEX_PATTERN_HERE",
  "description": "Short explanation of what it extracts"
}
`;

        try {
            console.log('[DrProcessor] Requesting AI Rule Derivation...');
            // Use the general chat model for this logical task, it's usually faster/cheaper than the D&R reasoning model
            // and sufficient for Regex generation.
            const response = await window.chatbotService.sendMessage(prompt);

            // Clean response: remove markdown code blocks and HTML tags if present
            let jsonStr = response.text;

            // 1. Handle Markdown
            if (jsonStr.includes('```json')) {
                jsonStr = jsonStr.split('```json')[1].split('```')[0];
            } else if (jsonStr.includes('```')) {
                jsonStr = jsonStr.split('```')[1].split('```')[0];
            }

            // 2. Handle HTML wrapping (typical of some Azure deployments) or extra text
            // Find the first '{' and last '}'
            const firstBrace = jsonStr.indexOf('{');
            const lastBrace = jsonStr.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
            } else {
                throw new Error('No JSON object found in AI response');
            }

            // 3. Clean any HTML entities if they remain (e.g. &quot;)
            jsonStr = jsonStr.replace(/&quot;/g, '"')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');

            const result = JSON.parse(jsonStr.trim());

            if (!result.regex) throw new Error('AI response missing regex field');

            // Clean the regex string: trim whitespace and remove wrapping characters (common LLM artifacts)
            let cleanRegex = result.regex.trim();

            // Remove wrapping quotes (single, double, backticks) - LLMs sometimes double-quote the value
            if ((cleanRegex.startsWith('"') && cleanRegex.endsWith('"')) ||
                (cleanRegex.startsWith("'") && cleanRegex.endsWith("'")) ||
                (cleanRegex.startsWith('`') && cleanRegex.endsWith('`'))) {
                cleanRegex = cleanRegex.slice(1, -1);
            }

            // Remove wrapping forward slashes if present (regex literal syntax)
            if (cleanRegex.startsWith('/') && cleanRegex.length > 2) {
                // Find the last slash (could be followed by flags like /i or /g)
                const lastSlash = cleanRegex.lastIndexOf('/');
                if (lastSlash > 0) {
                    cleanRegex = cleanRegex.substring(1, lastSlash);
                }
            }

            // Sanitize: Replace typographic dashes (en-dash, em-dash) with standard hyphens
            // often AI models output "A–Z" (en-dash) instead of "A-Z" (hyphen) which breaks ranges
            cleanRegex = cleanRegex.replace(/[\u2013\u2014]/g, '-');

            // Ensure the regex has a capture group - if not, wrap the entire pattern
            // This guarantees regexMatch[1] will be available during parsing
            if (!cleanRegex.includes('(')) {
                cleanRegex = `(${cleanRegex})`;
                console.log(`[DrProcessor] Added missing capture group: "${cleanRegex}"`);
            }

            console.log(`[DrProcessor] AI Derived Regex (Sanitized): "${cleanRegex}" (Original: "${result.regex}")`);

            // Check if this is a simple "leading letters" pattern - use leadingLetters type for reliability
            // This avoids browser-specific regex execution issues
            const isLeadingLettersPattern = /^\^?\(?\[?[Aa]-[Zz]a?-?z?\]?\+?\)?\$?$/.test(cleanRegex) ||
                cleanRegex === '^([A-Za-z]+)' ||
                cleanRegex === '^[A-Za-z]+' ||
                cleanRegex === '([A-Za-z]+)' ||
                result.description?.toLowerCase().includes('leading letters') ||
                result.description?.toLowerCase().includes('letters before');

            let candidateRule;

            if (isLeadingLettersPattern) {
                // Use leadingLetters type for simple patterns - more reliable than regex
                console.log('[DrProcessor] Detected leading letters pattern, using leadingLetters rule type for reliability');
                candidateRule = {
                    type: 'leadingLetters',
                    description: result.description || 'Extract leading letters (AI)',
                    isAiDerived: true
                };
            } else {
                // Use regex for more complex patterns
                candidateRule = {
                    type: 'regex',
                    regex: cleanRegex,
                    description: result.description || 'AI Derived Rule',
                    isAiDerived: true
                };
            }

            // 4. Validate the rule against validExamples
            let validationFailed = false;
            let failureReason = '';

            for (const example of validExamples) {
                const extracted = this.parseTagCodeLetter(example.tag, candidateRule);
                // Case-insensitive comparison since parseTagCodeLetter returns uppercase
                if (extracted.toUpperCase() !== example.prefix.toUpperCase()) {
                    console.warn(`[DrProcessor] Rule validation failed for "${example.tag}": expected "${example.prefix}", got "${extracted}"`);
                    validationFailed = true;
                    failureReason = `Failed on ${example.tag}`;
                    break;
                }
            }

            if (validationFailed) {
                console.warn('[DrProcessor] AI Rule validation failed. Falling back to leadingLetters rule type.');
                // Always fall back to leadingLetters for reliability
                candidateRule = {
                    type: 'leadingLetters',
                    description: 'Extract leading letters (fallback)',
                    isAiDerived: true,
                    validationWarning: failureReason
                };

                // Re-validate with leadingLetters
                validationFailed = false;
                for (const example of validExamples) {
                    const extracted = this.parseTagCodeLetter(example.tag, candidateRule);
                    if (extracted.toUpperCase() !== example.prefix.toUpperCase()) {
                        console.warn(`[DrProcessor] LeadingLetters also failed for "${example.tag}": expected "${example.prefix}", got "${extracted}"`);
                        validationFailed = true;
                        break;
                    }
                }
            }

            return candidateRule;

        } catch (error) {
            console.error('[DrProcessor] AI Rule Derivation failed:', error);
            throw new Error('Failed to derive rule with AI: ' + error.message);
        }
    },

    /**
     * Generate a parsing rule from a user-provided example
    generateParsingRule(fullTag, prefix) {
        // Validation
        if (!fullTag || !prefix) {
            throw new Error('Both fullTag and prefix are required');
        }
    
        const trimmedTag = fullTag.trim();
        const trimmedPrefix = prefix.trim();
    
        if (!trimmedTag.toUpperCase().startsWith(trimmedPrefix.toUpperCase())) {
            throw new Error(`Tag "${trimmedTag}" does not start with prefix "${trimmedPrefix}"`);
        }
    
        // Get the character immediately after the prefix
        const afterPrefix = trimmedTag.substring(trimmedPrefix.length);
    
        // Strategy 1: Delimiter Detection
        const delimiters = ['-', '_', '.', '/'];
        if (afterPrefix.length > 0 && delimiters.includes(afterPrefix[0])) {
            return {
                type: 'delimiter',
                char: afterPrefix[0],
                description: `Split by '${afterPrefix[0]}'`
            };
        }
    
        // Strategy 2: Alpha/Numeric Boundary
        const isAllLetters = /^[A-Za-z]+$/.test(trimmedPrefix);
        const startsWithDigit = afterPrefix.length > 0 && /^[0-9]/.test(afterPrefix[0]);
        if (isAllLetters && startsWithDigit) {
            return {
                type: 'regex',
                regex: '^([A-Za-z]+)',
                description: 'Extract leading letters'
            };
        }
    
        // Strategy 3: Fixed Length (Fallback)
        return {
            type: 'fixedLength',
            length: trimmedPrefix.length,
            description: `First ${trimmedPrefix.length} characters`
        };
    },
    
    /**
     * Parse a tag to extract its code letter/prefix
     * @param {string} tag - The full tag name
     * @param {Object} rule - Parsing rule object (from generateParsingRule)
     * @returns {string} Extracted prefix/code letter
     */
    parseTagCodeLetter(tag, rule = null) {
        if (!tag) return 'UNKNOWN';

        let trimmedTag = tag.trim().toUpperCase();

        // Handle quoted tags
        if ((trimmedTag.startsWith('"') && trimmedTag.endsWith('"')) || (trimmedTag.startsWith("'") && trimmedTag.endsWith("'"))) {
            trimmedTag = trimmedTag.slice(1, -1).trim();
        }

        // Default: leading letters
        if (!rule) {
            const match = trimmedTag.match(/^([A-Za-z]+)/);
            return match ? match[1] : trimmedTag;
        }

        // Segments logic
        if (rule.type === 'segments') {
            const segments = this.splitTagIntoSegments(trimmedTag);
            // Default to 1st segment (index 0) if prefixSegment is undefined or null
            const segNum = (rule.prefixSegment === undefined || rule.prefixSegment === null) ? 1 : rule.prefixSegment;
            const index = segNum - 1;

            const result = (index >= 0 && index < segments.length) ? segments[index] : (segments[0] || trimmedTag);

            // Debug Log for verification
            if (trimmedTag.includes('37AI') || trimmedTag.includes('TI0199') || Math.random() < 0.001) {
                console.log(`[DrProcessor] SEGMENTS: Tag="${trimmedTag}" -> Segments=[${segments}] -> Index=${index} -> Result="${result}"`);
            }
            return result.toUpperCase();
        }

        // Leading Letters logic
        if (rule.type === 'leadingLetters') {
            const match = trimmedTag.match(/^([A-Za-z]+)/);
            const result = match ? match[1] : trimmedTag;
            if (trimmedTag.includes('37AI') || trimmedTag.includes('TI0199')) {
                console.log(`[DrProcessor] LEADING_LETTERS: Tag="${trimmedTag}" -> Result="${result}"`);
            }
            return result;
        }

        // Regex logic
        if (rule.type === 'regex') {
            try {
                const regexStr = rule.regex || rule.pattern;
                if (!regexStr) return trimmedTag;

                const re = new RegExp(regexStr, 'i');
                const match = re.exec(trimmedTag);

                if (!match) {
                    console.warn(`[DrProcessor] Regex ${regexStr} no match for ${trimmedTag}`);
                    return 'UNKNOWN';
                }

                // Prioritize capture group 1
                const result = (match.length > 1 ? match[1] : match[0]).toUpperCase();

                if (trimmedTag.includes('TI0199')) {
                    console.log(`[DrProcessor] REGEX: Tag="${trimmedTag}" Regex="${regexStr}" -> Result="${result}"`);
                }
                return result;
            } catch (e) {
                console.error('[DrProcessor] Regex error:', e);
                return 'UNKNOWN';
            }
        }

        // Delimiter logic
        if (rule.type === 'delimiter') {
            const parts = trimmedTag.split(rule.char || '-');
            return parts[0] || trimmedTag;
        }

        // Fixed Length logic
        if (rule.type === 'fixedLength') {
            return trimmedTag.substring(0, rule.length || 2);
        }

        // Fallback for unhandled types
        const defaultMatch = trimmedTag.match(/^([A-Za-z]+)/);
        return defaultMatch ? defaultMatch[1] : trimmedTag;
    },

    /**
     * Split a tag into segments at letter↔digit transition points
     * For "T4PI30171C" → ["T4", "PI", "30171C"]
     * For "TI0199" → ["TI", "0199"]
     * For "10-FI-001" → ["10", "-", "FI", "-", "001"] (handles delimiters too)
     * @param {string} tag - The tag to split
     * @returns {Array<string>} Array of segments
     */
    splitTagIntoSegments(tag) {
        if (!tag) return [];

        const segments = [];
        let currentSegment = '';
        let prevType = null;

        for (let i = 0; i < tag.length; i++) {
            const char = tag[i];
            const charCode = char.toUpperCase().charCodeAt(0);

            let currentType;
            if (charCode >= 65 && charCode <= 90) {
                currentType = 'letter';
            } else if (charCode >= 48 && charCode <= 57) {
                currentType = 'digit';
            } else {
                currentType = 'other'; // delimiters, special chars
            }

            // If type changed and we have a current segment, push it
            if (prevType !== null && prevType !== currentType && currentSegment) {
                segments.push(currentSegment);
                currentSegment = '';
            }

            currentSegment += char;
            prevType = currentType;
        }

        // Push the last segment
        if (currentSegment) {
            segments.push(currentSegment);
        }

        // Filter out delimiter-only segments for cleaner results
        // e.g., ["10", "-", "FI", "-", "001"] → ["10", "FI", "001"]
        return segments.filter(s => /[A-Za-z0-9]/.test(s));
    },

    /**
     * Group alarm data by tag code letter/prefix
     * Group alarm data by tag code letter/prefix
     * @param {Array} data - Array of alarm records with Tag field
     * @param {Object} rule - Parsing rule object (optional)
     * @returns {Array} Sorted array of group objects { codeLetter, alarms, completedCount, incompleteCount }
     */
    groupByCodeLetter(data, rule = null) {
        if (!data || !Array.isArray(data)) return [];

        const groups = {};
        const codeMap = {}; // New map to store isaCode

        // Safety: ensure rule is valid object if provided
        const safetyRule = rule && typeof rule === 'object' ? rule : null;

        data.forEach((row, index) => {
            const tag = row.Tag || row.tag || '';
            let codeLetter;
            let isaCode;

            if (safetyRule && safetyRule.type === 'unit-aware') {
                // Robustly find the Unit column (case-insensitive, trimmed)
                const unitKey = Object.keys(row).find(k => k.trim().toUpperCase() === 'UNIT');
                const unit = unitKey ? row[unitKey] : '';
                const extracted = this.extractCodeLetterFromUnit(tag, unit);
                isaCode = extracted;

                // User Request: Group by "Unit - Letter" (e.g. "09 - FI")
                // If unit exists, use it in the key. Otherwise just the letter.
                codeLetter = unit ? `${unit} - ${extracted}` : extracted;
            } else {
                codeLetter = this.parseTagCodeLetter(tag, safetyRule);
                isaCode = codeLetter;
            }

            if (!codeMap[codeLetter]) {
                codeMap[codeLetter] = isaCode;
            }

            if (index < 5) {
                console.warn(`[DEBUG] Tag: "${tag}" | Rule: ${JSON.stringify(safetyRule)} | Extracted: "${codeLetter}" | Row Keys: ${Object.keys(row).join(',')}`);
            }

            if (!groups[codeLetter]) {
                groups[codeLetter] = [];
            }
            groups[codeLetter].push(row);
        });

        // Convert to array and calculate stats
        const result = Object.entries(groups).map(([codeLetter, alarms]) => {
            const completedCount = alarms.filter(a => a._isComplete).length;
            return {
                codeLetter,
                isaCode: codeMap[codeLetter] || codeLetter,
                displayName: codeMap[codeLetter] || codeLetter, // Use ISA code for display
                alarms,
                completedCount,
                incompleteCount: alarms.length - completedCount
            };
        });

        // Sort by count (descending)
        return result.sort((a, b) => b.alarms.length - a.alarms.length);
    },

    /**
     * Run consistency check on grouped data
     * @param {Array} groupedData - The groups from groupByCodeLetter
     * @returns {Object} { groupsWithIssues, groupDetails }
     */
    runConsistencyCheck(groupedData) {
        // If groupedData is object (legacy), convert to array
        const groups = Array.isArray(groupedData) ? groupedData : Object.values(groupedData);

        let groupsWithIssues = 0;

        // Simple consistency check logic (placeholder for actual logic)
        // For now, we just pass through the groups and maybe flag empty ones?
        groups.forEach(group => {
            // Logic to identify issues could go here
            // e.g., if group has mixed priorities
        });

        return {
            groupsWithIssues,
            groupDetails: groupedData // Pass through for UI
        };
    },

    /**
     * Detect unique tag patterns from alarm data
     * Analyzes tags to find different naming conventions and returns representative examples
     * @param {Array} data - Array of alarm records with Tag field
     * @param {number} maxExamples - Maximum number of examples to return (default 5)
     * @returns {Array} Array of { tag, suggestedPrefix, pattern } objects
     */
    detectTagPatterns(data, maxExamples = 5) {
        if (!data || !Array.isArray(data) || data.length === 0) return [];

        // Collect all unique tags
        const allTags = [...new Set(data.map(row => (row.Tag || row.tag || '').trim()).filter(t => t))];
        if (allTags.length === 0) return [];

        // Analyze each tag to determine its pattern signature
        const patternMap = new Map(); // pattern signature -> { tag, prefix, count }

        allTags.forEach(tag => {
            const upperTag = tag.toUpperCase();

            // Determine pattern signature
            let signature = '';
            let suggestedPrefix = '';

            // Check for delimiter-based patterns (TI-101, FIC_200, etc.)
            const delimiterMatch = upperTag.match(/^([A-Za-z]+)([-_./])(\d)/);
            if (delimiterMatch) {
                signature = `letters${delimiterMatch[2]}numbers`;
                suggestedPrefix = delimiterMatch[1];
            } else {
                // Check for alpha-numeric boundary (TI101, FIC200)
                const alphaNumMatch = upperTag.match(/^([A-Za-z]+)(\d)/);
                if (alphaNumMatch) {
                    const letters = alphaNumMatch[1];
                    // Create signature based on prefix length to distinguish patterns
                    signature = `letters${letters.length}_then_numbers`;
                    suggestedPrefix = letters;
                } else {
                    // Check for all letters or other unusual patterns
                    const allLettersMatch = upperTag.match(/^([A-Za-z]+)$/);
                    if (allLettersMatch) {
                        signature = 'all_letters';
                        suggestedPrefix = upperTag.substring(0, 2); // First 2 chars
                    } else {
                        // Mixed or unusual pattern
                        signature = 'other_' + upperTag.substring(0, 3);
                        suggestedPrefix = upperTag.substring(0, 2);
                    }
                }
            }

            // Track by pattern signature
            if (!patternMap.has(signature)) {
                patternMap.set(signature, {
                    tag: tag, // Original case
                    suggestedPrefix: suggestedPrefix,
                    pattern: signature,
                    count: 1
                });
            } else {
                patternMap.get(signature).count++;
            }
        });

        // Convert to array, sort by frequency (most common patterns first), take top N
        const patterns = Array.from(patternMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, maxExamples)
            .map(p => ({
                tag: p.tag,
                suggestedPrefix: p.suggestedPrefix,
                pattern: p.pattern,
                count: p.count
            }));

        return patterns;
    },

    // ============================================
    // API HELPER FUNCTIONS
    // ============================================

    /**
     * Check if current deployment is a reasoning model (GPT-5, o1, o3, o4)
     * For D&R workflows, checks drDeploymentName first
     */
    isReasoningModel() {
        const name = (window.chatbotService?.config?.drDeploymentName || window.chatbotService?.config?.deploymentName || '').toLowerCase();
        return name.includes('gpt-5') || name.includes('o1') || name.includes('o3') || name.includes('o4');
    },

    /**
     * Build API request body with correct parameters for model type
     * GPT-5/reasoning models use max_completion_tokens (no temperature), others use max_tokens
     */
    buildApiRequestBody(messages, options = {}) {
        const isReasoning = this.isReasoningModel();
        const defaultTokens = options.maxTokens || 8000;

        const body = {
            messages
        };

        if (isReasoning) {
            // Reasoning models (GPT-5, o1, o3, o4):
            // - Use max_completion_tokens instead of max_tokens
            // - Use reasoning_effort parameter
            // - Do NOT include temperature (not supported)
            body.max_completion_tokens = Math.max(defaultTokens, 32000);

            // Valid values per API: 'low', 'medium', 'high', 'xhigh'
            const validEfforts = ['low', 'medium', 'high', 'xhigh'];

            // Get reasoning effort from config, localStorage, or default to 'medium'
            let effort = window.chatbotService?.config?.reasoningEffort
                || localStorage.getItem('chatbotReasoningEffort');

            // Handle invalid values: null, undefined, "undefined", "null", empty string, or any invalid value
            if (!effort || effort === 'undefined' || effort === 'null' || !validEfforts.includes(effort)) {
                // Map 'minimal' to 'low' for backwards compatibility
                if (effort === 'minimal') {
                    effort = 'low';
                } else {
                    effort = 'medium'; // Default fallback
                }
            }

            body.reasoning_effort = effort;
            console.log(`[D&R Processor] Using reasoning model - no temperature, effort: ${body.reasoning_effort}`);
        } else {
            // Non-reasoning models (GPT-4, etc.):
            // - Use max_tokens
            // - Allow overriding temperature
            body.max_tokens = options.maxTokens || defaultTokens || 4000;
            body.temperature = options.temperature !== undefined ? options.temperature : 0;
            console.log(`[D&R Processor] Using standard model with max_tokens: ${body.max_tokens}, temperature: ${body.temperature}`);
        }

        return body;
    },

    /**
     * Test API connection before running workflows
     * Returns { success: boolean, message: string, modelInfo?: object }
     */
    async testApiConnection() {
        if (!window.chatbotService?.isConfigured()) {
            return {
                success: false,
                message: 'Azure OpenAI is not configured. Please configure it in Settings.'
            };
        }

        const endpoint = `${window.chatbotService.config.endpoint}/openai/deployments/${window.chatbotService.config.drDeploymentName || window.chatbotService.config.deploymentName}/chat/completions?api-version=${window.chatbotService.config.apiVersion}`;

        const testMessages = [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Respond with exactly: API_TEST_OK' }
        ];

        try {
            const requestBody = this.buildApiRequestBody(testMessages, { maxTokens: 50 });

            console.log('[API Test] Testing connection to:', endpoint);
            console.log('[API Test] Request body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': window.chatbotService.config.apiKey
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[API Test] Failed:', response.status, errorText);
                return {
                    success: false,
                    message: `API request failed: ${response.status} - ${errorText}`,
                    status: response.status
                };
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || '';

            console.log('[API Test] Response:', content);

            return {
                success: true,
                message: `API connection successful. Model: ${window.chatbotService.config.drDeploymentName || window.chatbotService.config.deploymentName}`,
                modelInfo: {
                    deployment: window.chatbotService.config.drDeploymentName || window.chatbotService.config.deploymentName,
                    isReasoning: this.isReasoningModel(),
                    reasoningEffort: this.isReasoningModel() ? (window.chatbotService.config.reasoningEffort || 'medium') : null,
                    response: content.substring(0, 100)
                }
            };
        } catch (error) {
            console.error('[API Test] Error:', error);
            return {
                success: false,
                message: `Connection error: ${error.message}`
            };
        }
    },

    /**
     * Detect priority scheme from CSV data
     * Returns 'numeric' (Priority 1/2/3) or 'descriptive' (High/Medium/Low/Urgent)
     */
    detectPriorityScheme(data) {
        const priorities = data
            .map(row => (row.Priority || '').toString().toLowerCase().trim())
            .filter(p => p && p !== '');

        if (priorities.length === 0) {
            this.detectedPriorityScheme = 'numeric'; // default
            return 'numeric';
        }

        // Count numeric vs descriptive patterns
        let numericCount = 0;
        let descriptiveCount = 0;

        priorities.forEach(p => {
            if (/priority\s*[1-5]/i.test(p) || /^p[1-5]$/i.test(p) || /^[1-5]$/i.test(p)) {
                numericCount++;
            } else if (/high|medium|low|urgent|critical|none|journal|log/i.test(p)) {
                descriptiveCount++;
            }
        });

        this.detectedPriorityScheme = descriptiveCount > numericCount ? 'descriptive' : 'numeric';
        console.log(`Detected priority scheme: ${this.detectedPriorityScheme} (numeric: ${numericCount}, descriptive: ${descriptiveCount})`);
        return this.detectedPriorityScheme;
    },

    // ============================================
    // PRIORITY HELPER FUNCTIONS
    // ============================================

    /**
     * Get numeric value for a priority (lower number = higher urgency)
     * Returns null for unknown priorities
     */
    getPriorityValue(priority) {
        if (!priority) return null;
        // Remove "AI: " prefix if present
        const cleanPriority = priority.toString().replace(/^AI:\s*/i, '').toLowerCase().trim();
        return this.PRIORITY_VALUES[cleanPriority] || null;
    },

    /**
     * Compare two priorities and return the change direction
     * Returns: 'increased' (more urgent), 'decreased' (less urgent), 'unchanged', or 'unknown'
     */
    comparePriorities(currentPriority, proposedPriority) {
        const currentVal = this.getPriorityValue(currentPriority);
        const proposedVal = this.getPriorityValue(proposedPriority);

        if (currentVal === null || proposedVal === null) return 'unknown';
        if (currentVal === proposedVal) return 'unchanged';
        // Lower value = higher urgency, so proposedVal < currentVal means increased urgency
        return proposedVal < currentVal ? 'increased' : 'decreased';
    },

    /**
     * Analyze priority changes across all draft results
     * Returns summary statistics for the Priority Analysis screen
     */
    analyzePriorityChanges(draftResults, originalData) {
        const analysis = {
            total: 0,
            changed: 0,
            unchanged: 0,
            increased: 0,
            decreased: 0,
            unknown: 0,
            details: []
        };

        draftResults.filter(r => r.success).forEach(result => {
            const tag = result.alarm.Tag || result.alarm.tag;
            const alarmType = result.alarm.Alarm || result.alarm.alarm || result.alarm.AlarmDisplayName || '';

            // Find original record to get current priority
            const original = originalData.find(row => {
                const rowTag = row.Tag || row.tag;
                const rowAlarm = row.Alarm || row.alarm || row.AlarmDisplayName || '';
                return rowTag === tag && rowAlarm === alarmType;
            });

            const currentPriority = original?.Priority || original?.['Proposed Priority'] || '';
            const proposedPriority = result.draft['Proposed Priority'] || '';
            const aiReasoning = result.draft['AI Reasoning'] || '';
            const direction = this.comparePriorities(currentPriority, proposedPriority);

            analysis.total++;

            if (direction === 'unchanged') analysis.unchanged++;
            else if (direction === 'increased') {
                analysis.increased++;
                analysis.changed++;
            } else if (direction === 'decreased') {
                analysis.decreased++;
                analysis.changed++;
            } else {
                analysis.unknown++;
            }

            analysis.details.push({
                tag,
                alarmType,
                fullAlarmName: result.fullAlarmName,
                description: original?.Description || result.alarm?.Description || '',
                currentPriority: currentPriority || 'Not Set',
                proposedPriority,
                direction,
                aiReasoning
            });
        });

        return analysis;
    },

    /**
     * Analyze priority distribution before and after AI rationalization
     * Returns data for bar chart visualization
     * NOTE: Journal alarms are excluded from calculations per Honeywell Experion standards
     */
    analyzePriorityDistribution(draftResults, originalData) {
        // Helper to normalize priority for consistent counting (uppercase for case-insensitive)
        const normalizePriority = (priority) => {
            if (!priority) return 'NOT SET';
            return priority.toString().replace(/^AI:\s*/i, '').trim().toUpperCase();
        };

        // Helper to check if priority should be excluded from calculations
        // (Journal and None are excluded per Honeywell Experion standards)
        const isExcludedPriority = (priority) => {
            if (!priority) return false;
            const p = priority.toString().toUpperCase().trim();
            return p === 'JOURNAL' || p.includes('JOURNAL') || p === 'NONE' || p === 'NOT SET';
        };

        // Collect all unique priorities from source data (before and after)
        const allPriorities = new Set();
        const beforeCounts = {};
        const afterCounts = {};
        let excludedCount = 0;

        draftResults.filter(r => r.success).forEach(result => {
            const tag = result.alarm.Tag || result.alarm.tag;
            const alarmType = result.alarm.Alarm || result.alarm.alarm || result.alarm.AlarmDisplayName || '';

            // Find original record
            const original = originalData.find(row => {
                const rowTag = row.Tag || row.tag;
                const rowAlarm = row.Alarm || row.alarm || row.AlarmDisplayName || '';
                return rowTag === tag && rowAlarm === alarmType;
            });

            const currentPriority = normalizePriority(original?.Priority || original?.['Proposed Priority'] || '');
            const proposedPriority = normalizePriority(result.draft['Proposed Priority'] || '');

            // Exclude Journal and None alarms from distribution (per Honeywell Experion standards)
            if (isExcludedPriority(currentPriority) || isExcludedPriority(proposedPriority)) {
                excludedCount++;
                return;
            }

            // Add to priority sets for dynamic category building
            if (currentPriority && currentPriority !== 'NOT SET') allPriorities.add(currentPriority);
            if (proposedPriority && proposedPriority !== 'NOT SET') allPriorities.add(proposedPriority);

            // Count before/after
            beforeCounts[currentPriority] = (beforeCounts[currentPriority] || 0) + 1;
            afterCounts[proposedPriority] = (afterCounts[proposedPriority] || 0) + 1;
        });

        // Build categories from actual source priorities (sorted by priority value)
        const priorityOrder = ['URGENT', 'CRITICAL', 'EMERGENCY', 'HIGH', 'MEDIUM', 'LOW', 'DIAGNOSTIC', 'REMOVE', 'NOT SET'];
        const categories = Array.from(allPriorities).sort((a, b) => {
            const aIndex = priorityOrder.findIndex(p => a.toUpperCase().includes(p));
            const bIndex = priorityOrder.findIndex(p => b.toUpperCase().includes(p));
            if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        });

        // If 'NOT SET' exists, add it
        if (beforeCounts['NOT SET'] || afterCounts['NOT SET']) {
            if (!categories.includes('NOT SET')) categories.push('NOT SET');
        }

        // Ensure all categories have entries
        categories.forEach(cat => {
            if (!beforeCounts[cat]) beforeCounts[cat] = 0;
            if (!afterCounts[cat]) afterCounts[cat] = 0;
        });

        return {
            categories,
            beforeCounts,
            afterCounts,
            excludedCount
        };
    },


    // ============================================
    // SYSTEM PROMPTS
    // ============================================

    systemPrompts: {
        // Philosophy Extractor - extracts rules from philosophy document
        philosophyExtractor: `You are an expert Industrial Safety Engineer specializing in ISA-18.2 and IEC 62682 alarm management standards.

You will be provided with the TEXT CONTENT of an Alarm Philosophy document (converted from PDF).

Your task is to extract ALL configuration rules into strict JSON format.

EXTRACT:
1. Priority Matrix - how severity and consequence combine to determine priority including the maximum time to respond for that priority
2. Severity Matrix - definition of severity levels (minor, major, severe, etc.) for each impact category
3. Forbidden Combinations - any explicitly prohibited configurations
4. Default Values - any default settings mentioned

Output ONLY valid JSON (no markdown, no explanation):
{
  "priority_matrix": [
    {"severity": "Minor", "priority": "Priority 3", "max_time_to_respond": "30 minutes"},
    {"severity": "Major", "priority": "Priority 2", "max_time_to_respond": "10 minutes"},
    {"severity": "Severe", "priority": "Priority 1", "max_time_to_respond": "3 minutes"}
  ],
  "severity_matrix": [
    {"impact_category": "Personnel", "severity": "Minor", "entry": "First aid injury"},
    {"impact_category": "Personnel", "severity": "Major", "entry": "Lost time injury"},
    {"impact_category": "Environmental", "severity": "Major", "entry": "Release > RQ"}
  ],
  "forbidden_combinations": [
    "Safety Critical alarms cannot be Low priority",
    "Environmental alarms with Major severity must be High or Critical"
  ],
  "default_values": {
    "default_priority": "Medium",
    "default_response_time": "30 minutes"
  }
}
`,

        // Batch D&R Drafter - Comprehensive Vendor-Specific Prompt (ISA 18.2 / IEC 62682)
        batchDrafter: `You are an expert Alarm Management Facilitator and Senior Process Engineer specializing in Alarm Documentation and Rationalization (D&R). Your goal is to ensure the safety and efficiency of industrial operations. Lives depend on the accuracy of your analysis.

Your task is to analyze the provided alarm tags and produce a rationalized configuration as strictly formatted JSON output.

### 1. GENERAL D&R RULES (Apply to all)
* **The "Action" Rule:** An alarm MUST require a specific operator action to avoid a consequence. If no action is required, or if the action is only to "monitor," it is NOT an alarm (classify as "Journal" or "Log").
* **The "Urgency" Rule:** If the operator does not need to act for >30 minutes, it is likely not an alarm.
* **Duplicates:** Do not allow multiple alarms for the same abnormal condition (e.g., PV HIGH alarms on multiple, related Temperature sensors). Choose the one most relevant to the operator's corrective action.
* **Causes:** Describe the abnormal process or equipment condition that can result in this alarm. Do not describe the alarm type.

### 2. COMBINATION ALARMS (High-High / Low-Low)
Combination alarms are where PV HIGH or PV LOW alarms are configured with, and often followed by, the next alarm level (PV HIGH-HIGH or PV LOW-LOW). Many systems are initially configured with all pre-alarms enabled, which contributes significantly to alarm flooding.

**Philosophy:**
* **By default, NO PV HIGH-HIGH or PV LOW-LOW alarms shall be configured.**
* For a PV HIGH-HIGH or PV LOW-LOW alarm to exist, BOTH conditions must be met:
  1. The operator actions for the pre-alarm (PV HIGH / PV LOW) vs. the next alarm (PV HIGH-HIGH / PV LOW-LOW) must be **significantly different in kind or degree**. Do not alarm twice for the operator to do the same thing.
  2. There must be **enough time after the first alarm** for the operator to perform effective corrective action before the process activates the next alarm.
* If these conditions are NOT met, set the override priority of the PV HIGH-HIGH / PV LOW-LOW alarm to "No Alarm" and set the override reason to "Operator response on the PV HIGH / PV LOW alarm".

### 3. ESD BYPASS ALARMS
When inputs or outputs to an ESD (Emergency Shutdown) system are bypassed for testing or operational reasons, the bypass status MUST be alarmed and displayed to the operator on their Human Machine Interface.

**IMPORTANT - Priority Assignment for Bypass Alarms:**
* **Do NOT use high control system priorities for ESD bypass alarms.** This is a common but incorrect practice.
* Bypass alarms indicate that an abnormal situation (bypass) is occurring, typically for a proper reason like interlock testing which may take hours.
* The purpose is to remind operators to reactivate the interlock when testing completes and allow for tracking of active bypasses.
* **High priorities are reserved for abnormal situations requiring significant consequences and short time-frame responses** - this does NOT match bypass alarms in their normal use case.
* Set ESD bypass alarms to **Priority 3** or **Diagnostic** priority.

### 4. RATE OF CHANGE ALARMS
Rate of change alarms occur when the process value changes faster than a configured maximum rate.

**Philosophy:**
* **Use this alarm type sparingly** - it easily generates unwanted alarms during normal process transitions.
* **Typically, this alarm type should NOT be used.**
* If used, adequate delays MUST be configured to ensure that noise in the Process Variable does not cause false rate of change alarms.
* Default recommendation: **NONE** unless there is a specific, documented need with proper delay configuration.

### 5. PRIORITIZATION METHOD
Alarms are assigned a priority from a combination of the maximum severity of the consequence and the time available to respond to the alarm before the consequences become unavoidable.
The Severity of the consequence is evaluated across four different Impacts
1.	**Personnel:** ranges from no impact (NONE) to loss of life (SEVERE)
2.	**Public or Environment:** range from no impact (NONE) to uncontrolled release of hazardous materials impacting the local community (SEVERE)
3.	**Plant/Equipment:** ranges from no impact (NONE) to equipment damage costing >$500,000
4.	**Costs/Production:** ranges from no impact (NONE) to significant disruption of operations costing >$500,000
Use the following guidance to asses the severity across the impact categories
| Impact Category \\ Severity | NONE | MINOR | MAJOR | SEVERE |
| Personnel | No injury or health effect | Slight injury (first aid) or health effect, no disability, no lost time | lost time recordable, no permanent disability | lost time injury, disabling injury, loss of life |
|Public or Environment | No effect | Minimal exposure, does not cross the fence line | Exposed to hazards that may cause injury, hospitialization and damage claims likely | uncontained release of hazardous materials with major environmental impact and 3rd party impact |
| Plant/Equipment | No loss| Minor damage to equipment <$10,000 | Damage to equipment between $10,000 - $500,000 | Equipment damage > $500,000 |
| Costs/Production | No loss | process disruption <$10,000 | Process upset impact between $10,000 - $500,000 | Severe upset impact >$500,000 |
After the severity is assessed for each impact, the maximum time available for the operator to respond is determined by selecting one of four categories:
1.	**> 30 minutes:** May not qualify for an alarm
2.	**10 to 30 minutes:** Prompt response required
3.	**3 to 10 minutes:** Rapid response required
4.	**< 3 minutes:** Immediate response required
The combination of the maximum severity and the time available to respond results in a priority following the matrix below
*(Default Priority Matrix - Consequence Severity vs Response Time)*:
| Response Time \\ Severity | NONE | MINOR | MAJOR | SEVERE |
| :--- | :--- | :--- | :--- | :--- |
| **> 30 minutes** | No Alarm | No Alarm | No Alarm | No Alarm |
| **10 to 30 minutes** | No Alarm | Priority 3 | Priority 3 | Priority 2 |
| **3 to 10 minutes** | No Alarm | Priority 3 | Priority 2 | Priority 2 |
| **< 3 minutes** | No Alarm | Priority 2 | Priority 1 | Priority 1 |

### 6. VENDOR-SPECIFIC D&R PRESETS (CRITICAL)
Identify the Control System from the input tag data and apply the corresponding section strictly.

#### A. FOXBORO I/A (FoxIA)
* **Priorities:** P1 (High/Red), P2 (Med/Yellow), P3 (Low/Orange), P4 (Diagnostic/Magenta).
* **Required Presets:**
    * **HIABS / LOABS:** Keep and Rationalize (D&R).
    * **HHABS / LLABS:** Combination alarms. **No Alarm** (Set to not configured) unless operator action is significantly different from HI/LO and time permits.
    * **HIDEV / LODEV:** **REMOVE**. Generally not used.
    * **RATE (Rate of Change):** **REMOVE**. Dangerous, causes floods.
    * **IOBAD:** Set to **P4 (Diagnostic)**.
    * **HIOUT / LOOUT:** **REMOVE**.

#### B. YOKOGAWA CENTUM
* **Priorities:** High (P1/Red), Medium (P2/Yellow), Low (P3), Log (Diagnostic).
* **Presets:**
    * **IOP/OOP (Input/Output Open):** Set to **Medium (P2)** or **Low (P3)**.
    * **HI / LO:** Set to **High (P1)** or **Medium (P2)** based on risk.
    * **HH / LL:** Set to **Logging (P4)** or N/A unless specific interlock pre-alarm needed.
    * **VEL+ / VEL- (Velocity):** Set to **N/A** (Priority 4).
    * **DV+ / DV-:** Set to **N/A** (Priority 4).

#### C. DELTAV
* **Priorities:** High, Medium, Low, Log.
* **Presets:**
    * **Comm Error / I/O Failure:** Set to **Log Priority**.
    * **Rate of Change:** **REMOVE**. Dangerous, causes floods.
    * **Deviation Alarm:** **REMOVE**.
    * **High-High / Low-Low:** **REMOVE** (Not configured) unless specific criteria met.
    * **High / Low:** Keep and Rationalize (D&R).

#### D. WONDERWARE
* **Priorities:** High (1), Med (2), Low (3), Log.
* **Presets:**
    * **ROC (Rate of Change):** **REMOVE**.
    * **MAJDEV / MINDEV (Deviation):** **REMOVE**.
    * **VALUE-LOLO / HIHI:** Suggest setting to **NAN** (Disable) unless distinct action exists.
    * **VALUE-LOW / HIGH:** Keep and Rationalize (D&R).

#### E. HONEYWELL (TPS & Experion)
* **Priorities:** Emergency, High, Low.
* **Presets:**
    * **BADPV / UNREAS:** Set to **LOW** (or Journal).
    * **PVHH / PVLL:** Suggest setting to **NOACTION/NAN**. Never default to exist.
    * **DEVHI / DEVLO:** Set to **NOACTION/NAN**.
    * **PVROCN / PVROCP:** Set to **NOACTION/NAN**.
    * **CHOFST / CMDDIS:** Keep and Rationalize (D&R).

#### F. EMERSON OVATION
* **Presets:**
    * **High-1 / Low-1:** Use these for standard alarms.
    * **High-2 / Low-2:** Only use if actions differ from H1/L1.
    * **High-3 / High-4:** **Do NOT Use.**
    * **Better / Worse Alarms:** **Do NOT Use.** Violates alarm principles.
    * **Return Alarms:** **Do NOT Use.**
    * **Sensor / Timeout:** Treat as Diagnostic.

### 7. ALARM DISPLAY NAME REFERENCE
Use this reference to understand abbreviated alarm display names. If an alarm type matches one of these, use the description to inform your Cause, Consequence, and Corrective Action.

| Code | Description |
| :--- | :--- |
| ABORT | Sequence Abort - logic sequence forced to stop (safety or operator command) |
| ADVDEV | Advisory Deviation - PV/SP difference exceeds advisory limit |
| BAD PV | Bad Process Variable - sensor input invalid/out of range |
| BADCTL | Bad Control - control loop cannot execute (bad input or output failing) |
| CHGOFST | Change of State - triggered when discrete signal transitions between states; often inappropriate as one state typically does not indicate abnormal condition |
| CMDDIS | Command Disagree - device feedback doesn't match command (valve stiction) |
| CMFAIL | Command Fail - output command not transmitted/executed |
| DEV | Deviation Alarm - PV/SP difference exceeds deviation limit |
| DEVHI | Deviation High - PV higher than SP beyond high deviation limit |
| DEVLOW | Deviation Low - PV lower than SP beyond low deviation limit |
| FAIL | Module Failure - control module/device/hardware has failed |
| FLOWCOMPA.BADCOMPTERM | Flow Compensation Bad Term - compensation input has bad status |
| HOLD | Sequence Hold - automated sequence paused awaiting operator |
| OFFNRM | Off Normal - discrete device in non-normal state |
| OPHIGH | Output High Limit - controller output saturated at max (100%) |
| OPLOW | Output Low Limit - controller output saturated at min (0%) |
| OVRDI0/1/2 | Override Interlock - override logic forcing safe/fallback state |
| OVRDSI | Override Select Input - switched to different input/strategy |
| PVHIGH | Process Variable High - PV exceeded high alarm limit |
| PVHIHI | PV High-High - critical high, usually trip/safety condition |
| PVLOLO | PV Low-Low - critical low, usually trip/safety condition |
| PVLOW | Process Variable Low - PV below low alarm limit |
| ROCNEG | Rate of Change Negative - PV decreasing too fast |
| ROCPOS | Rate of Change Positive - PV increasing too fast |
| STEPTO | Step Timeout - sequence step exceeded max time |
| STOP | Sequence Stop - sequence completed or stopped |
| UNCMD | Uncommanded Change - device changed state without command |
| DEVCTLA*.OFFNRMPVALM | Device Control Off Normal - specific control module in off-normal state |

### 8. OUTPUT INSTRUCTIONS
Generate for EACH alarm:
1. Cause - Use "Guideword" method (Valve Failure, Pump Trip, Controller Error, Instrument Error, Blockage, Leak, etc.)
2. Consequence - DIRECT plant consequence if operator takes NO action
3. Corrective Action - Clear actionable operator instruction
4. Proposed Priority - Use the detected priority scheme from the input data. Use values like: Priority 1/Priority 2/Priority 3, OR High/Medium/Low, OR Urgent/High/Low, as appropriate to match the site's naming convention. Also include REMOVE/No Alarm/Diagnostic as needed.
5. Max Time to Respond - Based on priority (Priority 1/Urgent: <3min, Priority 2/High: 3-10min, Priority 3/Medium: 10-30min, Low: >30min)
6. Reasoning - 1-2 sentences explaining your rationale, citing the specific Vendor Rule, Philosophy Section, or Reference Alarm used

Rules:
- If alarm implies safety interlock (Trip, Shutdown, ESD), Consequence reflects shutdown impact
- Consequence must be plant-focused, not "alarm stays active"
- For similar alarms in same functional group, use consistent values
- **CONSISTENCY IS CRITICAL:** Alarms of the SAME alarm type (e.g., PVHIGH) on the SAME equipment type (e.g., Temperature, Level, Flow) MUST have IDENTICAL Cause, Consequence, Corrective Action, Proposed Priority, and Max Response Time. Only the tag-specific details may differ. Example: All PVHIGH alarms on Temperature sensors should have the same values.
- When processing a batch of alarms, first group them by (alarm type + equipment type) and ensure all alarms in each group have consistent attributes
- If vendor preset says REMOVE, set Proposed Priority to "REMOVE" and explain in Reasoning
- For ESD bypass alarms, use Low or Diagnostic priority (NOT high priority)
- For Rate of Change alarms, default to REMOVE unless specific documented need

Output JSON array:
[
  {
    "fullAlarmName": "original full alarm name",
    "Cause": "...",
    "Consequence": "...",
    "Corrective Action": "...",
    "Proposed Priority": "Priority 1|Priority 2|Priority 3|High|Medium|Low|Urgent|REMOVE|No Alarm|Diagnostic",
    "Max Time to Respond": "X minutes",
    "Reasoning": "Brief citation of the specific Vendor Rule or Philosophy Rule used, e.g., 'Removed PVHH per Honeywell Preset - No distinct action from PVHI'"
  }
]`
    },

    // ============================================
    // PROCESS ANALYSIS AGENT
    // ============================================

    processAnalyzerPrompt: `You are an expert Process Engineer specializing in industrial process analysis. Your task is to analyze alarm data and process information to build a comprehensive understanding of the process.

## OBJECTIVE
Analyze the provided information to understand:
1. How equipment relates to each other (dependencies, flow direction)
2. Common failure modes and their root causes
3. What gaps exist in the provided data (the CSV may represent only part of a larger process)

## INPUT ANALYSIS APPROACH
1. **Tag Name Analysis**: Extract equipment type from tag naming conventions (e.g., "FIC" = Flow Indicator Controller)
2. **Description Column**: Use the Description field to understand what each piece of equipment does
3. **P&ID Image** (if provided): Identify process flow, connections between equipment, and physical layout
4. **Process Description** (if provided): Understand the overall process purpose and operation

## TYPICAL FAILURE PATTERNS
Consider these common failure modes:

**Pumps/Motors**: Tripped on overload, Seal failure, Cavitation, Bearing failure, Motor overheat
**Valves**: Stiction, Plugged, Failed open/closed, Positioner failure, Air supply loss
**Vessels/Tanks**: Overfill, Drain plugged, Level measurement error, Pressure buildup
**Heat Exchangers**: Fouling, Tube leak, Thermal stress, Bypass stuck
**Compressors**: Surge, High discharge temperature, Low suction pressure, Vibration
**Analyzers**: Calibration drift, Sample line plugged, Reagent exhausted, Cell contamination
**Strainers/Filters**: Plugged, Differential pressure high, Bypass leaking
**Instrumentation**: Transmitter drift, Signal loss, Cable fault, Power failure

## OUTPUT FORMAT
Return a JSON object with the following structure:

{
  "process_summary": "Brief 2-3 sentence description of what this process appears to do based on the available information",
  "process_dependencies": [
    {
      "upstream": "Equipment/Tag that feeds or controls",
      "downstream": "Equipment/Tag that receives or is controlled",
      "relationship": "Description of the dependency (e.g., 'Pump feeds reactor through control valve')"
    }
  ],
  "failure_patterns": {
    "Equipment Type": [
      {
        "cause": "Root cause description (e.g., 'Plugged strainer', 'Pump trip', 'Valve stiction')",
        "alarms_affected": ["Alarm types that would be triggered"],
        "consequence": "What happens if not addressed"
      }
    ]
  },
  "process_gaps": [
    "Description of what appears to be missing from the data (e.g., 'No reactor temperature alarms present - likely on different unit')"
  ],
  "guidance_for_d_and_r": "Specific recommendations for the D&R drafter to use more process-focused causes and consequences"
}

IMPORTANT: Be specific with causes - use actual process conditions like "Plugged strainer", "Pump tripped", "Loss of cooling water", "Upstream valve closed" rather than generic statements about alarm conditions.`,

    /**
     * Analyze process context from CSV data, process description, and P&ID image
     * Returns structured process understanding for D&R drafting
     */
    async analyzeProcessContext(csvData, processDescription, pidImageBase64, philosophyRules, statusCallback) {
        // Helper to update status if callback provided
        const updateStatus = (msg) => {
            if (statusCallback && typeof statusCallback === 'function') {
                statusCallback(msg);
            }
        };

        console.log('Analyzing process context...', { rows: csvData.length, hasDesc: !!processDescription, hasPid: !!pidImageBase64 });
        updateStatus("Building tag summary...");

        // Build summary of CSV data for analysis
        const tagSummary = this.buildTagSummary(csvData);

        updateStatus("Preparing AI analysis...");

        // Prompt with explicit web search instruction
        // TRUNCATION LOGIC ADDED: Limit the size of summary data to avoid context_length_exceeded
        const safeSampleAlarms = (tagSummary.sampleAlarms || '').substring(0, 2000);
        const safePrefixSummary = (tagSummary.prefixSummary || '').substring(0, 1000);

        const userPrompt = `Analyze this process based on the following information:

## Process Description (provided by user)
${(processDescription || 'Not provided - infer from alarm data').substring(0, 500)}

## Alarm Data Summary
Total alarms: ${csvData.length}

${safePrefixSummary}
... (truncated)

## Sample Alarms
${safeSampleAlarms}
... (truncated)

        ## INSTRUCTIONS
        1. **Initial Understanding**: Use the provided 'tagSummary' to form a hypothesis about the **whole process**.
        2. **Synthesis**: Generate the Process Understanding JSON based ONLY on the provided data.

        IMPORTANT: Your response MUST be valid JSON matching the specified structure. Do not return markdown outside the JSON.`;

        // Updated for Responses API format
        const systemInstructions = this.processAnalyzerPrompt;

        // Build user content (text + optional image)
        let userContent = userPrompt;

        // If P&ID image provided, create multimodal content array
        if (pidImageBase64) {
            userContent = [
                { type: 'text', text: userPrompt },
                {
                    type: 'image_url',
                    image_url: { url: `data:image/jpeg;base64,${pidImageBase64}` }
                }
            ];
        }

        // Responses API input format
        const inputMessages = [
            {
                type: "message",
                role: "user",
                content: userContent
            }
        ];

        // Use Global Responses API endpoint (v1 style)
        // Azure OpenAI pattern for new global features often omits deployment ID from URL
        const responsesEndpoint = `${window.chatbotService.config.endpoint}/openai/v1/responses`;

        const modelName = window.chatbotService.config.drDeploymentName || window.chatbotService.config.deploymentName;

        // Define tools - NO web search for this first step
        const tools = [];

        const requestBody = {
            model: modelName,
            input: inputMessages,  // ✅ Correct - Responses API format
            instructions: systemInstructions,  // ✅ System prompt goes here
            tools: tools,
            temperature: 0.2,  // Add temperature control
            max_output_tokens: 32000  // User requested 32k. NOTE: This might exceed context limits.
        };

        let response;
        try {
            response = await fetch(responsesEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': window.chatbotService.config.apiKey
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                // Check for context length or parameter errors to retry
                if (response.status === 400 && (errorBody.includes('context_length_exceeded') || errorBody.includes('max_tokens'))) {
                    console.warn('Process Analysis: 32k token limit failed, retrying with 4k limit...', errorBody);

                    // Retry with safe 4k limit
                    requestBody.max_output_tokens = 4096;
                    response = await fetch(responsesEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'api-key': window.chatbotService.config.apiKey
                        },
                        body: JSON.stringify(requestBody)
                    });
                } else {
                    // Check retry response or original non-400 error
                    if (!response.ok) {
                        const finalError = response.status === 400 ? await response.text() : errorBody;
                        console.error('API Error Details:', finalError);
                        throw new Error(`Process analysis API request failed: ${response.status} - ${finalError}`);
                    }
                }
            }
        } catch (e) {
            throw e; // Re-throw to be caught by outer handler
        }

        if (!response.ok) {
            // Should be caught above, but safety check
            const errorBody = await response.text();
            throw new Error(`Process analysis API request failed: ${response.status} - ${errorBody}`);
        }

        // Responses API returns an object with an 'output' array
        const responseData = await response.json();

        // Find the message output
        const messageOutput = responseData.output?.find(item => item.type === 'message');
        const textContent = messageOutput?.content?.find(c => c.type === 'output_text');
        let finalContent = textContent?.text || '';

        // If using web search, also look for text in content array
        // Sometimes the text is directly in the content array items if not specifically typed 'output_text'
        if (!finalContent && Array.isArray(messageOutput?.content)) {
            // Try to find any text content
            const textParts = messageOutput.content
                .filter(c => c.type === 'text' || c.type === 'output_text')
                .map(c => c.text || '');
            finalContent = textParts.join('');
        }

        let content = finalContent;

        // Robust JSON extraction
        let processAnalysis;
        try {
            // Remove markdown code blocks
            content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

            // Try to find JSON object boundaries
            const jsonStart = content.indexOf('{');
            const jsonEnd = content.lastIndexOf('}');
            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                content = content.substring(jsonStart, jsonEnd + 1);
            }

            // Fix common JSON issues from LLM output
            content = content
                .replace(/,\s*}/g, '}')  // Remove trailing commas before }
                .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
                .replace(/[\u0000-\u001F]+/g, ' ')  // Remove control characters
                .replace(/\n\s*\n/g, '\n');  // Remove double newlines

            processAnalysis = JSON.parse(content);
        } catch (parseError) {
            console.warn('JSON parse failed, attempting recovery...', parseError);
            console.log('Raw content:', content.substring(0, 500));

            // Create a minimal fallback response
            processAnalysis = {
                process_summary: "Process analysis could not be fully parsed. The LLM returned a malformed response. Please try again or proceed without process analysis.",
                equipment_types: [],
                failure_patterns: {},
                process_gaps: ["Analysis parsing failed - raw data may still be usable"],
                guidance_for_d_and_r: "Use standard process engineering judgment for causes and consequences. Reference equipment type from tag naming conventions."
            };
        }

        console.log('Process analysis complete:', processAnalysis);
        return processAnalysis;
    },

    /**
     * Step 2: Enrich process analysis with Web Search
     * Uses the initial analysis to perform targeted web searches for engineering details.
     */
    async enrichProcessAnalysisWithWebSearch(initialAnalysis, processDescription, statusCallback) {
        const updateStatus = (msg) => {
            if (statusCallback && typeof statusCallback === 'function') statusCallback(msg);
        };

        updateStatus("Step 2: Performing Web Search for Engineering Details...");
        console.log('[DrProcessor] Starting Web Search Enrichment...');

        // Construct prompt for the second step
        const userPrompt = `
I have performed an initial analysis of a process based on alarm data.
Here is the Initial Analysis:
${JSON.stringify(initialAnalysis, null, 2)}

Process Description:
${processDescription || 'Not provided'}

## OBJECTIVE
Use the 'web_search' tool to validate and enrich this analysis with real-world engineering data.

## WEB SEARCH INSTRUCTIONS
1. **Identify the Process**: Search for the likely process unit based on the equipment and description (e.g. "Typical Crude Unit flow", "Ammonia Plant process description").
2. **Find Failure Modes**: Search for specific failure modes of the key equipment identified (e.g., "Centrifugal pump failure modes", "Distillation column flooding symptoms").
3. **Verify Interdependencies**: Check if the deduced dependencies make sense (e.g. "Does reboiler failure cause high column pressure?").

## OUTPUT
Return a merged, enriched JSON object with the SAME structure as the input, but with "web_search_findings" added to each section where applicable, and a new top-level field "web_search_summary".

{
  "process_summary": "...",
  "web_search_summary": "Summary of what was found on the web regarding this process...",
  "process_dependencies": [...],
  "failure_patterns": {...},
  "process_gaps": [...]
}
`;

        const responsesEndpoint = `${window.chatbotService.config.endpoint}/openai/v1/responses`;
        const modelName = window.chatbotService.config.drDeploymentName || window.chatbotService.config.deploymentName;

        const requestBody = {
            model: modelName,
            input: [{
                type: "message",
                role: "user",
                content: userPrompt
            }],
            tools: [{ type: "web_search_preview" }], // Enable web search for step 2
            temperature: 0.2,
            max_output_tokens: 128000
        };

        try {
            const response = await fetch(responsesEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-key': window.chatbotService.config.apiKey
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const text = await response.text();
                console.error('[DrProcessor] Web Search Step Failed:', text);
                // Return initial analysis if step 2 fails, effectively skipping it
                return {
                    ...initialAnalysis,
                    web_search_summary: "Web search step failed or timed out. Showing initial analysis only."
                };
            }

            const data = await response.json();
            console.log('[DrProcessor] Web Search Enrichment Response:', data);

            // Extract content with support for both standard ChatCompletion and Responses API (output array)
            let content = '';
            if (data.output && Array.isArray(data.output)) {
                // Responses API format: output is an array of items (messages, tool calls, etc.)
                // We want the last message from the assistant
                const assistantMessage = data.output
                    .filter(item => item.type === 'message' && item.role === 'assistant')
                    .pop();
                if (assistantMessage) {
                    content = assistantMessage.content;
                }
            } else if (data.choices && data.choices[0] && data.choices[0].message) {
                content = data.choices[0].message.content;
            } else if (data.message && data.message.content) {
                content = data.message.content;
            }

            // Parse JSON
            let jsonResult;
            try {
                // Ensure content is a string
                if (typeof content !== 'string') {
                    content = JSON.stringify(content);
                }

                const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
                const start = jsonStr.indexOf('{');
                const end = jsonStr.lastIndexOf('}');
                if (start !== -1 && end !== -1) {
                    jsonResult = JSON.parse(jsonStr.substring(start, end + 1));
                } else {
                    throw new Error('No JSON found in Step 2 response');
                }
            } catch (e) {
                console.error('Failed to parse Step 2 JSON', e);
                return {
                    ...initialAnalysis,
                    web_search_summary: "Failed to parse web search results. Raw output: " + String(content).substring(0, 200) + "..."
                };
            }


            return { ...initialAnalysis, ...jsonResult };

        } catch (error) {
            console.error('[DrProcessor] Error in Step 2:', error);
            // Fallback: return initial analysis with a note
            return {
                ...initialAnalysis,
                web_search_summary: "Web search step encountered an error. Showing initial analysis results."
            };
        }
    },

    /**
     * Build a summary of tags from CSV data for process analysis
     */
    buildTagSummary(csvData) {
        const prefixCounts = {};
        const uniqueTags = new Map();

        csvData.forEach(row => {
            const tag = row.Tag || row.tag || '';
            const desc = row.Description || row.description || '';
            const alarm = row.AlarmDisplayName || row.Alarm || '';

            // Extract prefix (first 1-3 letters)
            const prefix = tag.replace(/[0-9]/g, '').substring(0, 3).toUpperCase();
            if (prefix) {
                prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
            }

            // Store unique tags with descriptions
            if (!uniqueTags.has(tag) && tag) {
                uniqueTags.set(tag, { tag, desc, alarm });
            }
        });

        // Format prefix summary
        const prefixSummary = Object.entries(prefixCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([prefix, count]) => `- ${prefix}: ${count} alarms`)
            .join('\n');

        // Format all unique alarms with descriptions (token optimization: only unique tags are sent)
        const sampleAlarms = Array.from(uniqueTags.values())
            .map(t => `- ${t.tag} (${t.alarm}): ${t.desc}`)
            .join('\n');

        return { prefixSummary, sampleAlarms };
    },

    // ============================================
    // PDF EXTRACTION
    // ============================================

    /**
     * Extract text from PDF file and convert to markdown-like format
     */
    async extractPdfText(file) {
        return new Promise(async (resolve, reject) => {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                let fullText = '';

                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();

                    // Convert to markdown-like format
                    let pageText = `\n## Page ${pageNum}\n\n`;
                    let lastY = null;
                    let lineText = '';

                    for (const item of textContent.items) {
                        // Detect line breaks based on Y position
                        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                            pageText += lineText.trim() + '\n';
                            lineText = '';
                        }
                        lineText += item.str + ' ';
                        lastY = item.transform[5];
                    }
                    pageText += lineText.trim() + '\n';
                    fullText += pageText;
                }

                console.log('Extracted PDF text:', fullText.substring(0, 500) + '...');
                resolve(fullText);
            } catch (error) {
                console.error('PDF extraction failed:', error);
                reject(error);
            }
        });
    },

    /**
     * Extract philosophy rules using LLM
     */
    async extractPhilosophyRules(pdfFile) {
        if (!window.chatbotService.isConfigured()) {
            throw new Error('Azure OpenAI is not configured. Please configure it in Settings.');
        }

        // Extract text from PDF
        const pdfText = await this.extractPdfText(pdfFile);

        // Send to LLM for rule extraction
        const endpoint = `${window.chatbotService.config.endpoint}/openai/deployments/${window.chatbotService.config.drDeploymentName || window.chatbotService.config.deploymentName}/chat/completions?api-version=${window.chatbotService.config.apiVersion}`;

        const messages = [
            { role: 'system', content: this.systemPrompts.philosophyExtractor },
            { role: 'user', content: `Extract alarm philosophy rules from this document:\n\n${pdfText}` }
        ];

        const requestBody = this.buildApiRequestBody(messages, { maxTokens: 32000, temperature: 0.2 });

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': window.chatbotService.config.apiKey
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API request failed: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        let content = data.choices[0].message.content;

        // Robust JSON Extraction
        content = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const jsonStart = content.indexOf('{');
        const jsonEnd = content.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            content = content.substring(jsonStart, jsonEnd + 1);
        }

        // Fix common JSON issues
        content = content
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']');

        try {
            const rules = JSON.parse(content);
            console.log('Extracted philosophy rules:', rules);
            return rules;
        } catch (e) {
            console.error('Philosophy JSON parse error:', e);
            console.log('Raw content:', content);
            throw new Error(`Failed to parse AI response: ${e.message}`);
        }
    },

    // ============================================
    // HELPER: GET FULL ALARM NAME
    // ============================================

    getFullAlarmName(alarm) {
        const tag = alarm.Tag || alarm.tag || '';
        const alarmType = alarm.AlarmDisplayName || alarm.Alarm || alarm['Alarm Type'] || '';
        return alarmType ? `${tag} ${alarmType}` : tag;
    },

    // ============================================
    // TAG PARSING & GROUPING
    // ============================================

    // Configuration for code letter parsing
    codeLetterSwitchCount: 2, // 1 = first switch, 2 = second switch (default)

    /**
     * Parse tag code letter based on letter-to-digit switch count
     * Example with "T3E0306C":
     *   - switchCount=1: "T" (stops at first letter→digit: T→3)
     *   - switchCount=2: "T3E" (stops at second letter→digit: E→0)
     * Example with "B3PC30036":
     *   - switchCount=1: "B" (stops at first letter→digit: B→3)
     *   - switchCount=2: "B3PC" (stops at second letter→digit: C→3)
     */
    parseTagCodeLetter(tag, rule = null) {
        if (!tag || typeof tag !== 'string') return '';

        const trimmedTag = tag.trim().toUpperCase();

        // 1. Handle Rule Object (e.g., from AI or config)
        if (rule && typeof rule === 'object') {
            // Regex Rule
            if (rule.type === 'regex' && (rule.regex || rule.pattern)) {
                try {
                    const regexStr = rule.regex || rule.pattern;
                    const re = new RegExp(regexStr, 'i');
                    const match = re.exec(trimmedTag);
                    if (match) {
                        // Prioritize captured group (match[1]), fallback to full match (match[0])
                        return (match[1] || match[0]).toUpperCase();
                    }
                } catch (e) {
                    console.warn(`[DrProcessor] Regex error for tag "${tag}":`, e);
                }
            }
            // Add other rule types here if needed (e.g., 'substring', 'split')
        }

        // 2. Default Legacy Logic: Letter -> Digit transition counting
        // (Only used if rule is null or invalid/non-matching regex)
        // If a number is passed as 'rule', treat it as switchCountOverride (legacy behavior)
        const switchCount = (typeof rule === 'number') ? rule : (this.codeLetterSwitchCount || 2);

        let letterToDigitTransitions = 0;
        let result = '';
        let prevWasLetter = null;

        for (let i = 0; i < trimmedTag.length; i++) {
            const char = trimmedTag[i];
            const isDigit = /\d/.test(char);
            const isLetter = /[A-Z]/.test(char);

            if (!isDigit && !isLetter) break;

            if (prevWasLetter === true && isDigit) {
                letterToDigitTransitions++;
                if (letterToDigitTransitions >= switchCount) break;
            }

            result += char;
            prevWasLetter = isLetter;
        }

        return result || trimmedTag.substring(0, 4);
    },

    isDRComplete(row) {
        const drComplete = row['D&R Complete'] || row['DRComplete'] || row['drComplete'];
        return drComplete === true || drComplete === 'TRUE' || drComplete === 'true';
    },

    groupByCodeLetter(data, rule = null) {
        const groups = new Map();
        data.forEach((row, index) => {
            const tag = row.Tag || row.tag || '';
            const unit = row.Unit || row.unit || 'Unknown Unit';

            // Use pre-calculated TagPrefix if no rule is provided
            // Otherwise, calculate it on the fly using the provided rule
            let codeLetter;

            if (!rule && row.TagPrefix) {
                codeLetter = row.TagPrefix;
            } else {
                codeLetter = this.parseTagCodeLetter(tag, rule);
            }

            // Create composite key for grouping: Unit - Prefix
            // This ensures alarms from different units are kept separate
            const compositeKey = `${unit} - ${codeLetter}`;

            if (!groups.has(compositeKey)) {
                groups.set(compositeKey, {
                    codeLetter: compositeKey, // Unique ID for finding/toggling
                    displayPrefix: codeLetter, // What to show in the accordion label (e.g., "TI")
                    unit: unit,                // For hierarchical rendering
                    alarms: [],
                    completedCount: 0,
                    incompleteCount: 0
                });
            }
            const group = groups.get(compositeKey);
            const isComplete = this.isDRComplete(row);
            group.alarms.push({ ...row, _index: index, _isComplete: isComplete });
            if (isComplete) group.completedCount++;
            else group.incompleteCount++;
        });
        return Array.from(groups.values())
            .map(group => {
                // Sort alarms within the group
                group.alarms.sort((a, b) => {
                    // 1. Primary Sort: Alarm Type (e.g., 'Type', 'Condition')
                    // Robust check for various column names
                    const typeA = (a.Type || a.type || a.Condition || a.condition || '').toString().toLowerCase();
                    const typeB = (b.Type || b.type || b.Condition || b.condition || '').toString().toLowerCase();

                    if (typeA < typeB) return -1;
                    if (typeA > typeB) return 1;

                    // 2. Secondary Sort: Description (for equipment similarity)
                    const descA = (a.Description || a.description || a.Desc || a.desc || '').toString().toLowerCase();
                    const descB = (b.Description || b.description || b.Desc || b.desc || '').toString().toLowerCase();

                    if (descA < descB) return -1;
                    if (descA > descB) return 1;

                    return 0;
                });
                return group;
            })
            // Sort groups primarily by Unit, then by Prefix
            .sort((a, b) => {
                const unitA = (a.unit || '').toString().toLowerCase();
                const unitB = (b.unit || '').toString().toLowerCase();
                if (unitA < unitB) return -1;
                if (unitA > unitB) return 1;
                return a.displayPrefix.localeCompare(b.displayPrefix);
            });
    },

    // ============================================
    // VALUE PROPAGATION FROM D&R COMPLETE
    // ============================================

    /**
     * Find golden record (D&R complete) values for a functional group
     */
    findGoldenRecordValues(group) {
        const completed = group.alarms.filter(a => a._isComplete);
        if (completed.length === 0) return null;

        // Take values from first completed record
        const golden = completed[0];
        const values = {};

        this.PROPAGATABLE_FIELDS.forEach(field => {
            if (golden[field] && golden[field].toString().trim() !== '') {
                values[field] = golden[field];
            }
        });

        return Object.keys(values).length > 0 ? values : null;
    },

    /**
     * Propagate values from D&R complete records to incomplete ones within same group
     */
    propagateWithinGroups(groups) {
        const propagated = [];

        groups.forEach(group => {
            const goldenValues = this.findGoldenRecordValues(group);
            if (!goldenValues) return;

            group.alarms.forEach(alarm => {
                if (alarm._isComplete) return;

                let updated = false;
                const updatedAlarm = { ...alarm };

                this.PROPAGATABLE_FIELDS.forEach(field => {
                    if (goldenValues[field] && (!alarm[field] || alarm[field].toString().trim() === '')) {
                        updatedAlarm[field] = goldenValues[field];
                        updatedAlarm[`_propagated_${field}`] = true;
                        updated = true;
                    }
                });

                if (updated) {
                    propagated.push({
                        tag: alarm.Tag || alarm.tag,
                        fields: Object.keys(goldenValues),
                        source: group.alarms.find(a => a._isComplete)?.Tag || 'Golden Record'
                    });
                }
            });
        });

        return propagated;
    },

    // ============================================
    // BATCH AI DRAFTING
    // ============================================

    async batchDraftRationalizations(alarms, processContext, philosophyRules, imageBase64, onProgress, processAnalysis = null) {
        if (!window.chatbotService.isConfigured()) {
            throw new Error('Azure OpenAI is not configured.');
        }

        const results = [];
        const BATCH_SIZE = 10;
        const batches = [];

        for (let i = 0; i < alarms.length; i += BATCH_SIZE) {
            batches.push(alarms.slice(i, i + BATCH_SIZE));
        }

        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
            const batch = batches[batchIdx];

            if (onProgress) {
                const percent = ((batchIdx + 1) / batches.length) * 100;
                onProgress(percent, `Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} alarms)...`);
            }

            try {
                // Pass previous results for consistency within same tag groups
                const previousResults = results.filter(r => r.success);
                const batchResults = await this.processSingleBatch(batch, processContext, philosophyRules, imageBase64, previousResults, processAnalysis);
                results.push(...batchResults);
            } catch (error) {
                batch.forEach(alarm => {
                    results.push({ alarm, success: false, error: error.message });
                });
            }

            if (batchIdx < batches.length - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        return results;
    },

    async processSingleBatch(alarms, processContext, philosophyRules, imageBase64, previousResults = [], processAnalysis = null) {
        // Build alarm list with FULL ALARM NAMES
        const alarmList = alarms.map((a, i) => {
            const fullName = this.getFullAlarmName(a);
            const desc = a.Description || a.description || '';
            return `${i + 1}. Full Alarm Name: ${fullName}\n   Description: ${desc}`;
        }).join('\n\n');

        const rulesContext = philosophyRules ?
            `\nPhilosophy Rules:\n- Priority Matrix: ${JSON.stringify(philosophyRules.priority_matrix || [])}\n- Severity Matrix: ${JSON.stringify(philosophyRules.severity_matrix || [])}`
            : '';

        // Build process analysis context if available
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

        // Build context from D&R-complete alarms on same tags as reference examples
        let referenceContext = '';
        const currentTags = new Set(alarms.map(a => a.Tag || a.tag));

        // Find D&R-complete alarms from same tags (from the original alarm data)
        const drCompleteExamples = alarms
            .filter(a => a._isComplete && (a.Cause1 || a.Consequence1 || a['Corrective Action1']))
            .slice(0, 3); // Limit to 3 examples to save tokens

        if (drCompleteExamples.length > 0) {
            const examples = drCompleteExamples.map(a => {
                const fullName = this.getFullAlarmName(a);
                return `- ${fullName}:\n    Cause: ${a.Cause1 || 'N/A'}\n    Consequence: ${a.Consequence1 || 'N/A'}\n    Corrective Action: ${a['Corrective Action1'] || 'N/A'}\n    Priority: ${a['Proposed Priority'] || a.Priority || 'N/A'}`;
            }).join('\n');
            referenceContext = `\n\nREFERENCE ALARMS (D&R Complete - use as templates for similar alarms):\n${examples}\nIMPORTANT: When you use a reference alarm's pattern, cite it in your Reasoning like: "Based on similar alarm [AlarmName]..."\n`;
        }

        // Build context from previously drafted alarms on same tags for consistency
        let previousContext = '';
        if (previousResults.length > 0) {
            const relevantPrevious = previousResults.filter(r => currentTags.has(r.alarm.Tag || r.alarm.tag));

            if (relevantPrevious.length > 0) {
                const prevSummary = relevantPrevious.map(r =>
                    `- ${r.fullAlarmName}: Priority=${r.draft['Proposed Priority']}, ResponseTime=${r.draft['Max Time to Respond']}`
                ).join('\n');
                previousContext = `\n\nPREVIOUSLY DRAFTED ALARMS ON SAME TAGS (for consistency):\n${prevSummary}\nEnsure new alarms on the same tag use consistent priority logic.\n`;
            }
        }

        // Get detected priority scheme for consistent output naming
        const prioritySchemeInstruction = this.detectedPriorityScheme === 'descriptive'
            ? `\n\nIMPORTANT - PRIORITY NAMING: The source data uses DESCRIPTIVE priority names (High, Medium, Low, Urgent, etc.). Your Proposed Priority values MUST use the same descriptive naming style (e.g., "High", "Medium", "Low", "Urgent", "None", "Remove"). Do NOT use numeric priority names like "Priority 1" for this dataset.\n`
            : `\n\nIMPORTANT - PRIORITY NAMING: The source data uses NUMERIC priority names (Priority 1, Priority 2, Priority 3, etc.). Your Proposed Priority values MUST use the same numeric naming style (e.g., "Priority 1", "Priority 2", "Priority 3", "No Alarm", "Remove"). Do NOT use descriptive names like "High" for this dataset.\n`;

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

        const messages = [
            { role: 'system', content: this.systemPrompts.batchDrafter },
            { role: 'user', content: userPrompt }
        ];

        if (imageBase64) {
            messages[1] = {
                role: 'user',
                content: [
                    { type: 'text', text: userPrompt },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            };
        }

        const endpoint = `${window.chatbotService.config.endpoint}/openai/deployments/${window.chatbotService.config.drDeploymentName || window.chatbotService.config.deploymentName}/chat/completions?api-version=${window.chatbotService.config.apiVersion}`;

        // Use buildApiRequestBody for GPT-5 compatibility
        // Lower temperature (0.2) for consistency - same alarm types should get same attributes
        const requestBody = this.buildApiRequestBody(messages, { maxTokens: 32000, temperature: 0.2 });

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': window.chatbotService.config.apiKey
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        let content = data.choices[0].message.content;
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();

        const drafts = JSON.parse(content);

        return alarms.map((alarm, i) => {
            const fullName = this.getFullAlarmName(alarm);
            const draft = drafts.find(d => d.fullAlarmName === fullName) || drafts[i];

            if (draft) {
                return {
                    alarm,
                    fullAlarmName: fullName,
                    draft: {
                        Cause: 'AI: ' + (draft.Cause || ''),
                        Consequence: 'AI: ' + (draft.Consequence || ''),
                        'Corrective Action': 'AI: ' + (draft['Corrective Action'] || ''),
                        'Proposed Priority': 'AI: ' + (draft['Proposed Priority'] || ''),
                        'Max Time to Respond': 'AI: ' + (draft['Max Time to Respond'] || ''),
                        'AI Reasoning': draft.Reasoning || ''
                    },
                    success: true
                };
            } else {
                return { alarm, fullAlarmName: fullName, success: false, error: 'No draft returned' };
            }
        });
    },

    // ============================================
    // SMART COLUMN ASSIGNMENT
    // ============================================

    findNextAvailableSlot(row, fieldBase) {
        for (let i = 1; i <= 5; i++) {
            const colName = `${fieldBase}${i}`;
            const value = row[colName];
            if (!value || value.toString().trim() === '') {
                return colName;
            }
        }
        return `${fieldBase}6`;
    },

    applyDraftsToData(originalData, draftResults) {
        const updatedData = [...originalData];

        draftResults.forEach(result => {
            if (!result.success) return;

            // Match by BOTH Tag AND Alarm to ensure correct mapping
            const tag = result.alarm.Tag || result.alarm.tag;
            const alarm = result.alarm.Alarm || result.alarm.alarm || result.alarm.AlarmDisplayName || '';

            const idx = updatedData.findIndex(a => {
                const aTag = a.Tag || a.tag;
                const aAlarm = a.Alarm || a.alarm || a.AlarmDisplayName || '';
                return aTag === tag && aAlarm === alarm;
            });

            if (idx >= 0) {
                const row = updatedData[idx];
                const draft = result.draft;

                // Find next available slots
                const causeCol = this.findNextAvailableSlot(row, 'Cause');
                const conseqCol = this.findNextAvailableSlot(row, 'Consequence');
                const correctiveCol = this.findNextAvailableSlot(row, 'Corrective Action');

                updatedData[idx] = {
                    ...row,
                    [causeCol]: draft.Cause,
                    [conseqCol]: draft.Consequence,
                    [correctiveCol]: draft['Corrective Action'],
                    'AI Reasoning': draft['AI Reasoning'] || '',
                    // Apply priority and response time if not already set
                    'Proposed Priority': row['Proposed Priority'] || draft['Proposed Priority'],
                    'Max Time to Respond': row['Max Time to Respond'] || draft['Max Time to Respond'],
                    'Max Response Time': row['Max Response Time'] || draft['Max Response Time'] || row['Max Time to Respond'] || draft['Max Time to Respond'],
                    '_aiDrafted': true
                };
            }
        });

        return updatedData;
    },

    // ============================================
    // CONSISTENCY CHECK
    // ============================================

    runConsistencyCheck(groups) {
        const results = {
            totalGroups: groups.length,
            groupsWithIssues: 0,
            allInconsistencies: [],
            overrideIssues: []
        };

        groups.forEach(group => {
            // Check consistency within completed records
            const completedAlarms = group.alarms.filter(a => a._isComplete);
            if (completedAlarms.length >= 2) {
                const reference = completedAlarms[0];
                const fields = ['Proposed Priority', 'Max Response Time'];

                for (let i = 1; i < completedAlarms.length; i++) {
                    const current = completedAlarms[i];
                    const differences = fields.filter(f =>
                        (reference[f] || '').toString().toLowerCase() !== (current[f] || '').toString().toLowerCase()
                    );

                    if (differences.length > 0) {
                        results.groupsWithIssues++;
                        results.allInconsistencies.push({
                            codeLetter: group.codeLetter,
                            referenceTag: reference.Tag || reference.tag,
                            comparedTag: current.Tag || current.tag,
                            differences
                        });
                    }
                }
            }

            // Check override reason consistency
            group.alarms.forEach(alarm => {
                const overrideReason = (alarm['Override Reason'] || '').toLowerCase();
                const overridePriority = alarm['Override Priority'];

                if (overrideReason.includes('not configured')) {
                    const hasSetpoint = alarm['HI'] || alarm['LO'] || alarm['HIHI'] || alarm['LOLO'] || alarm['Setpoint'];
                    if (hasSetpoint) {
                        results.overrideIssues.push({
                            tag: alarm.Tag || alarm.tag,
                            issue: 'Override says "not configured" but setpoint exists'
                        });
                    }
                }

                if (overridePriority && !overrideReason) {
                    results.overrideIssues.push({
                        tag: alarm.Tag || alarm.tag,
                        issue: 'Override Priority set but no Override Reason'
                    });
                }
            });
        });

        return results;
    },

    // ============================================
    // COMPLIANCE CHECK
    // ============================================

    checkComplianceLocal(alarm, philosophyRules) {
        const violations = [];
        const priority = (alarm['Proposed Priority'] || alarm['Priority'] || '').toUpperCase();

        // Check severity vs priority from philosophy
        const severities = [alarm['Severity1'], alarm['Severity2'], alarm['Severity3'], alarm['Severity4']].filter(s => s);
        const hasMajorSeverity = severities.some(s => s && s.toString().toLowerCase().includes('major'));
        const hasCriticalSeverity = severities.some(s => s && s.toString().toLowerCase().includes('critical'));

        if (hasMajorSeverity && priority.includes('LOW')) {
            violations.push({
                rule: 'Severity-Priority Mismatch',
                reason: 'Major severity with Low priority',
                suggested_fix: 'Change priority to at least Medium'
            });
        }

        if (hasCriticalSeverity && (priority.includes('LOW') || priority.includes('MEDIUM'))) {
            violations.push({
                rule: 'Critical Severity Violation',
                reason: 'Critical severity requires High/Critical priority',
                suggested_fix: 'Change priority to High or Critical'
            });
        }

        return { compliant: violations.length === 0, violations };
    },

    // ============================================
    // CSV PARSING & EXPORT
    // ============================================

    async parseMADbCSV(file) {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                delimiter: ';',
                complete: (results) => {
                    if (results.data.length > 0 && Object.keys(results.data[0]).length <= 1) {
                        Papa.parse(file, {
                            header: true,
                            skipEmptyLines: true,
                            delimiter: ',',
                            complete: (results2) => resolve(this.normalizeMADbData(results2.data)),
                            error: reject
                        });
                    } else {
                        resolve(this.normalizeMADbData(results.data));
                    }
                },
                error: reject
            });
        });
    },

    normalizeMADbData(data) {
        // Detect priority scheme from the data
        this.detectPriorityScheme(data);

        return data.map((row, index) => {
            const tag = row.Tag || row.tag || '';

            // Simple leading letters extraction for grouping
            const match = tag.trim().toUpperCase().match(/^([A-Z]+)/);
            const simplePrefix = match ? match[1] : '';

            return {
                ...row,
                _originalIndex: index,
                _isComplete: this.isDRComplete(row),
                _fullAlarmName: this.getFullAlarmName(row),
                // Pre-calculate TagPrefix using simple leading letters logic
                TagPrefix: simplePrefix
            };
        });
    },

    exportToCSV(data, filename = 'rationalized_madb.csv') {
        const csv = Papa.unparse(data.map(row => {
            const { _index, _isComplete, _originalIndex, _propagatedFrom, _aiDrafted, _draftDetails, _fullAlarmName, ...cleanRow } = row;
            // Remove any _propagated_* fields
            Object.keys(cleanRow).forEach(k => {
                if (k.startsWith('_propagated_')) delete cleanRow[k];
            });
            return cleanRow;
        }), { delimiter: ';' });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
    },

    /**
     * Export only selected/drafted alarms to CSV
     */
    exportSelectedToCSV(allData, draftResults, filename = 'rationalized_selected.csv') {
        // Get only the alarms that were drafted - match by Tag + Alarm
        const draftedKeys = new Set(draftResults.filter(r => r.success).map(r => {
            const tag = r.alarm.Tag || r.alarm.tag;
            const alarm = r.alarm.Alarm || r.alarm.alarm || r.alarm.AlarmDisplayName || '';
            return `${tag}||${alarm}`;
        }));

        const selectedData = allData.filter(row => {
            const tag = row.Tag || row.tag;
            const alarm = row.Alarm || row.alarm || row.AlarmDisplayName || '';
            return draftedKeys.has(`${tag}||${alarm}`);
        });

        if (selectedData.length === 0) {
            alert('No drafted alarms to export.');
            return;
        }

        this.exportToCSV(selectedData, filename);
        console.log(`Exported ${selectedData.length} drafted alarms to CSV`);
    },

    /**
     * Export only selected/drafted alarms to JSON
     */
    exportSelectedToJSON(allData, draftResults, filename = 'rationalized_selected.json') {
        // Get only the alarms that were drafted - match by Tag + Alarm
        const draftedKeys = new Set(draftResults.filter(r => r.success).map(r => {
            const tag = r.alarm.Tag || r.alarm.tag;
            const alarm = r.alarm.Alarm || r.alarm.alarm || r.alarm.AlarmDisplayName || '';
            return `${tag}||${alarm}`;
        }));

        const selectedData = allData.filter(row => {
            const tag = row.Tag || row.tag;
            const alarm = row.Alarm || row.alarm || row.AlarmDisplayName || '';
            return draftedKeys.has(`${tag}||${alarm}`);
        });

        if (selectedData.length === 0) {
            alert('No drafted alarms to export.');
            return;
        }

        // Clean internal fields
        const cleanData = selectedData.map(row => {
            const { _index, _isComplete, _originalIndex, _propagatedFrom, _aiDrafted, _draftDetails, _fullAlarmName, ...cleanRow } = row;
            Object.keys(cleanRow).forEach(k => {
                if (k.startsWith('_propagated_')) delete cleanRow[k];
            });
            return cleanRow;
        });

        const json = JSON.stringify(cleanData, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        console.log(`Exported ${cleanData.length} drafted alarms to JSON`);
    }
};

console.log('D&R Processor Service v4 loaded');

