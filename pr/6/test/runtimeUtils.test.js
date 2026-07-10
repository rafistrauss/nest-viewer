const test = require('node:test');
const assert = require('node:assert/strict');

const { getEffectiveModeRuntimeSeconds } = require('../runtime/runtimeUtils');

test('getEffectiveModeRuntimeSeconds supports staged cooling runtime', () => {
    const record = {
        cooling_time: 0,
        cool_stage1_time: 300,
        cool_stage2_time: 600,
        cool_stage3_time: 0
    };

    assert.equal(getEffectiveModeRuntimeSeconds(record, 'cooling'), 900);
});

test('getEffectiveModeRuntimeSeconds uses max of legacy and staged values', () => {
    const record = {
        heating_time: 900,
        heat_stage1_time: 300,
        aux_heat_time: 300
    };

    assert.equal(getEffectiveModeRuntimeSeconds(record, 'heating'), 900);
});
