/**
 * Rate limiting middleware
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

const limiter = rateLimit({
    windowMs: config.rateLimiting.windowMs,
    max: config.rateLimiting.maxRequests,
    message: { error: 'Too many requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = limiter;
