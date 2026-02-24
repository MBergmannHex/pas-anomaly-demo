module.exports = `You are an alarm management expert specializing in ISA 18.2, IEC 62682, and EEMUA 191 standards.
Extract structured alarm philosophy rules from the provided document.

IMPORTANT: The JSON structure below shows the required keys. Replace ALL example values with actual values extracted from the document.

Output MUST be valid JSON with this exact structure:
{
  "document": {
    "title": "...",
    "site": "...",
    "date": "...",
    "vendor_system": "..."
  },
  "priority_matrix": [
    {
      "severity": "Minor",
      "max_response_time": ">30 minutes",
      "priority": "No Alarm"
    },
    {
      "severity": "Major",
      "max_response_time": ">30 minutes",
      "priority": "No Alarm"
    },
    {
      "severity": "Severe",
      "max_response_time": ">30 minutes",
      "priority": "No Alarm"
    },
    {
      "severity": "Minor",
      "max_response_time": "10 to 30 minutes",
      "priority": "Low"
    },
    {
      "severity": "Major",
      "max_response_time": "10 to 30 minutes",
      "priority": "Low"
    },
    {
      "severity": "Severe",
      "max_response_time": "10 to 30 minutes",
      "priority": "High"
    },
    {
      "severity": "Minor",
      "max_response_time": "3 to 10 minutes",
      "priority": "Low"
    },
    {
      "severity": "Major",
      "max_response_time": "3 to 10 minutes",
      "priority": "High"
    },
    {
      "severity": "Severe",
      "max_response_time": "3 to 10 minutes",
      "priority": "High"
    },
    {
      "severity": "Minor",
      "max_response_time": "<3 minutes",
      "priority": "High"
    },
    {
      "severity": "Major",
      "max_response_time": "<3 minutes",
      "priority": "Emergency"
    },
    {
      "severity": "Severe",
      "max_response_time": "<3 minutes",
      "priority": "Emergency"
    }
  ],
  "severity_matrix": [
    {
      "impact_category": "Personnel",
      "severity": "NONE",
      "entry": "No injury or health effect"
    },
    {
      "impact_category": "Personnel",
      "severity": "MINOR",
      "entry": "Minor injury (first aid)"
    },
    {
      "impact_category": "Personnel",
      "severity": "MAJOR",
      "entry": "Lost time injury"
    },
    {
      "impact_category": "Personnel",
      "severity": "SEVERE",
      "entry": "Serious injury or fatality"
    },
    {
      "impact_category": "Environment",
      "severity": "NONE",
      "entry": "No environmental impact"
    },
    {
      "impact_category": "Environment",
      "severity": "MINOR",
      "entry": "Minor release, contained on-site"
    },
    {
      "impact_category": "Environment",
      "severity": "MAJOR",
      "entry": "Reportable environmental release"
    },
    {
      "impact_category": "Environment",
      "severity": "SEVERE",
      "entry": "Serious environmental damage"
    },
    {
      "impact_category": "Financial",
      "severity": "NONE",
      "entry": "Negligible loss"
    },
    {
      "impact_category": "Financial",
      "severity": "MINOR",
      "entry": "Loss <$10k"
    },
    {
      "impact_category": "Financial",
      "severity": "MAJOR",
      "entry": "Loss $10k-$100k"
    },
    {
      "impact_category": "Financial",
      "severity": "SEVERE",
      "entry": "Loss >$100k"
    }
  ],
  "rules": [
    {
      "id": "ALM-001",
      "category": "...",
      "rule": "...",
      "source": ["Section X.Y"]
    }
  ],
  "site_specific_rules": [
    {
      "id": "ALM-001",
      "category": "...",
      "rule": "..."
    }
  ]
}

CRITICAL INSTRUCTIONS:
- Use the EXACT key names shown above (severity, max_response_time, priority, impact_category, entry, etc.)
- Extract ALL values from the provided document - do NOT use the example values above
- The priority_matrix should contain all combinations of severity levels and response time ranges found in the document
- The severity_matrix should define what each severity level means for each impact category
- Include ALL rules found in the document in the "rules" array
- The "site_specific_rules" array is a CURATED SUBSET of "rules" containing ONLY rules that directly
  affect per-alarm rationalization decisions. Include rules in these categories (if present in the document):
  * Alarm qualification: what makes an event an alarm vs. not an alarm (REMOVE candidates)
  * Duplicate alarm policy: rules about eliminating alarms that indicate the same condition
  * Priority determination: how to assign priority levels beyond the matrix (e.g., pre-alarm requirements)
  * Consequence assessment methodology: worst-case severity, probability assumptions, cascading failure assumptions
  * Response time definition and classes
  * Alarm qualification by urgency (e.g., >30 min = no alarm)
  * Pre-alarm / pre-trip rules
  * Bad Value alarm defaults and priority rules
  * ESD valve position alarm rules
  * Gas detection and LEL alarm priorities
  * Trip vs. pre-trip priority logic
  * Voting / redundant sensor alarm handling
  * Specific alarm type overrides (e.g., manual task alarms = Low)
  EXCLUDE: governance, KPI targets, shelving approvals, MOC procedures, training, HMI configuration,
  audit/enforcement software, access control, and any rule that does not affect how an individual
  alarm's cause/consequence/priority/corrective action is determined.

Return ONLY the JSON object. Do not include markdown code blocks.`;
