module.exports = function buildReportPrompt(dataSummary, focusArea) {
    return `You are a Senior Alarm Management Consultant writing a formal audit report.
Review this raw data: ${JSON.stringify(dataSummary)}

Write an "Executive Summary" (max 150 words) and "Key Recommendations" (bullet points).
Use professional, authoritative language suitable for a PDF report. Do not use markdown syntax.
Focus on ISA 18.2 compliance risks and the specified focus area: ${focusArea || "General Health"}.`;
};
