
const prompts = require('../prompts');

describe('server/prompts', () => {
    it('exports all expected prompt modules', () => {
        expect(prompts).toHaveProperty('batchDrafter');
        expect(prompts).toHaveProperty('processAnalyzer');
        expect(prompts).toHaveProperty('regexDerivation');
        expect(prompts).toHaveProperty('philosophyExtraction');
        expect(prompts).toHaveProperty('chatbotPersona');
        expect(prompts).toHaveProperty('reportGeneration');
        expect(prompts).toHaveProperty('controlLoopParser');
        expect(prompts).toHaveProperty('chatPhilosophyExtract');
        expect(prompts).toHaveProperty('safetyEnrichment');
    });

    it('batchDrafter is a non-empty string', () => {
        expect(typeof prompts.batchDrafter).toBe('string');
        expect(prompts.batchDrafter.length).toBeGreaterThan(100);
    });

    it('processAnalyzer is a non-empty string', () => {
        expect(typeof prompts.processAnalyzer).toBe('string');
        expect(prompts.processAnalyzer.length).toBeGreaterThan(50);
    });

    it('controlLoopParser is a template function', () => {
        expect(typeof prompts.controlLoopParser).toBe('function');
        const result = prompts.controlLoopParser('TEST-TAG-001');
        expect(typeof result).toBe('string');
        expect(result).toContain('TEST-TAG-001');
        expect(result).toContain('SP');
        expect(result).toContain('OP');
    });

    it('reportGeneration is a template function', () => {
        expect(typeof prompts.reportGeneration).toBe('function');
        const result = prompts.reportGeneration({ totalAlarms: 100 }, 'Priority Distribution');
        expect(typeof result).toBe('string');
        expect(result).toContain('100');
        expect(result).toContain('Priority Distribution');
    });

    it('regexDerivation is a template function', () => {
        expect(typeof prompts.regexDerivation).toBe('function');
        const result = prompts.regexDerivation('XIL5705 -> XIL');
        expect(typeof result).toBe('string');
        expect(result).toContain('XIL5705');
    });
});
