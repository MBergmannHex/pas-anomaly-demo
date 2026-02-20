'use strict';
/**
 * Analysis Routes - Pure algorithmic endpoints (no OpenAI)
 * Serves server-side IP: tag intelligence, nuisance scoring, process mining, session extraction
 */

const express = require('express');
const router = express.Router();
const ai = require('../utils/alarm-intelligence');
const nuisance = require('../utils/nuisance-scoring');
const pm = require('../utils/process-mining');
const se = require('../utils/session-extraction');

/**
 * POST /api/analysis/detect-patterns
 * Detects unique tag naming patterns from alarm database records.
 * Body: { data: AlarmRecord[], maxExamples?: number }
 */
router.post('/detect-patterns', (req, res, next) => {
    try {
        const { data, maxExamples } = req.body;
        if (!data || !Array.isArray(data)) {
            return res.status(400).json({ error: 'data array is required' });
        }
        const patterns = ai.detectTagPatterns(data, maxExamples || 5);
        res.json(patterns);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/analysis/derive-rule
 * Derives a tag parsing rule from user-provided examples using 4-strategy algorithm.
 * Body: { examples: [{ tag: string, prefix: string }] }
 */
router.post('/derive-rule', (req, res, next) => {
    try {
        const { examples } = req.body;
        if (!examples || !Array.isArray(examples)) {
            return res.status(400).json({ error: 'examples array is required' });
        }
        const rule = ai.deriveConsolidatedRule(examples);
        res.json(rule || { type: 'leadingLetters', description: 'Default (Leading Letters)' });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/analysis/nuisance-alarms
 * Scores alarms for nuisance characteristics using ISA 18.2 compliant algorithm.
 * Body: { data: EventRecord[], validSessions: Session[], allSessions: Session[] }
 */
router.post('/nuisance-alarms', (req, res, next) => {
    try {
        const { data, validSessions, allSessions } = req.body;
        if (!data || !validSessions || !allSessions) {
            return res.status(400).json({ error: 'data, validSessions, and allSessions are required' });
        }
        const result = nuisance.analyzeNuisanceAlarms(data, validSessions, allSessions);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/analysis/autonomous-rationalize
 * Applies philosophy rules and safety context to classify alarms autonomously.
 * Body: { philosophyRules: object, safetyContext: object[], rawData: EventRecord[] }
 */
router.post('/autonomous-rationalize', async (req, res, next) => {
    try {
        const { philosophyRules, safetyContext, rawData } = req.body;
        if (!philosophyRules || !safetyContext || !rawData) {
            return res.status(400).json({ error: 'philosophyRules, safetyContext, and rawData are required' });
        }
        const result = await nuisance.runAutonomousRationalization(philosophyRules, safetyContext, rawData);
        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/analysis/process-mine
 * Runs heuristic process mining operations on alarm session data.
 * Body: { sessions: Session[], operation: 'buildProcessGraph'|'createDFG'|'discoverProcessVariants', filters?: object }
 */
router.post('/process-mine', (req, res, next) => {
    try {
        const { sessions, operation, filters } = req.body;
        if (!sessions || !Array.isArray(sessions)) {
            return res.status(400).json({ error: 'sessions array is required' });
        }
        if (!operation) {
            return res.status(400).json({ error: 'operation is required (buildProcessGraph, createDFG, or discoverProcessVariants)' });
        }

        let result;
        switch (operation) {
            case 'buildProcessGraph':
                result = pm.buildProcessGraph(sessions, filters || {});
                break;
            case 'createDFG':
                result = pm.createDFG(sessions);
                break;
            case 'discoverProcessVariants':
                result = pm.discoverProcessVariants(sessions);
                break;
            default:
                return res.status(400).json({ error: `Unknown operation: ${operation}` });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/analysis/extract-sessions
 * Extracts alarm sessions from event data using concurrent unit tracking algorithm.
 * Returns sessions and pre-computed unit statistics in one call.
 * Body: { data: EventRecord[] }
 */
router.post('/extract-sessions', (req, res, next) => {
    try {
        const { data } = req.body;
        if (!data || !Array.isArray(data)) {
            return res.status(400).json({ error: 'data array is required' });
        }
        const sessions = se.extractSessions(data);
        const unitStatistics = se.getUnitStatistics(sessions);
        res.json({ sessions, unitStatistics });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
