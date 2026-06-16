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

test('summarizeHVACData labels the temperature unit from options', () => {
    const records = [
        { timestamp: '2026-07-01T00:00:00Z', indoor_temp: 70, outdoor_temp: 90, cooling_time: 600, heating_time: 0 }
    ];
    assert.equal(summarizeHVACData(records, 30, { temperatureUnit: 'Fahrenheit (°F)' }).temperatureUnit, 'Fahrenheit (°F)');
    assert.equal(summarizeHVACData([], 30, { temperatureUnit: 'Celsius (°C)' }).temperatureUnit, 'Celsius (°C)');
    assert.equal(summarizeHVACData(records, 30).temperatureUnit, 'source-native (unconverted)');
});

test('summarizeHVACData retains outdoor, humidity and setpoint context', () => {
    const records = [
        { timestamp: '2026-07-01T00:00:00Z', indoor_temp: 25, outdoor_temp: 33, indoor_humidity: 50, outdoor_humidity: 70, cooling_time: 600, heating_time: 0, cooling_target: 22 },
        { timestamp: '2026-07-01T00:15:00Z', indoor_temp: 24, outdoor_temp: 34, indoor_humidity: 52, outdoor_humidity: 72, cooling_time: 600, heating_time: 0, cooling_target: 22 }
    ];

    const result = summarizeHVACData(records, 30);
    assert.equal(result.avgOutdoorTemp, 33.5);
    assert.equal(result.maxOutdoorTemp, 34);
    assert.equal(result.avgIndoorHumidity, 51);
    assert.equal(result.avgOutdoorHumidity, 71);
    assert.equal(result.avgCoolingTarget, 22);
    assert.equal(result.avgIndoorMinusCoolingTarget, 2.5);
});

test('summarizeHVACData normalizes cyclesPerDay by actual data span, not nominal window', () => {
    // 1 cooling cycle within 1 hour of data, analysed over a 30-day window.
    const records = [
        { timestamp: '2026-07-01T00:00:00Z', indoor_temp: 25, outdoor_temp: 30, cooling_time: 600, heating_time: 0 },
        { timestamp: '2026-07-01T00:15:00Z', indoor_temp: 24, outdoor_temp: 30, cooling_time: 600, heating_time: 0 },
        { timestamp: '2026-07-01T00:30:00Z', indoor_temp: 23, outdoor_temp: 30, cooling_time: 0, heating_time: 0 }
    ];

    const result = summarizeHVACData(records, 30);
    assert.equal(result.coolingCycleCount, 1);
    // Span is floored at 1 hour to avoid absurd extrapolation from tiny datasets.
    assert.ok(result.coolingCyclesPerDay > 1);
    assert.equal(result.actualDataSpanDays, round2(1 / 24));
});

test('summarizeHVACData flags counterproductive cooling intervals', () => {
    const records = [
        { timestamp: '2026-07-01T00:00:00Z', indoor_temp: 24, cooling_time: 600, heating_time: 0 },
        { timestamp: '2026-07-01T00:15:00Z', indoor_temp: 25, cooling_time: 600, heating_time: 0 }
    ];

    const result = summarizeHVACData(records, 30);
    assert.equal(result.coolingIntervalsTempRose, 1);
});

test('summarizeHVACData exposes a period breakdown to preserve trends', () => {
    const records = [
        // Early period: anomalously high runtime in mild weather (problem period)
        { timestamp: '2026-06-01T00:00:00Z', indoor_temp: 26, outdoor_temp: 21, cooling_time: 900, heating_time: 0, cooling_target: 22 },
        { timestamp: '2026-06-01T00:15:00Z', indoor_temp: 26, outdoor_temp: 21, cooling_time: 900, heating_time: 0, cooling_target: 22 },
        { timestamp: '2026-06-01T00:30:00Z', indoor_temp: 25.5, outdoor_temp: 21, cooling_time: 900, heating_time: 0, cooling_target: 22 },
        // Later period: normal short runtime even in hotter weather (resolved)
        { timestamp: '2026-06-10T00:00:00Z', indoor_temp: 22.5, outdoor_temp: 30, cooling_time: 300, heating_time: 0, cooling_target: 22 },
        { timestamp: '2026-06-10T00:15:00Z', indoor_temp: 22, outdoor_temp: 30, cooling_time: 0, heating_time: 0, cooling_target: 22 }
    ];

    const result = summarizeHVACData(records, 30);
    // A ~9-day span is short, so daily granularity is used.
    assert.equal(result.breakdownGranularity, 'daily');
    assert.equal(result.periodBreakdown.length, 2);

    const [first, second] = result.periodBreakdown;
    assert.ok(first.coolingRuntimeHours > second.coolingRuntimeHours);
    assert.ok(first.avgOutdoorTemp < second.avgOutdoorTemp);
    // The problem period ran far more despite cooler weather; the trend must be visible.
    assert.ok(first.avgIndoorMinusCoolingTarget > second.avgIndoorMinusCoolingTarget);
    assert.ok(first.dayStart < second.dayStart);
});

test('summarizeHVACData uses weekly granularity for long spans', () => {
    const records = [];
    // ~28 days of data, one reading per day, to force weekly bucketing.
    for (let day = 0; day < 28; day++) {
        const date = new Date('2026-06-01T00:00:00Z');
        date.setUTCDate(date.getUTCDate() + day);
        records.push({
            timestamp: date.toISOString(),
            indoor_temp: 22,
            outdoor_temp: 28,
            cooling_time: 300,
            heating_time: 0,
            cooling_target: 22
        });
    }

    const result = summarizeHVACData(records, 30);
    assert.equal(result.breakdownGranularity, 'weekly');
    assert.ok(result.periodBreakdown.length >= 4);
    assert.ok(result.periodBreakdown.every(bucket => typeof bucket.weekStart === 'string'));
    // Backward-compatible alias is populated for weekly granularity.
    assert.equal(result.weeklyBreakdown.length, result.periodBreakdown.length);
});

function round2(value) {
    return Math.round(value * 100) / 100;
}
