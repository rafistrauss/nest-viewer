const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHVACAnalysisPrompt } = require('../ai/prompts/buildHVACAnalysisPrompt');

test('buildHVACAnalysisPrompt enforces markdown sections', () => {
    const prompt = buildHVACAnalysisPrompt({ analysisPeriodDays: 30 });
    assert.match(prompt, /## Observations/);
    assert.match(prompt, /## Possible Issues/);
    assert.match(prompt, /## Recommendations/);
});
