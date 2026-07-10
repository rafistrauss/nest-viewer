(function (globalScope) {
    const MODE_FIELDS = {
        cooling: {
            legacy: ['cooling_time'],
            staged: ['cool_stage1_time', 'cool_stage2_time', 'cool_stage3_time']
        },
        heating: {
            legacy: ['heating_time'],
            staged: [
                'heat_stage1_time',
                'heat_stage2_time',
                'heat_stage3_time',
                'aux_heat_time',
                'alt_heat1_time',
                'alt_heat2_time',
                'emergency_heat_time'
            ]
        }
    };

    function toNonNegativeNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) return 0;
        return number;
    }

    function sumFields(record, fields) {
        if (!record || !Array.isArray(fields) || fields.length === 0) return 0;
        return fields.reduce((sum, field) => sum + toNonNegativeNumber(record[field]), 0);
    }

    function getLegacyModeRuntimeSeconds(record, mode) {
        const config = MODE_FIELDS[mode];
        if (!config) return 0;
        return sumFields(record, config.legacy);
    }

    function getStagedModeRuntimeSeconds(record, mode) {
        const config = MODE_FIELDS[mode];
        if (!config) return 0;
        return sumFields(record, config.staged);
    }

    function getIntervalDurationSeconds(record) {
        const start = record?.interval_start ? new Date(record.interval_start).getTime() : NaN;
        const end = record?.interval_end ? new Date(record.interval_end).getTime() : NaN;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            return null;
        }
        return (end - start) / 1000;
    }

    function getEffectiveModeRuntimeSeconds(record, mode) {
        const legacySeconds = getLegacyModeRuntimeSeconds(record, mode);
        const stagedSeconds = getStagedModeRuntimeSeconds(record, mode);
        const effectiveSeconds = Math.max(legacySeconds, stagedSeconds);
        const intervalDurationSeconds = getIntervalDurationSeconds(record);
        if (intervalDurationSeconds == null) {
            return effectiveSeconds;
        }
        return Math.min(effectiveSeconds, intervalDurationSeconds);
    }

    const api = {
        getLegacyModeRuntimeSeconds,
        getStagedModeRuntimeSeconds,
        getEffectiveModeRuntimeSeconds
    };

    globalScope.NestRuntimeUtils = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
