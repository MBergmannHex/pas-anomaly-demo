# How AI Rationalization (D&R) Works

This document explains the technical architecture and AI reasoning process behind the alarm Design & Rationalization (D&R) feature in Alarm Analyzer Pro v5.

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [The AI Rationalization Pipeline](#the-ai-rationalization-pipeline)
- [AI Prompt Engineering](#ai-prompt-engineering)
- [Data Flow](#data-flow)
- [Technical Implementation](#technical-implementation)
- [Quality Assurance](#quality-assurance)

---

## Overview

The D&R feature uses Azure OpenAI's advanced language models (GPT-4, GPT-5, o1, o3) to automatically generate alarm rationalization documentation that complies with ISA 18.2, IEC 62682, and EEMUA 191 standards.

**What it does:**
- Analyzes alarm databases (CSV format)
- Extracts philosophy rules from PDF documents
- Generates Cause, Consequence, and Corrective Action for each alarm
- Recommends priority levels based on consequence severity and response time
- Ensures consistency across similar alarm types
- Applies vendor-specific DCS platform rules

**AI Models Used:**
- **General Deployment** (e.g., GPT-4.1): Philosophy extraction, process analysis
- **D&R Deployment** (e.g., GPT-5, o1, o3): Batch rationalization with extended reasoning

---

## Architecture

### Three-Tier AI Processing

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Process Analysis (Optional)                            │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Input: CSV alarm data + P&ID image + process description │   │
│ │ Model: Responses API (GPT-4/5)                           │   │
│ │ Output: Equipment dependencies, failure patterns         │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Philosophy Extraction                                  │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Input: Alarm philosophy PDF document                     │   │
│ │ Model: Chat Completions API (GPT-4/5)                    │   │
│ │ Output: Priority matrix, severity matrix, site rules     │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Batch Rationalization (Core D&R)                       │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Input: 10 alarms + context (philosophy, process, refs)   │   │
│ │ Model: Chat Completions API (GPT-5/o1/o3)                │   │
│ │ Output: Cause, Consequence, Action, Priority, Reasoning  │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Backend-First Design

All AI prompts are stored in `server/prompts/` (server-side only):
- **Frontend**: Sends only data (alarm lists, CSV content, PDF text)
- **Backend**: Constructs prompts, calls Azure OpenAI, returns results
- **Security**: Proprietary prompt engineering is not visible in browser DevTools

---

## The AI Rationalization Pipeline

### Phase 1: Process Analysis (Optional but Recommended)

**Purpose:** Build contextual understanding of the industrial process.

**Input:**
- CSV alarm database (tags, descriptions, alarm types)
- P&ID diagram (optional, as base64 image)
- User-provided process description (optional)

**AI Task:**
The AI analyzes tag naming conventions (e.g., "FIC-101" = Flow Indicator Controller) and equipment descriptions to infer:
- Equipment types (pumps, valves, vessels, heat exchangers, compressors)
- Process dependencies (which equipment feeds/controls other equipment)
- Common failure modes (e.g., "Pump trip", "Valve stiction", "Plugged strainer")

**Prompt File:** `server/prompts/process-analyzer.js` (54 lines)

**Output Example:**
```json
{
  "process_summary": "Distillation unit with feed pump, reboiler, condenser, and reflux system",
  "process_dependencies": [
    {
      "upstream": "Feed Pump P-101",
      "downstream": "Distillation Column T-101",
      "relationship": "Pump feeds column through control valve FCV-101"
    }
  ],
  "failure_patterns": {
    "Pumps": [
      {
        "cause": "Pump tripped on overload",
        "alarms_affected": ["PVLOW on flow", "PVHIGH on discharge pressure"],
        "consequence": "Loss of feed to column, potential column upset"
      }
    ]
  }
}
```

**How it's used:** This context is injected into the batch rationalization prompt to ensure process-specific causes and consequences (instead of generic alarm descriptions).

---

### Phase 2: Philosophy Extraction

**Purpose:** Extract the site's alarm management rules from their philosophy document.

**Input:**
- Alarm philosophy PDF (converted to text)
- **Main D&R workflow**: No truncation - processes full PDFs
- **Chatbot feature**: Truncates to 100,000 characters if needed (~75k tokens)
- **User notification**: Displays warning if document was truncated (e.g., "⚠️ 85% of content processed")

**Token capacity:** Azure OpenAI 128k context window allows processing large philosophy documents (100+ pages)

**AI Task:**
Parse the document to extract:
- **Priority Matrix:** Consequence severity vs. Response time → Priority level
- **Severity Matrix:** Impact category (Personnel, Environment, Financial) definitions
- **Site Rules:** Specific policies (e.g., "All bypass alarms = Priority 3")

**Prompt File:** `server/prompts/philosophy-extraction.js` (156 lines)

**Output Example:**
```json
{
  "priority_matrix": [
    {
      "severity": "SEVERE",
      "max_response_time": "<3 minutes",
      "priority": "Emergency"
    },
    {
      "severity": "MAJOR",
      "max_response_time": "3 to 10 minutes",
      "priority": "High"
    }
  ],
  "severity_matrix": [
    {
      "impact_category": "Personnel",
      "severity": "SEVERE",
      "entry": "Serious injury or fatality"
    }
  ],
  "rules": [
    {
      "id": "ALM-005",
      "category": "ESD Bypass",
      "rule": "All ESD bypass alarms shall be Priority 3 or Diagnostic",
      "source": ["Section 4.2"]
    }
  ]
}
```

**How it's used:** The priority matrix and rules are injected into batch rationalization to ensure the AI uses the **site's actual priority scheme** (not generic ISA 18.2 defaults).

---

### Phase 3: Batch Rationalization (Core D&R Engine)

**Purpose:** Generate ISA 18.2-compliant D&R documentation for each alarm.

#### Batch Size
- **Default:** 10 alarms per batch
- **Why batches?** Allows the AI to see similar alarms together and ensure consistency

#### Input (Per Batch)

1. **Alarm List** (10 alarms with tag, alarm type, description)
2. **Philosophy Rules** (from Phase 2)
3. **Process Analysis** (from Phase 1, if available)
4. **Reference Alarms** (up to 3 already-rationalized alarms from the same equipment tags for consistency)
5. **Previous Batch Drafts** (for same-tag consistency across batches)
6. **Priority Scheme** (numeric vs. descriptive, or exact matrix values)
7. **P&ID Image** (optional, for visual context)

#### AI Task

For each alarm, generate:

1. **Cause** - Root cause using "guideword" method (e.g., "Valve failure", "Pump trip", "Instrument error")
2. **Consequence** - Direct plant consequence if operator takes NO action
3. **Corrective Action** - Clear, actionable operator instruction
4. **Proposed Priority** - Based on consequence severity + response time, using site's priority matrix
5. **Max Response Time** - Time available before consequence becomes unavoidable
6. **Reasoning** - 1-2 sentence citation of which rule/reference was used

#### Embedded Knowledge

The batch D&R prompt (`server/prompts/batch-drafter.js`, 189 lines) contains:

**1. ISA 18.2 General Rules**
- The "Action" Rule: An alarm MUST require operator action
- The "Urgency" Rule: Response time > 30 min → likely not an alarm
- Duplicates: No multiple alarms for the same abnormal condition

**2. Combination Alarm Philosophy (HH/LL)**
- Default: NO PV HIGH-HIGH or PV LOW-LOW alarms
- Exception: Only if operator action differs AND time permits
- Rationale: Prevents alarm flooding

**3. ESD Bypass Alarm Rules**
- Priority: Set to Priority 3 or Diagnostic (NOT high priority)
- Reason: Bypass is expected during testing (not an emergency)

**4. Rate of Change Alarms**
- Default recommendation: **REMOVE**
- Reason: Easily causes false alarms during normal transitions

**5. ISA 18.2 Priority Matrix** (embedded default)
```
Response Time \ Severity | NONE | MINOR | MAJOR | SEVERE
─────────────────────────┼──────┼───────┼───────┼────────
> 30 minutes             | No   | No    | No    | No
10 to 30 minutes         | No   | P3    | P3    | P2
3 to 10 minutes          | No   | P3    | P2    | P2
< 3 minutes              | No   | P2    | P1    | P1
```

**6. Vendor-Specific DCS Presets** (6 platforms)

Example - **Foxboro I/A**:
- HIABS / LOABS: Keep and rationalize
- HHABS / LLABS: **No Alarm** (unless actions differ + time permits)
- HIDEV / LODEV: **REMOVE** (not used)
- RATE: **REMOVE** (dangerous, causes floods)
- IOBAD: Set to P4 (Diagnostic)

**7. Alarm Display Name Dictionary** (80+ codes)

Example:
- PVHIGH: Process Variable High - PV exceeded high alarm limit
- CMDDIS: Command Disagree - device feedback doesn't match command (valve stiction)
- DEVHI: Deviation High - PV higher than SP beyond deviation limit

**8. Consistency Requirements**
- Alarms of the SAME type (e.g., PVHIGH) on the SAME equipment type (e.g., Temperature) MUST have identical Cause, Consequence, Action, Priority, Response Time
- Only tag-specific details may differ

#### Prompt File
**System Prompt:** `server/prompts/batch-drafter.js` (189 lines)
**User Prompt:** Assembled dynamically in `server/routes/dr-process.js` (currently in frontend `dr-processor.js` - pending migration)

#### Output Example

```json
[
  {
    "fullAlarmName": "FIC-101 PVLOW",
    "Cause": "Loss of flow due to upstream valve closed or pump trip",
    "Consequence": "Loss of feed to reactor, potential temperature excursion",
    "Corrective Action": "Check upstream valve position and pump status, investigate root cause",
    "Proposed Priority": "High",
    "Max Time to Respond": "5 minutes",
    "Reasoning": "Per philosophy matrix: MAJOR consequence (process upset) + 3-10 min response = High priority"
  }
]
```

---

## AI Prompt Engineering

### Prompt Structure

All AI prompts follow a structured format:

1. **Role Definition** - "You are an expert Alarm Management Facilitator..."
2. **Task Description** - Clear objective statement
3. **Domain Rules** - ISA 18.2 standards, vendor presets, alarm dictionaries
4. **Output Schema** - Exact JSON structure with examples
5. **Critical Instructions** - Consistency requirements, citation mandates

### Template vs. Static Prompts

**Static Prompts** (exported as strings):
- `batch-drafter.js` - Fixed ISA 18.2 rules
- `process-analyzer.js` - Fixed analysis approach
- `chatbot-persona.js` - Fixed chatbot behavior

**Template Prompts** (exported as functions):
```javascript
// Example: control-loop-parser.js
module.exports = function buildControlLoopPrompt(tag) {
    return `You are a Control Loop Data Parser.
Your ONLY job is to extract numerical changes from log messages for loop "${tag}".
...`;
};
```

### Reasoning Models (GPT-5, o1, o3)

**Extended Thinking:**
- Reasoning models use `reasoning_effort: 'low' | 'medium' | 'high' | 'xhigh'`
- Higher effort = deeper analysis but slower response
- Used for D&R batch rationalization (complex multi-step reasoning)

**Key difference from standard models:**
- Reasoning models show a `<thinking>` section (internal reasoning)
- This helps ensure the AI follows complex rules (e.g., combination alarm philosophy)

---

## Data Flow

### Frontend → Backend → Azure OpenAI

**Traditional approach (insecure):**
```
Frontend: Alarm data → Assemble prompt → Send prompt to backend → Azure OpenAI
Problem: Prompt visible in browser DevTools
```

**New approach (Phases 1-3 complete):**
```
Frontend: Alarm data → Send data only → Backend constructs prompt → Azure OpenAI
Benefit: Prompts secured server-side
```

**Pending (Phase 4):**
```
Frontend: Still sends assembled messages for batch D&R
Backend: Receives messages array (not data)
TODO: Migrate to data-only approach
```

### API Routes

| Route | Input (Frontend) | Prompt Construction | Output |
|-------|-----------------|---------------------|---------|
| `POST /api/dr/analyze-process` | `{csvSummary, processDescription, pidImageBase64}` | Backend injects `prompts.processAnalyzer` | Process analysis JSON |
| `POST /api/dr/extract-philosophy` | `{pdfText}` | Backend injects `prompts.philosophyExtraction` | Priority matrix + rules |
| `POST /api/dr/batch-rationalize` | `{messages[]}` (assembled frontend) | Frontend assembles full messages | D&R JSON array |

---

## Technical Implementation

### Backend Files

**Prompt Storage:**
```
server/prompts/
  ├── batch-drafter.js          (189 lines - ISA 18.2 rules)
  ├── process-analyzer.js       (54 lines)
  ├── philosophy-extraction.js  (156 lines)
  └── index.js                  (central exports)
```

**Route Handlers:**
```
server/routes/
  ├── dr-process.js    (/api/dr/*)
  ├── chat.js          (/api/chat/*)
  └── control-loop.js  (/api/control-loop/*)
```

**API Proxy:**
```
server/services/
  └── openai-proxy.js  (Azure OpenAI caller, handles reasoning vs. standard models)
```

### Frontend Files

**D&R Processor:**
```
public/services/
  └── dr-processor.js  (2,591 lines - batch logic, CSV parsing, UI callbacks)
```

**Key functions:**
- `analyzeProcessContext()` - Calls `/api/dr/analyze-process`
- `extractPhilosophyRules()` - Calls `/api/dr/extract-philosophy`
- `batchDraftRationalizations()` - Calls `/api/dr/batch-rationalize`
- `processSingleBatch()` - Assembles batch data + context

### User Prompt Assembly (Currently Frontend-Side)

**Location:** `public/services/dr-processor.js` lines 2149-2235

**Logic:**
1. Build alarm list string (10 alarms with full details)
2. Inject philosophy rules (if extracted)
3. Inject process analysis context (if available)
4. Inject reference alarms (up to 3 D&R-complete alarms from same tags)
5. Inject previous batch drafts (for consistency)
6. Detect priority scheme (numeric vs. descriptive vs. matrix values)
7. Assemble final user prompt

**Pending:** This logic should move to `server/routes/dr-process.js` (Phase 4)

---

## Quality Assurance

### AI Consistency Mechanisms

**1. Reference Alarm Propagation**
- When processing a new alarm, the AI receives up to 3 already-rationalized alarms from the same equipment tags
- This ensures new drafts match the style/quality of human-reviewed alarms

**2. Same-Batch Grouping**
- Alarms are batched by equipment type and alarm type
- The AI sees all 10 alarms together and ensures consistency

**3. Explicit Consistency Rules**
- The prompt mandates: "Alarms of the SAME alarm type on the SAME equipment type MUST have identical attributes"
- The AI is instructed to group alarms by (alarm type + equipment type) before processing

**4. Reasoning Citations**
- Every alarm must include a `Reasoning` field citing the rule/reference used
- This allows human reviewers to audit AI decisions

### Human Review Workflow

1. **AI generates drafts** with "AI:" prefix (e.g., "AI: Cause1", "AI: Priority")
2. **Facilitator reviews** in UI (color-coded, filterable by priority)
3. **Facilitator edits** as needed (removes "AI:" prefix when approved)
4. **Facilitator sets** `D&R Complete = TRUE` when finalized
5. **Approved alarms** become reference examples for future batches

### Validation Checks

**Pre-submission:**
- JSON schema validation (all required fields present)
- Priority value validation (matches site's allowed values)
- Response time format validation

**Post-submission:**
- Duplicate detection (same alarm rationalized twice)
- Priority distribution analysis (flag if >50% are Emergency)
- Consistency report (flag alarms of same type with different priorities)

---

## Future Enhancements

**Phase 4 (Pending):**
- Move `batchDrafter` and `processAnalyzerPrompt` from `public/services/dr-processor.js` to `server/prompts/`
- Move user-prompt assembly logic to backend
- Update `/api/dr/batch-rationalize` to accept structured data instead of pre-assembled messages

**Phase 5 (Planned):**
- Add dedicated `/api/dr/derive-regex` endpoint for regex pattern derivation
- Remove regex prompt from `dr-processor.js`

**Advanced Features:**
- Multi-language support (extract philosophy rules in non-English)
- Custom vendor preset editor (UI to add new DCS platforms)
- AI explanation mode (detailed reasoning for each decision)

---

## Summary

The AI Rationalization feature combines:
- **Domain expertise** (ISA 18.2, IEC 62682, EEMUA 191 standards)
- **Vendor knowledge** (6 DCS platform presets)
- **Process understanding** (equipment dependencies, failure modes)
- **Site rules** (extracted from philosophy PDF)
- **Consistency enforcement** (reference alarms, batch grouping)

The result: **Fully compliant D&R documentation generated in minutes instead of weeks**, while maintaining human oversight and the ability to edit/approve all AI recommendations.
