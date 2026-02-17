# Azure App Service Deployment Guide

## Live Application
- **URL:** https://pas-anomaly.azurewebsites.net/
- **Platform:** Azure App Service (Linux, Node.js 22 LTS)
- **Resource Group:** AIC-Lab
- **Subscription:** Hexagon PPM-AI Services-Hobbits-CorpNet-EA-DevTest

## Automated Deployment

Every push to the `main` branch automatically deploys to Azure via GitHub Actions.

**Workflow:** [`.github/workflows/azure-deploy.yml`](.github/workflows/azure-deploy.yml)

### How It Works
1. Creates deployment package (excludes `.git`, `.github`, `node_modules`, `*.md`)
2. Authenticates to Azure using service principal
3. Deploys via `az webapp deployment source config-zip`
4. Azure automatically runs `npm install` on the server
5. Starts the app using the configured startup command

## Manual Deployment (if needed)

```bash
# Create deployment package
zip -r deploy.zip . -x ".git/*" ".github/*" "node_modules/*" "*.md"

# Deploy to Azure
az webapp deployment source config-zip \
  --resource-group AIC-Lab \
  --name pas-anomaly \
  --subscription 466c9654-1c8f-4bf5-95ba-c464c64aa485 \
  --src deploy.zip
```

## Azure Configuration

### Runtime Settings
```bash
# Node.js version
linuxFxVersion: NODE|22-lts

# Startup command
appCommandLine: node server/server.js

# Port
Automatically provided by Azure as process.env.PORT (used in server/config.js)
```

### Environment Variables
Configured in Azure Portal → App Service → Configuration:

| Variable | Value |
|----------|-------|
| `AZURE_OPENAI_API_KEY` | (secret) |
| `AZURE_OPENAI_ENDPOINT` | https://hobbits-gpt-eastus2.openai.azure.com |
| `AZURE_OPENAI_GENERAL_DEPLOYMENT` | gpt-4.1 |
| `AZURE_OPENAI_DR_DEPLOYMENT` | gpt-5 |
| `AZURE_OPENAI_API_VERSION` | 2025-03-01-preview |

## GitHub Secrets

Required for automated deployment:

| Secret | Purpose | How to Generate |
|--------|---------|----------------|
| `AZURE_CREDENTIALS` | Service principal for deployment | See below |

### Creating Service Principal for GitHub Actions

```bash
# Use MSYS_NO_PATHCONV=1 to avoid Git Bash path issues on Windows
MSYS_NO_PATHCONV=1 az ad sp create-for-rbac \
  --name "github-pas-anomaly-deploy" \
  --role contributor \
  --scopes /subscriptions/466c9654-1c8f-4bf5-95ba-c464c64aa485/resourceGroups/AIC-Lab \
  --json-auth

# Copy the JSON output and add as GitHub secret AZURE_CREDENTIALS
```

## Troubleshooting

### Check Application Logs
```bash
az webapp log tail \
  --name pas-anomaly \
  --resource-group AIC-Lab \
  --subscription 466c9654-1c8f-4bf5-95ba-c464c64aa485
```

### Verify App is Running
```bash
# Check HTTP status
curl -I https://pas-anomaly.azurewebsites.net/

# Test API endpoint
curl -X POST https://pas-anomaly.azurewebsites.net/api/test-connection \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}],"modelConfig":{"deploymentType":"general"}}'
```

### View GitHub Actions Logs
```bash
gh run list --repo MBergmannHex/pas-anomaly-demo
gh run view <run-id> --log
```

### Common Issues

**"Site failed to start within 10 mins"**
- Usually caused by deploying Windows-built `node_modules` to Linux
- Solution: Exclude `node_modules` from deployment package (already configured)
- Azure automatically runs `npm install` with correct platform binaries

**"Publish profile is invalid"**
- Don't use `azure/webapps-deploy` action with publish profile on Linux
- Solution: Use Azure CLI deployment (already configured)

**Git Bash path issues**
- Azure CLI commands fail with "MissingSubscription" error
- Solution: Prefix commands with `MSYS_NO_PATHCONV=1`

## Architecture Notes

- **Backend:** Express.js server proxies all Azure OpenAI API calls
- **Frontend:** Vanilla JS SPA served as static files from `public/`
- **Security:** API keys never exposed to client, all AI requests go through backend
- **Stateless:** No server-side session storage, all data in browser IndexedDB

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.
