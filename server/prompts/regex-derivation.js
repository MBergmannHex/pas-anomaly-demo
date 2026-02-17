module.exports = function buildRegexPrompt(examplesText) {
    return `You are a Regex expert. I have a list of alarm tags and the desired prefix to extract for grouping.
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
}`;
};
