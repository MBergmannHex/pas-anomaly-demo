# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Alarm Analyzer Pro v5** - AI-Enhanced alarm rationalization application for process control systems. Complies with ISA 18.2, IEC 62682, and EEMUA 191 standards for alarm management.

The application analyzes alarm databases (CSV), extracts philosophy rules from PDF documents, and uses AI to generate Design & Rationalization (D&R) documentation including causes, consequences, corrective actions, and priority recommendations.

## Architecture

**Full-stack application** with Node.js (Express) backend and browser-based SPA frontend.

### Backend (server/)

- **server.js** - Express server, serves static files, API routing
- **services/openai-proxy.js** - Proxies all Azure OpenAI API calls (hides API key)
- **routes/** - API endpoints for chat, D&R processing, control loop analysis
- **middleware/** - Error handling, rate limiting

### Frontend (public/)

Service-oriented architecture with modules in `public/services/`:

- **dr-processor.js** - Core D&R engine with ISA 18.2 compliance logic, vendor presets, alarm dictionary
- **chatbot-service.js** - AI chat interface (calls backend `/api/chat/*`)
- **data-service.js** - CSV parsing, alarm database normalization
- **session-service.js** - Event session extraction
- **rationalization-service.js** - Alarm rationalization workflow
- **process-mining-service.js** - Process analysis and equipment mapping
- **ml-service.js** - TensorFlow.js models (client-side)
- **control-loop-service.js** - Control loop analysis
- **stats-service.js** - Statistical analysis
- **game-service.js** - Gamification features

All frontend services use `window` global namespace. All Azure OpenAI calls route through backend.

## AI Rationalization Workflow

The core workflow is documented in [docs/AI_Rationalization_Workflow.md](docs/AI_Rationalization_Workflow.md). Key steps:

1. **Upload CSV** (alarm database) + **Upload PDF** (site alarm philosophy)
2. **Process Analysis** - AI analyzes process context, equipment types, failure patterns
3. **Philosophy Extraction** - PDF parsed to extract priority matrix, response time rules, forbidden combinations
4. **Batch Drafting** - Alarms processed in batches of 10 using reference alarms and embedded standards knowledge
5. **Output** - CSV with AI-generated D&R fields (prefixed with "AI:"), compliance reports, priority analysis

### AI Model Configuration

The backend uses **Azure OpenAI** with two deployment configurations:
- `AZURE_OPENAI_GENERAL_DEPLOYMENT` - Standard chat/assistant (e.g., gpt-4.1)
- `AZURE_OPENAI_DR_DEPLOYMENT` - D&R reasoning model (e.g., gpt-5, o1, o3)

API credentials are stored server-side in `.env` (local) or Azure App Service environment variables (production).

## Running the Application

### Local Development

1. **Set up environment variables:**
   ```bash
   cp .env.template .env
   # Edit .env with your Azure OpenAI credentials
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

4. **Navigate to:** `http://localhost:8080`

### Azure Deployment

The app is configured for Azure App Service with:
- **web.config** - IIS/iisnode configuration
- **Environment variables** - Set in Azure Portal under Configuration
- **Deployment** - Git push, GitHub Actions, or Azure CLI

## Development Workflow

### Git Commits and Deployment

**IMPORTANT**: After making code changes, always commit and push to GitHub to trigger automatic deployment to Azure.

**Standard workflow:**
1. Make changes to code
2. Test locally (if applicable)
3. Stage and commit changes:
   ```bash
   git add <files>
   git commit -m "Description of changes

   Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
   ```
4. **Push to GitHub** (triggers auto-deployment):
   ```bash
   git push origin main
   ```
5. GitHub Actions automatically deploys to Azure App Service

**Files to exclude from commits:**
- `.env` (local environment variables)
- `*.log` (log files)
- `.claude/settings.local.json` (local Claude settings)
- Temporary files (e.g., `*.backup`, `*.zip`, `*.tar.gz`)

**Best practices:**
- Write clear, descriptive commit messages
- Group related changes in a single commit
- Always push after completing a feature or fix
- Verify deployment success via GitHub Actions or Azure Portal

## Configuration

### Azure OpenAI Setup

Edit `.env` file (local development):

```bash
AZURE_OPENAI_API_KEY=your_api_key_here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_GENERAL_DEPLOYMENT=gpt-4.1
AZURE_OPENAI_DR_DEPLOYMENT=gpt-5
AZURE_OPENAI_API_VERSION=2025-03-01-preview
AZURE_OPENAI_REASONING_EFFORT=medium
```

**CRITICAL**: Never commit `.env` file (already in `.gitignore`). For Azure deployment, set these as App Service environment variables.

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
