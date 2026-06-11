const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEventExplanationPrompt } = require('../ai/prompts/buildEventExplanationPrompt');
const { buildHVACAnalysisPrompt } = require('../ai/prompts/buildHVACAnalysisPrompt');

test('buildEventExplanationPrompt includes event payload and constraints', () => {
    const prompt = buildEventExplanationPrompt({ mode: 'cooling', durationMinutes: 12 });
    assert.match(prompt, /cooling/);
    assert.match(prompt, /Avoid speculation/);
    assert.match(prompt, /Facts:/);
});

test('buildHVACAnalysisPrompt enforces markdown sections', () => {
    const prompt = buildHVACAnalysisPrompt({ analysisPeriodDays: 30 });
    assert.match(prompt, /## Observations/);
    assert.match(prompt, /## Possible Issues/);
    assert.match(prompt, /## Recommendations/);
});
