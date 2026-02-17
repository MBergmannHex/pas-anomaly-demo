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

// CORS configuration - MUST come before helmet
app.use(cors({
    origin: config.server.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,  // Disabled because frontend loads many CDN scripts
    crossOriginEmbedderPolicy: false,  // Disable to allow cross-origin requests
    crossOriginResourcePolicy: { policy: "cross-origin" }  // Allow cross-origin resources
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
