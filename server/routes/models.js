const express = require('express');
const router = express.Router();
const path = require('path');

const modelsData = require(path.join(__dirname, '..', 'models.json'));

router.get('/', (req, res) => {
    res.json(modelsData);
});

module.exports = router;
