# Alarm Analyzer Pro v5

AI-Enhanced alarm rationalization application for process control systems.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.template .env
   # Edit .env with your Azure OpenAI credentials
   ```

3. **Run locally:**
   ```bash
   npm start
   ```

4. **Open:** http://localhost:8080

## Azure Deployment

### Requirements
- Azure App Service (Node.js 18+)
- Azure OpenAI Service

### Deployment Steps

1. **Create Azure App Service** (Node.js 20 LTS runtime)

2. **Configure Environment Variables** in Azure Portal → Configuration:
   ```
   AZURE_OPENAI_API_KEY=<your-key>
   AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
   AZURE_OPENAI_GENERAL_DEPLOYMENT=gpt-4.1
   AZURE_OPENAI_DR_DEPLOYMENT=gpt-5
   AZURE_OPENAI_API_VERSION=2025-03-01-preview
   NODE_ENV=production
   ```

3. **Deploy via Git:**
   ```bash
   git remote add azure <your-azure-git-url>
   git push azure main
   ```

## Architecture

- **Backend:** Node.js + Express (proxies Azure OpenAI API calls)
- **Frontend:** Vanilla JS SPA with CDN dependencies
- **No build process required**

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Security

- API keys stored server-side only (never exposed to client)
- All AI requests route through backend proxy
- CORS and rate limiting configured
- Helmet.js for security headers

## Development

```bash
npm run dev  # Start with nodemon (auto-reload)
```

## License

Proprietary - Hexagon PSE
