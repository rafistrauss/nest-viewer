const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// --- Load DataProcessor from the (non-module) worker file ---
function loadDataProcessor() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'dataWorker.js'), 'utf8')
        + '\n;globalThis.__DataProcessor = DataProcessor;';
    const ctx = { self: { onmessage: null, postMessage() {} }, console };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return ctx.__DataProcessor;
}

// --- Load NestDataViewer prototype (non-module, needs DOM stubs) ---
function loadViewerPrototype() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
        + '\n;globalThis.__NDV = NestDataViewer;';
    const ctx = {
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        console,
        setTimeout,
    };
    ctx.globalThis = ctx;
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return ctx.__NDV.prototype;
}

const DataProcessor = loadDataProcessor();
const proto = loadViewerPrototype();

// Build a record at a given ISO time with outdoor temp (°C) and runtime seconds.
function rec(iso, outdoorC, coolingSec = 0, heatingSec = 0) {
    return {
        interval_start: iso,
        interval_end: new Date(new Date(iso).getTime() + 15 * 60000).toISOString(),
        timestamp: new Date(iso),
        outdoor_temp: outdoorC,
        cooling_time: coolingSec,
        heating_time: heatingSec,
    };
}

test('aggregateEfficiencyData buckets by day and sums degree-days/runtime', () => {
    // base 18.333°C. Two 15-min intervals on the same day, outdoor 28.333°C.
    // Per interval CDD = (28.333-18.333) * (0.25/24) = 10 * 0.0104167 = 0.104167
    const data = [
        rec('2025-07-01T00:00:00Z', 28.333333, 900, 0),
        rec('2025-07-01T00:15:00Z', 28.333333, 900, 0),
    ];
    const out = DataProcessor.aggregateEfficiencyData(data, { aggregationType: 'daily', baseTempC: 18.333333 });
    assert.strictEqual(out.length, 1);
    const b = out[0];
    assert.ok(Math.abs(b.cdd - 0.208333) < 1e-4, `cdd was ${b.cdd}`);
    assert.strictEqual(b.hdd, 0);
    assert.ok(Math.abs(b.coolingHours - 0.5) < 1e-9, `coolingHours ${b.coolingHours}`); // 900s*2 = 0.5h
});

test('aggregateEfficiencyData skips records with null/non-finite outdoor temp', () => {
    const data = [
        rec('2025-07-01T00:00:00Z', null, 900, 0),
        rec('2025-07-01T00:15:00Z', 28, 900, 0),
    ];
    const out = DataProcessor.aggregateEfficiencyData(data, { aggregationType: 'daily', baseTempC: 18.333333 });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].count, 1);
});

test('aggregateEfficiencyData computes heating degree-days when cold', () => {
    const data = [rec('2025-01-01T00:00:00Z', 8.333333, 0, 900)]; // 10°C below base
    const out = DataProcessor.aggregateEfficiencyData(data, { aggregationType: 'daily', baseTempC: 18.333333 });
    assert.ok(out[0].hdd > 0);
    assert.strictEqual(out[0].cdd, 0);
    assert.ok(Math.abs(out[0].heatingHours - 0.25) < 1e-9);
});

test('selectEfficiencyRatio: auto picks the mode that ran more', () => {
    const self = Object.assign(Object.create(proto), {
        efficiencyMode: 'auto', efficiencyAggregation: 'daily',
    });
    // cooling ran more
    const r = self.selectEfficiencyRatio({ cdd: 5, hdd: 5, coolingHours: 4, heatingHours: 1 });
    assert.strictEqual(r.mode, 'cooling');
    // heating ran more
    const r2 = self.selectEfficiencyRatio({ cdd: 5, hdd: 5, coolingHours: 1, heatingHours: 4 });
    assert.strictEqual(r2.mode, 'heating');
});

test('selectEfficiencyRatio: skips buckets below min degree-day threshold', () => {
    const self = Object.assign(Object.create(proto), {
        efficiencyMode: 'cooling', efficiencyAggregation: 'daily', // min 1
    });
    const r = self.selectEfficiencyRatio({ cdd: 0.2, hdd: 0, coolingHours: 2, heatingHours: 0 });
    assert.strictEqual(r, null);
});

test('computeEfficiencyScores: relative gives higher score to lower ratio', () => {
    const self = Object.assign(Object.create(proto), {
        efficiencyMode: 'cooling', efficiencyAggregation: 'daily',
        efficiencyNormalization: 'relative',
    });
    // Three buckets, all cooling, varying ratio (runtime/cdd): 0.2, 0.6, 1.0
    const buckets = [
        { x: new Date('2025-07-01'), cdd: 10, hdd: 0, coolingHours: 2, heatingHours: 0 },  // 0.2
        { x: new Date('2025-07-02'), cdd: 10, hdd: 0, coolingHours: 6, heatingHours: 0 },  // 0.6
        { x: new Date('2025-07-03'), cdd: 10, hdd: 0, coolingHours: 10, heatingHours: 0 }, // 1.0
    ];
    const scored = self.computeEfficiencyScores(buckets);
    assert.strictEqual(scored.length, 3);
    assert.ok(scored[0].score > scored[2].score, 'lower ratio should score higher');
    scored.forEach(s => assert.ok(s.score >= 0 && s.score <= 100));
});

test('computeEfficiencyScores: fixed baseline clamps to 0..100', () => {
    const self = Object.assign(Object.create(proto), {
        efficiencyMode: 'cooling', efficiencyAggregation: 'daily',
        efficiencyNormalization: 'fixed',
    });
    const buckets = [
        { x: new Date('2025-07-01'), cdd: 10, hdd: 0, coolingHours: 0.5, heatingHours: 0 }, // ratio 0.05 (very good)
        { x: new Date('2025-07-02'), cdd: 10, hdd: 0, coolingHours: 20, heatingHours: 0 },  // ratio 2.0 (very bad)
    ];
    const scored = self.computeEfficiencyScores(buckets);
    assert.strictEqual(scored[0].score, 100); // below bestRatio -> clamped 100
    assert.strictEqual(scored[1].score, 0);   // above worstRatio -> clamped 0
});
