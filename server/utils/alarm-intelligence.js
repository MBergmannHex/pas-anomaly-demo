'use strict';
/**
 * Alarm Intelligence Utilities - Server-Side Only
 * Tag pattern discovery and rule derivation algorithms
 */

// ============================================
// TAG SEGMENT SPLITTING
// ============================================

/**
 * Split a tag into segments at letter↔digit transition points.
 * For "T4PI30171C" → ["T4", "PI", "30171C"]
 */
function splitTagIntoSegments(tag) {
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
            currentType = 'other';
        }

        if (prevType !== null && prevType !== currentType && currentSegment) {
            segments.push(currentSegment);
            currentSegment = '';
        }

        currentSegment += char;
        prevType = currentType;
    }

    if (currentSegment) {
        segments.push(currentSegment);
    }

    return segments.filter(s => /[A-Za-z0-9]/.test(s));
}

// ============================================
// RULE DERIVATION ALGORITHMS
// ============================================

/**
 * Generate a parsing rule from a single user-provided example.
 * @param {string} fullTag - The complete tag (e.g., "TI200A")
 * @param {string} prefix - User-identified prefix (e.g., "TI")
 * @returns {Object} Rule object with type and parsing instructions
 */
function generateParsingRule(fullTag, prefix) {
    if (!fullTag || !prefix) {
        throw new Error('Both fullTag and prefix are required');
    }

    const trimmedTag = fullTag.trim();
    const trimmedPrefix = prefix.trim();

    if (!trimmedTag.toUpperCase().startsWith(trimmedPrefix.toUpperCase())) {
        throw new Error(`Tag "${trimmedTag}" does not start with prefix "${trimmedPrefix}"`);
    }

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
}

/**
 * Derive a consolidated parsing rule from multiple examples using 4 strategies.
 * @param {Array} examples - Array of { tag, prefix } objects
 * @returns {Object|null} Rule object
 */
function deriveConsolidatedRule(examples) {
    if (!examples || examples.length === 0) return null;

    const validExamples = examples.filter(e => e.tag && e.prefix);
    if (validExamples.length === 0) return null;

    // Strategy 1: Common Delimiter
    const delimiters = ['-', '_', '.', '/', ':'];
    for (const char of delimiters) {
        const allMatch = validExamples.every(e => {
            const parts = e.tag.split(char);
            return parts.some(p => p.trim().toUpperCase() === e.prefix.trim().toUpperCase());
        });

        if (allMatch) {
            const allFirst = validExamples.every(e =>
                e.tag.split(char)[0].trim().toUpperCase() === e.prefix.trim().toUpperCase()
            );
            if (allFirst) {
                return { type: 'delimiter', char: char, description: `Split by '${char}'` };
            }
            return {
                type: 'regex',
                regex: `(?:^|[${char}])([A-Za-z0-9]+)(?:$|[${char}])`,
                description: `Contains part separated by '${char}'`
            };
        }
    }

    // Strategy 2: Alpha/Numeric Boundary (Letters before Digits)
    const allLettersBeforeDigits = validExamples.every(e => {
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
    const allSameLength = validExamples.every(e =>
        e.prefix.length === firstLen && e.tag.toUpperCase().startsWith(e.prefix.toUpperCase())
    );
    if (allSameLength) {
        return { type: 'fixedLength', length: firstLen, description: `First ${firstLen} characters` };
    }

    // Strategy 4: Specific Segment
    for (let i = 1; i <= 10; i++) {
        const allMatch = validExamples.every(e => {
            const segs = splitTagIntoSegments(e.tag);
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

    // Fallback: derive from first example
    try {
        return generateParsingRule(validExamples[0].tag, validExamples[0].prefix);
    } catch (e) {
        return { type: 'leadingLetters', description: 'Default (Leading Letters)' };
    }
}

// ============================================
// TAG PATTERN DETECTION
// ============================================

/**
 * Detect unique tag patterns from alarm data.
 * Analyzes tags to find different naming conventions and returns representative examples.
 * @param {Array} data - Array of alarm records with Tag field
 * @param {number} maxExamples - Maximum number of examples to return (default 5)
 * @returns {Array} Array of { tag, suggestedPrefix, pattern, count } objects
 */
function detectTagPatterns(data, maxExamples = 5) {
    if (!data || !Array.isArray(data) || data.length === 0) return [];

    const allTags = [...new Set(data.map(row => (row.Tag || row.tag || '').trim()).filter(t => t))];
    if (allTags.length === 0) return [];

    const patternMap = new Map();

    allTags.forEach(tag => {
        const upperTag = tag.toUpperCase();
        let signature = '';
        let suggestedPrefix = '';

        const delimiterMatch = upperTag.match(/^([A-Za-z]+)([-_./])(\d)/);
        if (delimiterMatch) {
            signature = `letters${delimiterMatch[2]}numbers`;
            suggestedPrefix = delimiterMatch[1];
        } else {
            const alphaNumMatch = upperTag.match(/^([A-Za-z]+)(\d)/);
            if (alphaNumMatch) {
                const letters = alphaNumMatch[1];
                signature = `letters${letters.length}_then_numbers`;
                suggestedPrefix = letters;
            } else {
                const allLettersMatch = upperTag.match(/^([A-Za-z]+)$/);
                if (allLettersMatch) {
                    signature = 'all_letters';
                    suggestedPrefix = upperTag.substring(0, 2);
                } else {
                    signature = 'other_' + upperTag.substring(0, 3);
                    suggestedPrefix = upperTag.substring(0, 2);
                }
            }
        }

        if (!patternMap.has(signature)) {
            patternMap.set(signature, { tag, suggestedPrefix, pattern: signature, count: 1 });
        } else {
            patternMap.get(signature).count++;
        }
    });

    return Array.from(patternMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, maxExamples)
        .map(p => ({ tag: p.tag, suggestedPrefix: p.suggestedPrefix, pattern: p.pattern, count: p.count }));
}

module.exports = {
    deriveConsolidatedRule,
    detectTagPatterns,
    splitTagIntoSegments
};
