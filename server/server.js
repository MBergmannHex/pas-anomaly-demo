/**
 * Alarm Analyzer Pro v5 - Backend Server
 * Express server that proxies Azure OpenAI calls and serves the frontend
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const errorHandler = require('./middleware/error-handler');
const rateLimiter = require('./middleware/rate-limiter');

const app = express();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false  // Disabled because frontend loads many CDN scripts
}));

// CORS configuration
app.use(cors({
    origin: config.server.corsOrigin
}));

// Body parsing with high limit for P&ID images + PDF text
app.use(express.json({ limit: config.server.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.server.bodyLimit }));

// Apply rate limiting to API routes
app.use('/api/', rateLimiter);

// API routes
app.use('/api', require('./routes/health'));
app.use('/api', require('./routes/dr-process'));  // Includes /api/test-connection
app.use('/api/chat', require('./routes/chat'));
app.use('/api/control-loop', require('./routes/control-loop'));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback - serve index.html for any non-API route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
    console.log(`🚀 Alarm Analyzer Pro v5 server running on port ${PORT}`);
    console.log(`   Environment: ${config.server.nodeEnv}`);
    console.log(`   Azure OpenAI Endpoint: ${config.azureOpenAI.endpoint}`);
    console.log(`   General Model: ${config.azureOpenAI.generalDeployment}`);
    console.log(`   D&R Model: ${config.azureOpenAI.drDeployment}`);
});
