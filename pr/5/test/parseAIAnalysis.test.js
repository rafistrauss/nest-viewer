const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAIAnalysis } = require('../ai/parsers/parseAIAnalysis');

test('parseAIAnalysis extracts anomalies and strips the JSON block', () => {
    const response = [
        '## Observations',
        '- The system struggled early in the period.',
        '',
        '```json',
        '{"anomalies":[{"start":"2026-06-01T00:00:00Z","end":"2026-06-03T00:00:00Z","severity":"high","title":"Long cycles","detail":"Cooling ran for many hours."}]}',
        '```'
    ].join('\n');

    const { markdown, anomalies } = parseAIAnalysis(response);

    assert.ok(!markdown.includes('```'));
    assert.match(markdown, /## Observations/);
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].severity, 'high');
    assert.equal(anomalies[0].title, 'Long cycles');
    assert.equal(anomalies[0].startMs, new Date('2026-06-01T00:00:00Z').getTime());
    assert.ok(anomalies[0].endMs > anomalies[0].startMs);
});

test('parseAIAnalysis returns no anomalies when block is absent', () => {
    const response = '## Observations\n- Everything looks healthy.';
    const { markdown, anomalies } = parseAIAnalysis(response);
    assert.equal(anomalies.length, 0);
    assert.equal(markdown, response);
});

test('parseAIAnalysis ignores invalid severity and missing end', () => {
    const response = [
        'Some text',
        '```json',
        '{"anomalies":[{"start":"2026-06-05T12:00:00Z","severity":"bogus","title":"Spike"}]}',
        '```'
    ].join('\n');

    const { anomalies } = parseAIAnalysis(response);
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].severity, 'medium');
    assert.equal(anomalies[0].startMs, anomalies[0].endMs);
});

test('parseAIAnalysis normalizes reversed ranges and sorts by start', () => {
    const response = [
        '```json',
        '{"anomalies":[',
        '{"start":"2026-06-10T00:00:00Z","end":"2026-06-08T00:00:00Z","severity":"low","title":"B"},',
        '{"start":"2026-06-01T00:00:00Z","end":"2026-06-02T00:00:00Z","severity":"medium","title":"A"}',
        ']}',
        '```'
    ].join('\n');

    const { anomalies } = parseAIAnalysis(response);
    assert.equal(anomalies.length, 2);
    // Sorted by start ascending.
    assert.equal(anomalies[0].title, 'A');
    assert.equal(anomalies[1].title, 'B');
    // Reversed range is corrected so start <= end.
    assert.ok(anomalies[1].startMs <= anomalies[1].endMs);
});

test('parseAIAnalysis drops anomalies without a valid start', () => {
    const response = '```json\n{"anomalies":[{"severity":"high","title":"No time"}]}\n```';
    const { anomalies } = parseAIAnalysis(response);
    assert.equal(anomalies.length, 0);
});
