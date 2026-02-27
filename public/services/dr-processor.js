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
     * Derive a consolidated parsing rule from multiple examples.
     * Logic runs server-side; calls /api/analysis/derive-rule.
     * @param {Array} examples - Array of { tag, prefix } objects
     * @returns {Promise<Object>} Rule object
     */
    async deriveConsolidatedRule(examples) {
        if (!examples || examples.length === 0) return null;
        const validExamples = examples.filter(e => e.tag && e.prefix);
        if (validExamples.length === 0) return null;

        try {
            const response = await fetch('/api/analysis/derive-rule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ examples: validExamples })
            });
            if (!response.ok) throw new Error(`derive-rule failed: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('[DrProcessor] deriveConsolidatedRule error:', error);
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

        try {
            console.log('[DrProcessor] Requesting AI Rule Derivation via /api/dr/derive-regex...');

            // Call backend API for regex derivation (backend constructs the prompt)
            const response = await fetch('/api/dr/derive-regex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    examples: validExamples
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }

            const data = await response.json();

            // Clean response: remove markdown code blocks and HTML tags if present
            let jsonStr = data.content;

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
     * Detect unique tag patterns from alarm data.
     * Logic runs server-side; calls /api/analysis/detect-patterns.
     * @param {Array} data - Array of alarm records with Tag field
     * @param {number} maxExamples - Maximum number of examples to return (default 5)
     * @returns {Promise<Array>} Array of { tag, suggestedPrefix, pattern, count } objects
     */
    async detectTagPatterns(data, maxExamples = 5) {
        if (!data || !Array.isArray(data) || data.length === 0) return [];
        try {
            const response = await fetch('/api/analysis/detect-patterns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data, maxExamples })
            });
            if (!response.ok) throw new Error(`detect-patterns failed: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('[DrProcessor] detectTagPatterns error:', error);
            return [];
        }
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
            console.log('[API Test] Testing connection via backend...');

            const response = await fetch('/api/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deploymentType: 'dr' })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('[API Test] Failed:', response.status, errorData);
                return {
                    success: false,
                    message: `API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`,
                    status: response.status
                };
            }

            const data = await response.json();

            console.log('[API Test] Response:', data);

            return {
                success: true,
                message: data.message,
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

        // Call backend API (backend injects server-side prompts)
        let response;
        try {
            response = await fetch('/api/dr/analyze-process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userPrompt: userContent.type ? userContent : (typeof userContent === 'string' ? userContent : JSON.stringify(userContent)),
                    pidImageBase64: pidImageBase64,
                    modelConfig: {
                        deploymentType: 'dr',
                        reasoningEffort: window.chatbotService.config.reasoningEffort
                    },
                    maxOutputTokens: 32000
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Process analysis API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
            }
        } catch (e) {
            throw e; // Re-throw to be caught by outer handler
        }

        // Parse response from backend
        const responseData = await response.json();
        window.costLogger?.log('Process Analysis (Step 1)', responseData.deployment, responseData.usage);

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
            const response = await fetch('/api/dr/web-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userPrompt: userPrompt,
                    modelConfig: {
                        deploymentType: 'dr',
                        reasoningEffort: window.chatbotService.config.reasoningEffort
                    },
                    maxOutputTokens: 128000
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('[DrProcessor] Web Search Step Failed:', errorData);
                // Return initial analysis if step 2 fails, effectively skipping it
                return {
                    ...initialAnalysis,
                    web_search_summary: "Web search step failed or timed out. Showing initial analysis only."
                };
            }

            const data = await response.json();
            window.costLogger?.log('Web Search Enrichment (Step 2)', data.deployment, data.usage);
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
        // Extract text from PDF
        const pdfText = await this.extractPdfText(pdfFile);

        // Call backend API for philosophy extraction
        const response = await fetch('/api/dr/extract-philosophy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pdfText: pdfText,
                modelConfig: {
                    deploymentType: 'dr',
                    reasoningEffort: window.chatbotService.config.reasoningEffort
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
        }

        const data = await response.json();
        window.costLogger?.log('Philosophy Extraction', data.deployment, data.usage);
        let content = data.content;

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

    /**
     * Detect alarm threshold level from AlarmDisplayName.
     * Returns 2 for HH/LL alarms, 1 for H/L alarms, 0 for non-threshold alarms.
     * HH/LL patterns are checked FIRST to prevent HIHI/LOLO from matching H/L patterns.
     */
    getAlarmLevel(alarmDisplayName) {
        if (!alarmDisplayName) return 0;
        const name = alarmDisplayName.toUpperCase();
        // HH / LL (double-threshold) — check before H/L to avoid false matches inside HIHI/LOLO
        if (/HIGHHIGH/.test(name)) return 2;
        if (/LOWLOW/.test(name))   return 2;
        if (/HIHI/.test(name))     return 2;
        if (/LOLO/.test(name))     return 2;
        if (/HH$/.test(name))      return 2;
        if (/LL$/.test(name))      return 2;
        // H / L (single-threshold)
        if (/HIGH/.test(name))     return 1;
        if (/LOW/.test(name))      return 1;
        if (/HI$/.test(name))      return 1;
        if (/LO$/.test(name))      return 1;
        return 0; // non-threshold (BADPV, CMDDIS, CHGOFST, etc.)
    },

    /**
     * Sort alarms so that within each tag, H/L alarms always precede HH/LL alarms.
     * This mirrors D&R workshop practice: rationalize the pre-alarm first, then
     * use it as the baseline for the more critical double-threshold alarm.
     * Sort order: Tag (asc) → alarm level (0→1→2) → AlarmDisplayName (asc)
     */
    sortAlarmsForDR(alarms) {
        return [...alarms].sort((a, b) => {
            const tagA = (a.Tag || a.tag || '').toUpperCase();
            const tagB = (b.Tag || b.tag || '').toUpperCase();
            if (tagA < tagB) return -1;
            if (tagA > tagB) return 1;

            const levelA = this.getAlarmLevel(a.AlarmDisplayName || a.alarmDisplayName || '');
            const levelB = this.getAlarmLevel(b.AlarmDisplayName || b.alarmDisplayName || '');
            if (levelA !== levelB) return levelA - levelB;

            const nameA = (a.AlarmDisplayName || a.alarmDisplayName || '').toUpperCase();
            const nameB = (b.AlarmDisplayName || b.alarmDisplayName || '').toUpperCase();
            return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
        });
    },

    async batchDraftRationalizations(alarms, processContext, philosophyRules, imageBase64, onProgress, processAnalysis = null) {
        if (!window.chatbotService.isConfigured()) {
            throw new Error('Azure OpenAI is not configured.');
        }

        window.costLogger?.reset();
        const results = [];
        const BATCH_SIZE = 10;
        const batches = [];

        // Sort alarms so H/L precedes HH/LL within each tag group before batching
        const sortedAlarms = this.sortAlarmsForDR(alarms);

        for (let i = 0; i < sortedAlarms.length; i += BATCH_SIZE) {
            batches.push(sortedAlarms.slice(i, i + BATCH_SIZE));
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

        window.costLogger?.summary();
        return results;
    },

    async processSingleBatch(alarms, processContext, philosophyRules, imageBase64, previousResults = [], processAnalysis = null) {
        // Prepare reference alarms (D&R-complete examples from same tags)
        const drCompleteExamples = alarms
            .filter(a => a._isComplete && (a.Cause1 || a.Consequence1 || a['Corrective Action1']))
            .slice(0, 3); // Limit to 3 examples to save tokens

        // Prepare previously drafted alarms on same tags for consistency
        const currentTags = new Set(alarms.map(a => a.Tag || a.tag));
        const relevantPrevious = previousResults.filter(r => currentTags.has(r.alarm.Tag || r.alarm.tag));

        // Call backend API with structured data (backend assembles the prompt)
        let response;
        try {
            response = await fetch('/api/dr/batch-rationalize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    alarms: alarms,
                    processContext: processContext,
                    philosophyRules: philosophyRules,
                    processAnalysis: processAnalysis,
                    referenceAlarms: drCompleteExamples,
                    previousDrafts: relevantPrevious,
                    detectedPriorityScheme: this.detectedPriorityScheme || 'numeric',
                    pidImageBase64: imageBase64,
                    modelConfig: {
                        deploymentType: 'dr',
                        reasoningEffort: window.chatbotService.config.reasoningEffort
                    },
                    maxTokens: 32000,
                    temperature: 0.2
                })
            });
        } catch (fetchError) {
            if (fetchError instanceof TypeError) {
                throw new Error('Session expired — please refresh the page to re-authenticate.');
            }
            throw fetchError;
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API request failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
        }

        const data = await response.json();
        const batchNum = (window.costLogger?._session?.calls?.filter(c => c.step.startsWith('Batch')).length ?? 0) + 1;
        window.costLogger?.log(`Batch ${batchNum} Rationalization`, data.deployment, data.usage);
        let content = data.content;
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
                        'AI Reasoning': draft.Reasoning || '',
                        'severity_per_category': Array.isArray(draft.severity_per_category) ? draft.severity_per_category : []
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

                // Write AI-assessed severities back to existing SeverityN columns.
                // For each severity_per_category entry, find the ImpactN column whose value
                // matches the category and write the AI severity into the corresponding SeverityN.
                const severityUpdates = {};
                if (Array.isArray(draft['severity_per_category'])) {
                    draft['severity_per_category'].forEach(sc => {
                        for (let n = 1; n <= 8; n++) {
                            const cat = row[`Impact${n}`];
                            if (cat && cat.toString().trim() === sc.category) {
                                severityUpdates[`Severity${n}`] = 'AI: ' + (sc.severity || 'NONE');
                                break;
                            }
                        }
                    });
                }

                updatedData[idx] = {
                    ...row,
                    ...severityUpdates,
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
            const { _index, _isComplete, _originalIndex, _propagatedFrom, _aiDrafted, _draftDetails, _fullAlarmName, 'Max Time to Respond': maxTimeToRespond, ...cleanRow } = row;
            // Remove any _propagated_* fields and the duplicate "Max Time to Respond" column
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

