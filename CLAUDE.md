# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Alarm Analyzer Pro v5** - AI-Enhanced alarm rationalization application for process control systems. Complies with ISA 18.2, IEC 62682, and EEMUA 191 standards for alarm management.

The application analyzes alarm databases (CSV), extracts philosophy rules from PDF documents, and uses AI to generate Design & Rationalization (D&R) documentation including causes, consequences, corrective actions, and priority recommendations.

## Architecture

This is a **browser-based single-page application** with no build process. All dependencies are loaded via CDN.

### Service-Oriented Architecture

The application is structured around specialized service modules in `services/`:

- **dr-processor.js** (128KB) - Core D&R engine containing ISA 18.2 compliance logic, vendor-specific presets (Foxboro, Yokogawa, DeltaV, Wonderware, Honeywell, Emerson), alarm display name dictionary, and batch processing workflow
- **chatbot-service.js** - Azure OpenAI integration with dual-model support (general chat + reasoning models like GPT-5/o1/o3)
- **data-service.js** - CSV parsing, alarm database normalization, priority scheme detection
- **session-service.js** - Event session extraction with multi-unit tracking
- **rationalization-service.js** - Alarm rationalization workflow orchestration
- **process-mining-service.js** - Process analysis and equipment relationship mapping
- **ml-service.js** - Machine learning models using TensorFlow.js
- **control-loop-service.js** - Control loop analysis and tuning recommendations
- **stats-service.js** - Statistical analysis and reporting
- **game-service.js** - Gamification features for alarm management training

All services are exposed via `window` global namespace (e.g., `window.drProcessor`, `window.chatbotService`).

## AI Rationalization Workflow

The core workflow is documented in [docs/AI_Rationalization_Workflow.md](docs/AI_Rationalization_Workflow.md). Key steps:

1. **Upload CSV** (alarm database) + **Upload PDF** (site alarm philosophy)
2. **Process Analysis** - AI analyzes process context, equipment types, failure patterns
3. **Philosophy Extraction** - PDF parsed to extract priority matrix, response time rules, forbidden combinations
4. **Batch Drafting** - Alarms processed in batches of 10 using reference alarms and embedded standards knowledge
5. **Output** - CSV with AI-generated D&R fields (prefixed with "AI:"), compliance reports, priority analysis

### AI Model Configuration

The app uses **Azure OpenAI** with two deployment slots:
- `generalDeploymentName` - Standard chat/assistant (e.g., gpt-4.1)
- `drDeploymentName` - D&R reasoning model (e.g., gpt-5, o1, o3) with configurable reasoning effort

Configuration is stored in `openai-config.js` and localStorage.

## Running the Application

**No build required** - simply open [index.html](index.html) in a browser or serve with:

```bash
python -m http.server 8000
# or
npx http-server -p 8000
```

Then navigate to `http://localhost:8000`

## Configuration

### Azure OpenAI Setup

Edit [openai-config.js](openai-config.js):

```javascript
window.OPENAI_CONFIG = {
    apiKey: 'YOUR_AZURE_OPENAI_API_KEY_HERE',
    endpoint: 'https://YOUR-RESOURCE.openai.azure.com',
    deploymentName: 'gpt-4.1',
    apiVersion: '2024-02-15-preview'
};
```

**CRITICAL**: Never commit actual API keys. The file is tracked but should contain placeholder values only.

### Priority Schemes

The app auto-detects two priority naming conventions:
- **Numeric**: Priority 1, Priority 2, Priority 3, Priority 4
- **Descriptive**: Urgent, High, Medium, Low

AI output automatically matches the detected scheme from the uploaded CSV.

## Domain Knowledge

### Embedded Standards Knowledge

The [dr-processor.js](services/dr-processor.js) contains comprehensive alarm management rules:

- **ISA 18.2 / IEC 62682** compliance rules
- **Vendor presets** for 6 major DCS platforms
- **Alarm Display Name dictionary** (80+ alarm types)
- **Combination alarm rules** (HH/LL rationalization)
- **ESD bypass alarm guidelines**
- **Rate of change alarm policies**

### Reference Alarm Propagation

When processing alarms, the AI uses "D&R Complete" alarms from the same equipment tags as reference templates to maintain consistency.

## Key Files

- [index.html](index.html) - Main application UI (374KB monolithic file)
- [style.css](style.css) - Application styles
- [openai-config.js](openai-config.js) - Azure OpenAI credentials (**keep secure**)
- [services/dr-processor.js](services/dr-processor.js) - Core rationalization engine with ISA 18.2 compliance
- [docs/AI_Rationalization_Workflow.md](docs/AI_Rationalization_Workflow.md) - Detailed workflow documentation

## Data Format

### CSV Alarm Database

Expected columns:
- `Tag` - Equipment identifier (e.g., "B3PC30036A")
- `AlarmDisplayName` - Alarm type (e.g., "PVHIGH", "CMDDIS")
- `Description` - Human-readable alarm description
- `Priority` - Current priority level
- `D&R Complete` - Boolean indicating manual rationalization status
- `Cause1-5` - Root cause fields (multiple slots)
- `Consequence1-5` - Consequence fields
- `Corrective Action1-5` - Operator action fields
- `Max Response Time` - Required response time

AI fills the next available empty slot (e.g., if `Cause1` exists, uses `Cause2`).

## Common Modifications

### Adding New Vendor Presets

Edit the system prompt in [dr-processor.js](services/dr-processor.js:2000-2500) to add vendor-specific alarm rules.

### Adjusting Batch Size

Default is 10 alarms per batch. Modify `batchDraftRationalizations()` in [dr-processor.js](services/dr-processor.js) to change batch size (impacts API token usage).

### Changing Reasoning Model Behavior

Reasoning models (GPT-5, o1, o3) use the `reasoningEffort` setting: 'low', 'medium', 'high', 'xhigh'. Higher effort = deeper analysis but slower response.

## Security Notes

- **openai-config.js** contains API keys - ensure it's not committed with actual credentials
- The `.gitignore` includes `.env` and `*.log` but `openai-config.js` is tracked (should contain only placeholders)
- API configuration is also stored in browser localStorage for user-specific settings

## Browser Compatibility

Requires modern browser with support for:
- ES6+ JavaScript
- TensorFlow.js
- PDF.js
- React 18 (loaded via CDN)
- Chart.js, Vis.js, PapaParse, Moment.js, Lodash (all via CDN)
