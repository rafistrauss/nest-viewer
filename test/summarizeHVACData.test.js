const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeHVACData } = require('../ai/summarizers/summarizeHVACData');

test('summarizeHVACData returns compact metrics', () => {
    const records = [
        { timestamp: '2026-01-01T00:00:00Z', indoor_temp: 24, cooling_time: 600, heating_time: 0 },
        { timestamp: '2026-01-01T00:15:00Z', indoor_temp: 23, cooling_time: 600, heating_time: 0 },
        { timestamp: '2026-01-01T00:30:00Z', indoor_temp: 22, cooling_time: 0, heating_time: 0 },
        { timestamp: '2026-01-01T00:45:00Z', indoor_temp: 22.5, cooling_time: 0, heating_time: 900 },
        { timestamp: '2026-01-01T01:00:00Z', indoor_temp: 23.5, cooling_time: 0, heating_time: 900 }
    ];

    const result = summarizeHVACData(records, 30);
    assert.equal(result.analysisPeriodDays, 30);
    assert.equal(result.dataPoints, 5);
    assert.equal(result.avgCoolingCycleMinutes, 20);
    assert.equal(result.avgHeatingCycleMinutes, 30);
    assert.ok(result.coolingCyclesPerDay > 0);
    assert.ok(result.heatingCyclesPerDay > 0);
});

test('summarizeHVACData handles empty input', () => {
    const result = summarizeHVACData([], 30);
    assert.equal(result.dataPoints, 0);
    assert.equal(result.avgCoolingCycleMinutes, null);
    assert.equal(result.maxIndoorTemp, null);
});
