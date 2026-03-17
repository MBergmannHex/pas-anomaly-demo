/**
 * Alarm Analyzer Pro v5 - Backend Server
 * Express server that proxies Azure OpenAI calls and serves the frontend
 */

const app = require('./app');
const config = require('./config');

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
    console.log(`🚀 Alarm Analyzer Pro v5 server running on port ${PORT}`);
    console.log(`   Environment: ${config.server.nodeEnv}`);
    console.log(`   Azure OpenAI Endpoint: ${config.azureOpenAI.endpoint}`);
    console.log(`   General Model: ${config.azureOpenAI.generalDeployment}`);
    console.log(`   D&R Model: ${config.azureOpenAI.drDeployment}`);
});
