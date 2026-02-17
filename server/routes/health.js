/**
 * Health check route
 */

const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '5.0.0'
    });
});

module.exports = router;
