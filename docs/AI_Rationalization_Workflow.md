# AI Alarm Rationalization Workflow

This document describes how the application performs AI-driven alarm rationalization, including how it uses the CSV data, PDF philosophy document, and embedded knowledge in system prompts.

---

## Overview

The app uses a multi-step workflow to rationalize alarms using AI. The process combines:
- **User-uploaded data** (CSV alarm database, PDF philosophy document)
- **Embedded domain knowledge** (ISA 18.2 standards, vendor presets, alarm dictionaries)
- **LLM reasoning** to generate rationalized alarm configurations

---

## Step 1: Data Inputs

The system takes three main inputs:

### 1.1 CSV File (Master Alarm Database)

Contains existing alarm configurations with fields like:

| Field | Description |
|-------|-------------|
| `Tag` | Equipment identifier (e.g., "B3PC30036A") |
| `AlarmDisplayName` | Alarm type code (e.g., "PVHIGH", "CMDDIS") |
| `Description` | Human-readable alarm description |
| `Priority` | Current priority level |
| `D&R Complete` | Boolean indicating if alarm has been manually rationalized |
| `Cause1-5` | Root cause fields (multiple slots available) |
| `Consequence1-5` | Consequence fields |
| `Corrective Action1-5` | Operator action fields |
| `Max Response Time` | Required response time |

### 1.2 PDF (Alarm Philosophy Document)

Company-specific rules that get extracted into structured JSON:

- **Priority Matrix** - Maps consequence × severity → required priority
- **Response Time Rules** - Maps priority level → max response time
- **Forbidden Combinations** - Explicitly prohibited configurations
- **Default Values** - Fallback settings when no specific rule applies

### 1.3 System Prompt Knowledge

Pre-built domain expertise embedded in `dr-processor.js`:

- ISA 18.2 / IEC 62682 standards rules
- Vendor-specific presets (Foxboro, Yokogawa, DeltaV, Wonderware, Honeywell Experion, Emerson Ovation)
- Alarm Display Name dictionary (50+ alarm type definitions)
- Risk matrix templates

---

## Step 2: PDF Processing

The PDF philosophy document is processed in two stages:

```
extractPhilosophyRules(pdfFile)
  ├─→ extractPdfText(file)         // Uses pdf.js to convert PDF → text
  └─→ LLM call with philosophyExtractor prompt
      └─→ Returns structured JSON
```

### Example Extracted Output

```json
{
  "priority_matrix": [
    {"consequence": "Safety", "severity": "Major", "required_priority": "Critical"},
    {"consequence": "Environmental", "severity": "Major", "required_priority": "High"},
    {"consequence": "Equipment", "severity": "Minor", "required_priority": "Medium"}
  ],
  "response_time_rules": [
    {"priority": "Critical", "max_response_time": "5 minutes"},
    {"priority": "High", "max_response_time": "10 minutes"},
    {"priority": "Medium", "max_response_time": "30 minutes"},
    {"priority": "Low", "max_response_time": "60 minutes"}
  ],
  "forbidden_combinations": [
    "Safety Critical alarms cannot be Low priority"
  ],
  "default_values": {
    "default_priority": "Medium",
    "default_response_time": "30 minutes"
  }
}
```

---

## Step 3: Process Analysis (NEW)

Before AI drafting, the system analyzes the process context to build understanding:

```
analyzeProcessContext(csvData, processDescription, pidImage, philosophyRules)
  ├─→ buildTagSummary(csvData)     // Extract equipment distribution by prefix
  └─→ LLM call with processAnalyzer prompt
      └─→ Returns structured process understanding
```

### Process Analysis Output

| Field | Description |
|-------|-------------|
| `process_summary` | Brief description of what this process appears to do |
| `equipment_types` | Identified equipment categories with counts and functions |
| `process_dependencies` | How equipment relates to each other |
| `failure_patterns` | Common failure modes by equipment type |
| `process_gaps` | What appears to be missing from the data |
| `guidance_for_d_and_r` | Specific recommendations for the D&R drafter |

### Example Process Analysis

```json
{
  "process_summary": "This appears to be a water treatment and distribution system with multiple pumping stations and level-controlled storage tanks.",
  "equipment_types": [
    {
      "type": "Level Transmitters",
      "count": 45,
      "examples": ["LT-101", "LT-102"],
      "typical_function": "Monitor tank and vessel levels for overflow/dry protection"
    },
    {
      "type": "Pumps/Motors",
      "count": 28,
      "examples": ["P-101A", "P-101B"],
      "typical_function": "Transfer water between treatment stages and distribution"
    }
  ],
  "failure_patterns": {
    "Pumps": [
      {
        "cause": "Plugged strainer upstream",
        "alarms_affected": ["Flow Low", "Motor Overload"],
        "consequence": "Loss of water transfer, pump damage"
      },
      {
        "cause": "Pump tripped on overload",
        "alarms_affected": ["Motor Trip", "Flow Zero"],
        "consequence": "Loss of system pressure, downstream process upset"
      }
    ]
  },
  "guidance_for_d_and_r": "Use specific process conditions like 'Plugged strainer', 'Pump tripped', 'Valve failed closed' rather than generic 'low flow condition'."
}
```

### How Process Analysis Improves D&R Output

The process analysis context is injected into the D&R drafter prompt, enabling:

1. **Process-focused Causes**: Instead of "Low level detected", use "Inlet valve failed closed" or "Pump trip upstream"
2. **Realistic Consequences**: Based on actual equipment dependencies in the process
3. **Equipment-aware Reasoning**: Understanding that a level transmitter on a feed tank has different implications than one on a product tank

---

## Step 4: CSV Parsing & Grouping

The alarm database is parsed and organized for batch processing:

```
parseMADbCSV(file)
  ├─→ detectPriorityScheme(data)   // Numeric vs Descriptive naming
  ├─→ normalizeMADbData(data)      // Mark D&R complete status
  └─→ groupByCodeLetter(data)      // Group by tag prefix
```

### Priority Scheme Detection

The system auto-detects whether the site uses:
- **Numeric**: Priority 1, Priority 2, Priority 3
- **Descriptive**: Urgent, High, Medium, Low

This ensures AI output matches the site's naming convention.

### Alarm Grouping

Alarms are grouped by their tag code letter prefix (e.g., "B3PC" from "B3PC30036") for:
- Consistency checking within functional groups
- Reference alarm propagation
- Batch processing efficiency

---

## Step 5: AI Batch Drafting

The core rationalization happens here:

```
batchDraftRationalizations(alarms, processContext, philosophyRules, pidImage)
  ├─→ Split into batches of 10 alarms
  └─→ For each batch: processSingleBatch()
```

### Context Building for Each Batch

| Context Type | Purpose |
|--------------|---------|
| **Reference Alarms** | D&R-complete alarms from same tags used as templates |
| **Previously Drafted** | Earlier batch results for consistency |
| **Philosophy Rules** | Extracted priority matrix and response times |
| **Priority Scheme** | Instruction to use same naming convention |
| **Process Description** | User-provided context about the process area |
| **P&ID Image** | Optional visual context (if provided) |

### The Batch Drafter System Prompt

The ~12KB system prompt includes comprehensive domain knowledge:

#### General D&R Rules
- Alarms MUST require specific operator action
- If no action required, classify as "Journal" or "Log"
- No duplicate alarms for same condition

#### Combination Alarm Rules (HH/LL)
- By default, NO High-High or Low-Low alarms configured
- HH/LL only allowed if:
  1. Actions are significantly different from HI/LO
  2. Sufficient time exists between alarm levels

#### ESD Bypass Alarm Rules
- Do NOT use high priorities for ESD bypass alarms
- Set to Low or Diagnostic priority

#### Rate of Change Alarm Rules
- Default recommendation: REMOVE
- Use sparingly due to false alarm risk

#### Risk Matrix

| Response Time \ Severity | NONE | MINOR | MAJOR | SEVERE |
|--------------------------|------|-------|-------|--------|
| **> 30 minutes** | No Alarm | Review | Priority 3 | Priority 2 |
| **10 to 30 minutes** | No Alarm | Priority 3 | Priority 3 | Priority 2 |
| **3 to 10 minutes** | No Alarm | Priority 3 | Priority 2 | Priority 2 |
| **< 3 minutes** | No Alarm | Priority 2 | Priority 1 | Priority 1 |

#### Vendor-Specific Presets

| Vendor | Key Rules |
|--------|-----------|
| **Foxboro I/A** | HHABS/LLABS → REMOVE, RATE → REMOVE, IOBAD → P4 |
| **Yokogawa Centum** | HH/LL → Logging, VEL+/- → N/A |
| **DeltaV** | Rate of Change → REMOVE, Deviation → REMOVE |
| **Wonderware** | ROC → REMOVE, MAJDEV/MINDEV → REMOVE |
| **Honeywell Experion** | PVHH/PVLL → NOACTION, DEVHI/DEVLO → NOACTION |
| **Emerson Ovation** | High-3/High-4 → Do NOT Use, Better/Worse → Do NOT Use |

#### Alarm Display Name Dictionary

| Code | Description |
|------|-------------|
| PVHIGH | Process Variable High - PV exceeded high alarm limit |
| PVHIHI | PV High-High - critical high, usually trip condition |
| PVLOW | Process Variable Low - PV below low alarm limit |
| PVLOLO | PV Low-Low - critical low, usually trip condition |
| CMDDIS | Command Disagree - device feedback doesn't match command |
| BADPV | Bad Process Variable - sensor input invalid |
| DEV | Deviation Alarm - PV/SP difference exceeds limit |
| UNCMD | Uncommanded Change - device changed state without command |
| CHGOFST | Change of State - discrete signal transition (often inappropriate) |
| ROCPOS/ROCNEG | Rate of Change - PV changing too fast |

---

## Step 6: LLM Response Processing

### Example LLM Output

```json
[
  {
    "fullAlarmName": "B3PC30036A PVHIGH",
    "Cause": "Valve Failure",
    "Consequence": "Reactor pressure will exceed safe limit, potential equipment damage",
    "Corrective Action": "Reduce feed rate immediately, open relief valve if pressure continues rising",
    "Proposed Priority": "Priority 1",
    "Max Response Time": "3 minutes",
    "Reasoning": "Per Honeywell Preset - PVHIGH on reactor vessel requires immediate action. Based on reference alarm B3PC30035A PVHIGH."
  }
]
```

### Post-Processing

1. **AI Prefix**: All AI-generated fields get prefixed with `"AI: "` for identification
2. **Matching**: Results matched back to original alarms by `fullAlarmName`
3. **Slot Assignment**: Uses next available slot (e.g., if `Cause1` is filled, uses `Cause2`)

---

## Step 7: Final Output

### Generated Fields

| Field | Description |
|-------|-------------|
| `Cause` | Root cause using guideword method (AI: prefixed) |
| `Consequence` | Direct plant consequence if no action taken |
| `Corrective Action` | Specific operator instruction |
| `Proposed Priority` | AI-recommended priority level |
| `Max Response Time` | Based on priority level |
| `AI Reasoning` | Citation of which rule/reference was applied |

### Export Options

- **CSV** - Updated alarm database with AI-filled fields
- **JSON** - Structured rationalization data
- **Priority Analysis** - Before/after distribution charts
- **Compliance Report** - Validation results against philosophy rules

---

## Intelligence Sources Summary

| Source | Content | Purpose |
|--------|---------|---------|
| **Uploaded PDF** | Site-specific philosophy | Priority matrix, response times |
| **CSV Data** | D&R-complete alarms | Reference templates for similar alarms |
| **System Prompt** | ISA 18.2, vendor presets | Industry standards compliance |
| **Process Context** | User description | Process-specific reasoning |
| **P&ID Image** | Visual diagram | Equipment relationship context |

---

## Traceability

The AI always cites its reasoning source:
- `"Per Honeywell Preset - [rule applied]"`
- `"Based on reference alarm [AlarmName]"`
- `"Per philosophy matrix: [consequence] + [response time] = [priority]"`
- `"Per Combination Alarm rule - [reason for removal]"`

This ensures full auditability of AI-generated recommendations.

---

*Document generated from application code analysis*
*Standards: ISA 18.2 / IEC 62682 / EEMUA 191*
