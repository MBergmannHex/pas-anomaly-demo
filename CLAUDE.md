# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT**: When making architectural changes or adding new features, please update this file to reflect the current state of the codebase. This ensures consistent development practices.

## Project Overview

**Alarm Analyzer Pro v5** - AI-Enhanced alarm rationalization application for process control systems. Complies with ISA 18.2, IEC 62682, and EEMUA 191 standards for alarm management.

The application analyzes alarm databases (CSV), extracts philosophy rules from PDF documents, and uses AI to generate Design & Rationalization (D&R) documentation including causes, consequences, corrective actions, and priority recommendations.

## Architecture

**Full-stack application** with Node.js (Express) backend and browser-based SPA frontend.

### Backend (server/)

- **server.js** - Express server, serves static files, API routing
- **services/openai-proxy.js** - Proxies all Azure OpenAI API calls (hides API key)
- **prompts/** - AI system prompts (server-side only, not browser-accessible)
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

### PDF & Document Processing

**Token Capacity:** 128k input tokens (~75k-100k characters for documents)

**Processing Limits:**
- **Main D&R workflow** (`/api/dr/extract-philosophy`): **No truncation** - processes full PDFs
- **Chatbot features** (`/api/chat/extract-philosophy`, `/api/chat/enrich-safety`): Truncates to **100,000 characters** when needed
- **User notifications**: Displays warning in log when documents are truncated (e.g., "⚠️ Philosophy document was truncated: 85% of content processed")

**Output tokens:**
- Standard routes: 8,000 tokens
- Philosophy/safety extraction: 16,000 tokens (increased for better extraction quality)
- Batch rationalization: 32,000 tokens (for detailed D&R output)

### AI Prompt Management

All AI system prompts are stored in `server/prompts/` for security and easy editing:

**Prompt Files:**
- `batch-drafter.js` - 189-line ISA 18.2 D&R system prompt with vendor presets, alarm dictionaries, and compliance rules
- `process-analyzer.js` - Process analysis and failure pattern recognition
- `chatbot-persona.js` - Chatbot AI persona with tool usage rules
- `philosophy-extraction.js` - Philosophy document parsing rules
- `control-loop-parser.js` - Control loop log extraction (template function)
- `report-generation.js` - PDF report narrative generation (template function)
- `regex-derivation.js` - Regex pattern derivation (template function)
- `chat-philosophy-extract.js` - Simple philosophy extraction prefix
- `safety-enrichment.js` - Safety data extraction prefix
- `index.js` - Central exports for all prompts

**Architecture:**
- Frontend sends **only data** (alarm lists, CSV text, log entries, etc.)
- Backend **constructs prompts** by loading from `server/prompts/` and injecting data
- Prompts are **not browser-accessible** - hidden from DevTools
- Template prompts are functions that accept parameters and return prompt strings

**When to edit prompts:**
- To add new vendor DCS platforms → edit `batch-drafter.js`
- To change chatbot behavior → edit `chatbot-persona.js`
- To modify philosophy extraction schema → edit `philosophy-extraction.js`
- To adjust process analysis guidance → edit `process-analyzer.js`

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

The AI system prompts in `server/prompts/batch-drafter.js` contain comprehensive alarm management rules:

- **ISA 18.2 / IEC 62682** compliance rules
- **Vendor presets** for 6 major DCS platforms (Foxboro I/A, Yokogawa CENTUM, DeltaV, Wonderware, Honeywell, Emerson Ovation)
- **Alarm Display Name dictionary** (80+ alarm types)
- **Combination alarm rules** (HH/LL rationalization)
- **ESD bypass alarm guidelines**
- **Rate of change alarm policies**

These rules are **server-side only** and not visible in browser DevTools.

### Reference Alarm Propagation

When processing alarms, the AI uses "D&R Complete" alarms from the same equipment tags as reference templates to maintain consistency.

## Key Files

**Frontend:**
- [public/index.html](public/index.html) - Main application UI (374KB monolithic file)
- [public/style.css](public/style.css) - Application styles
- [public/services/dr-processor.js](public/services/dr-processor.js) - Core rationalization engine, batch processing logic
- [public/services/chatbot-service.js](public/services/chatbot-service.js) - AI chat interface with tool calling

**Backend:**
- [server/server.js](server/server.js) - Express server setup
- [server/services/openai-proxy.js](server/services/openai-proxy.js) - Azure OpenAI API proxy
- [server/prompts/](server/prompts/) - All AI system prompts (secured server-side)
- [server/routes/chat.js](server/routes/chat.js) - Chat and report generation endpoints
- [server/routes/dr-process.js](server/routes/dr-process.js) - D&R rationalization endpoints
- [server/routes/control-loop.js](server/routes/control-loop.js) - Control loop analysis endpoints

**Documentation:**
- [docs/AI_Rationalization_Workflow.md](docs/AI_Rationalization_Workflow.md) - Detailed workflow documentation
- [CLAUDE.md](CLAUDE.md) - This file - development guidance

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

Edit the `batch-drafter.js` prompt file in [server/prompts/batch-drafter.js](server/prompts/batch-drafter.js) under the "VENDOR-SPECIFIC D&R PRESETS" section (around line 70-130) to add vendor-specific alarm rules.

### Adjusting Batch Size

Default is 10 alarms per batch. Modify `batchDraftRationalizations()` in [public/services/dr-processor.js](public/services/dr-processor.js) to change batch size (impacts API token usage).

### Changing Reasoning Model Behavior

Reasoning models (GPT-5, o1, o3) use the `reasoningEffort` setting: 'low', 'medium', 'high', 'xhigh'. Higher effort = deeper analysis but slower response.

## Security Notes

**API Keys & Credentials:**
- Never commit `.env` file (already in `.gitignore`)
- Azure OpenAI credentials are server-side only (in `.env` or Azure App Service environment variables)
- The frontend has **no direct access** to API keys

**Prompt Security:**
- All AI system prompts are in `server/prompts/` - **not browser-accessible**
- Proprietary ISA 18.2 rules, vendor presets, and prompt engineering are hidden from DevTools
- Frontend sends only data; backend constructs prompts server-side

**Static File Serving:**
- Only `public/` directory is served as static files
- `server/`, `.env`, and `node_modules/` are never exposed to browsers

## Browser Compatibility

Requires modern browser with support for:
- ES6+ JavaScript
- TensorFlow.js
- PDF.js
- React 18 (loaded via CDN)
- Chart.js, Vis.js, PapaParse, Moment.js, Lodash (all via CDN)
