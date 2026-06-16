(function (globalScope) {
    /**
     * @typedef {Object} HvacRecord
     * @property {Date|string} timestamp
     * @property {number|null|undefined} indoor_temp
     * @property {number|null|undefined} outdoor_temp
     * @property {number|null|undefined} indoor_humidity
     * @property {number|null|undefined} outdoor_humidity
     * @property {number|null|undefined} cooling_time
     * @property {number|null|undefined} heating_time
     * @property {number|null|undefined} cooling_target
     * @property {number|null|undefined} heating_target
     */

    const DEFAULT_GAP_TOLERANCE_MINUTES = 35;

    function toFiniteNumbers(values) {
        return values.map(Number).filter(value => Number.isFinite(value));
    }

    function average(values) {
        if (!values.length) return null;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function round(value) {
        return value == null ? null : Math.round(value * 100) / 100;
    }

    function minutesBetween(previous, current) {
        const previousTime = new Date(previous.timestamp).getTime();
        const currentTime = new Date(current.timestamp).getTime();
        return (currentTime - previousTime) / 60000;
    }

    /**
     * Builds a list of contiguous run cycles (in minutes) for the given mode.
     * A cycle ends when an idle interval is seen OR when there is a data gap
     * larger than gapToleranceMinutes (so missing data does not merge cycles).
     */
    function getCycleDurations(records, mode, gapToleranceMinutes) {
        const durations = [];
        let currentSeconds = 0;

        records.forEach((record, index) => {
            const seconds = Number(record[`${mode}_time`] || 0);
            const gapMinutes = index > 0 ? minutesBetween(records[index - 1], record) : 0;

            if (currentSeconds > 0 && gapMinutes > gapToleranceMinutes) {
                durations.push(currentSeconds / 60);
                currentSeconds = 0;
            }

            if (seconds > 0) {
                currentSeconds += seconds;
            } else if (currentSeconds > 0) {
                durations.push(currentSeconds / 60);
                currentSeconds = 0;
            }
        });

        if (currentSeconds > 0) {
            durations.push(currentSeconds / 60);
        }

        return durations;
    }

    /**
     * Per-hour indoor temperature change while a mode is actively running.
     * Returns signed rates plus a count of intervals where the temperature
     * moved the "wrong" way (e.g. cooling ran but the room got warmer), which
     * is a key signal of a struggling system.
     */
    function getActiveTemperatureRates(records, mode, gapToleranceMinutes) {
        const signedRates = [];
        let counterproductiveIntervals = 0;

        for (let index = 1; index < records.length; index += 1) {
            const previous = records[index - 1];
            const current = records[index];
            const previousIndoor = Number(previous.indoor_temp);
            const currentIndoor = Number(current.indoor_temp);

            if (!Number.isFinite(previousIndoor) || !Number.isFinite(currentIndoor)) {
                continue;
            }

            const minutes = minutesBetween(previous, current);
            const hours = minutes / 60;

            if (!Number.isFinite(hours) || hours <= 0 || minutes > gapToleranceMinutes) {
                continue;
            }

            const seconds = Number(current[`${mode}_time`] || 0);
            if (seconds <= 0) {
                continue;
            }

            const ratePerHour = (currentIndoor - previousIndoor) / hours;
            signedRates.push(ratePerHour);

            if (mode === 'cooling' && currentIndoor > previousIndoor) {
                counterproductiveIntervals += 1;
            }
            if (mode === 'heating' && currentIndoor < previousIndoor) {
                counterproductiveIntervals += 1;
            }
        }

        return { signedRates, counterproductiveIntervals };
    }

    function setpointStats(records, mode) {
        const deviations = [];
        const targets = [];

        records.forEach(record => {
            const seconds = Number(record[`${mode}_time`] || 0);
            const target = Number(record[`${mode}_target`]);
            const indoor = Number(record.indoor_temp);
            if (seconds > 0 && Number.isFinite(target)) {
                targets.push(target);
                if (Number.isFinite(indoor)) {
                    deviations.push(indoor - target);
                }
            }
        });

        return {
            avgTarget: round(average(targets)),
            avgIndoorMinusTarget: round(average(deviations))
        };
    }

    function weekStartKey(timestamp) {
        const date = new Date(timestamp);
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() - date.getUTCDay());
        return date.toISOString().slice(0, 10);
    }

    function dayStartKey(timestamp) {
        const date = new Date(timestamp);
        date.setUTCHours(0, 0, 0, 0);
        return date.toISOString().slice(0, 10);
    }

    /**
     * Compact per-bucket metrics so the model can see how behaviour changes
     * over time (e.g. an early-period problem that was later resolved) instead
     * of only window-wide averages that wash out trends.
     */
    function bucketMetrics(records, gapToleranceMinutes) {
        const coolingCycles = getCycleDurations(records, 'cooling', gapToleranceMinutes);
        const heatingCycles = getCycleDurations(records, 'heating', gapToleranceMinutes);
        const cooling = getActiveTemperatureRates(records, 'cooling', gapToleranceMinutes);
        const coolingDrops = cooling.signedRates.filter(rate => rate < 0).map(rate => -rate);
        const outdoor = toFiniteNumbers(records.map(record => record.outdoor_temp));
        const indoor = toFiniteNumbers(records.map(record => record.indoor_temp));
        const coolingSeconds = records.reduce((sum, record) => sum + Number(record.cooling_time || 0), 0);
        const heatingSeconds = records.reduce((sum, record) => sum + Number(record.heating_time || 0), 0);
        const coolingSetpoint = setpointStats(records, 'cooling');

        return {
            coolingRuntimeHours: round(coolingSeconds / 3600),
            heatingRuntimeHours: round(heatingSeconds / 3600),
            coolingCycleCount: coolingCycles.length,
            heatingCycleCount: heatingCycles.length,
            avgCoolingCycleMinutes: round(average(coolingCycles)),
            maxCoolingCycleMinutes: coolingCycles.length ? round(Math.max(...coolingCycles)) : null,
            avgTempDropPerHour: round(average(coolingDrops)),
            coolingIntervalsTempRose: cooling.counterproductiveIntervals,
            avgOutdoorTemp: round(average(outdoor)),
            avgIndoorTemp: round(average(indoor)),
            avgIndoorMinusCoolingTarget: coolingSetpoint.avgIndoorMinusTarget
        };
    }

    /**
     * Choose how finely to bucket the breakdown. For short spans, weekly
     * bucketing collapses everything into one or two buckets and hides
     * day-to-day trends, so fall back to daily granularity. For longer
     * spans, daily would produce too many buckets, so use weekly.
     */
    function chooseBreakdownGranularity(spanDays) {
        return spanDays <= 16 ? 'daily' : 'weekly';
    }

    function buildBreakdown(records, gapToleranceMinutes, granularity) {
        const keyFor = granularity === 'daily' ? dayStartKey : weekStartKey;
        const periodKey = granularity === 'daily' ? 'dayStart' : 'weekStart';
        const buckets = new Map();
        records.forEach(record => {
            const key = keyFor(record.timestamp);
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(record);
        });

        return Array.from(buckets.keys())
            .sort()
            .map(periodStart => ({
                [periodKey]: periodStart,
                dataPoints: buckets.get(periodStart).length,
                ...bucketMetrics(buckets.get(periodStart), gapToleranceMinutes)
            }));
    }

    function emptySummary(analysisPeriodDays, temperatureUnit) {
        return {
            analysisPeriodDays,
            temperatureUnit,
            dataStart: null,
            dataEnd: null,
            avgCoolingCycleMinutes: null,
            avgHeatingCycleMinutes: null,
            maxCoolingCycleMinutes: null,
            maxHeatingCycleMinutes: null,
            coolingCycleCount: 0,
            heatingCycleCount: 0,
            coolingCyclesPerDay: null,
            heatingCyclesPerDay: null,
            maxIndoorTemp: null,
            minIndoorTemp: null,
            avgIndoorTemp: null,
            maxOutdoorTemp: null,
            minOutdoorTemp: null,
            avgOutdoorTemp: null,
            avgIndoorHumidity: null,
            avgOutdoorHumidity: null,
            avgCoolingTarget: null,
            avgHeatingTarget: null,
            avgIndoorMinusCoolingTarget: null,
            avgIndoorMinusHeatingTarget: null,
            avgTempDropPerHour: null,
            avgTempRisePerHour: null,
            coolingIntervalsTempRose: 0,
            heatingIntervalsTempFell: 0,
            actualDataSpanDays: 0,
            dataPoints: 0,
            breakdownGranularity: 'weekly',
            periodBreakdown: [],
            weeklyBreakdown: []
        };
    }

    /**
     * @param {HvacRecord[]} records
     * @param {number} [analysisPeriodDays=30]
     * @param {Object} [options]
     * @param {number} [options.gapToleranceMinutes]
     */
    function summarizeHVACData(records, analysisPeriodDays = 30, options = {}) {
        const temperatureUnit = options.temperatureUnit || 'source-native (unconverted)';
        if (!Array.isArray(records) || records.length === 0) {
            return emptySummary(analysisPeriodDays, temperatureUnit);
        }

        const gapToleranceMinutes = Number.isFinite(options.gapToleranceMinutes)
            ? options.gapToleranceMinutes
            : DEFAULT_GAP_TOLERANCE_MINUTES;

        const sortedRecords = [...records].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
        const windowEnd = new Date(sortedRecords[sortedRecords.length - 1].timestamp);
        const windowStart = new Date(windowEnd.getTime() - (analysisPeriodDays * 24 * 60 * 60 * 1000));
        const windowedRecords = sortedRecords.filter(record => new Date(record.timestamp) >= windowStart);

        const coolingCycles = getCycleDurations(windowedRecords, 'cooling', gapToleranceMinutes);
        const heatingCycles = getCycleDurations(windowedRecords, 'heating', gapToleranceMinutes);

        const indoorTemps = toFiniteNumbers(windowedRecords.map(record => record.indoor_temp));
        const outdoorTemps = toFiniteNumbers(windowedRecords.map(record => record.outdoor_temp));
        const indoorHumidity = toFiniteNumbers(windowedRecords.map(record => record.indoor_humidity));
        const outdoorHumidity = toFiniteNumbers(windowedRecords.map(record => record.outdoor_humidity));

        // Normalize cycles/day by the actual span of available data, not the
        // nominal analysis window, so short datasets are not under-reported.
        const firstTime = new Date(windowedRecords[0].timestamp).getTime();
        const lastTime = new Date(windowedRecords[windowedRecords.length - 1].timestamp).getTime();
        const actualSpanDays = Math.max(1 / 24, (lastTime - firstTime) / 86400000);

        const cooling = getActiveTemperatureRates(windowedRecords, 'cooling', gapToleranceMinutes);
        const heating = getActiveTemperatureRates(windowedRecords, 'heating', gapToleranceMinutes);

        const coolingDrops = cooling.signedRates.filter(rate => rate < 0).map(rate => -rate);
        const heatingRises = heating.signedRates.filter(rate => rate > 0);

        const coolingSetpoint = setpointStats(windowedRecords, 'cooling');
        const heatingSetpoint = setpointStats(windowedRecords, 'heating');

        const breakdownGranularity = chooseBreakdownGranularity(actualSpanDays);
        const periodBreakdown = buildBreakdown(windowedRecords, gapToleranceMinutes, breakdownGranularity);

        return {
            analysisPeriodDays,
            temperatureUnit,
            dataStart: new Date(firstTime).toISOString(),
            dataEnd: new Date(lastTime).toISOString(),
            avgCoolingCycleMinutes: round(average(coolingCycles)),
            avgHeatingCycleMinutes: round(average(heatingCycles)),
            maxCoolingCycleMinutes: coolingCycles.length ? round(Math.max(...coolingCycles)) : null,
            maxHeatingCycleMinutes: heatingCycles.length ? round(Math.max(...heatingCycles)) : null,
            coolingCycleCount: coolingCycles.length,
            heatingCycleCount: heatingCycles.length,
            coolingCyclesPerDay: round(coolingCycles.length / actualSpanDays),
            heatingCyclesPerDay: round(heatingCycles.length / actualSpanDays),
            maxIndoorTemp: indoorTemps.length ? round(Math.max(...indoorTemps)) : null,
            minIndoorTemp: indoorTemps.length ? round(Math.min(...indoorTemps)) : null,
            avgIndoorTemp: round(average(indoorTemps)),
            maxOutdoorTemp: outdoorTemps.length ? round(Math.max(...outdoorTemps)) : null,
            minOutdoorTemp: outdoorTemps.length ? round(Math.min(...outdoorTemps)) : null,
            avgOutdoorTemp: round(average(outdoorTemps)),
            avgIndoorHumidity: round(average(indoorHumidity)),
            avgOutdoorHumidity: round(average(outdoorHumidity)),
            avgCoolingTarget: coolingSetpoint.avgTarget,
            avgHeatingTarget: heatingSetpoint.avgTarget,
            avgIndoorMinusCoolingTarget: coolingSetpoint.avgIndoorMinusTarget,
            avgIndoorMinusHeatingTarget: heatingSetpoint.avgIndoorMinusTarget,
            avgTempDropPerHour: round(average(coolingDrops)),
            avgTempRisePerHour: round(average(heatingRises)),
            coolingIntervalsTempRose: cooling.counterproductiveIntervals,
            heatingIntervalsTempFell: heating.counterproductiveIntervals,
            actualDataSpanDays: round(actualSpanDays),
            dataPoints: windowedRecords.length,
            breakdownGranularity,
            periodBreakdown,
            // Retained for backward compatibility; equals periodBreakdown when
            // granularity is weekly, otherwise empty.
            weeklyBreakdown: breakdownGranularity === 'weekly' ? periodBreakdown : []
        };
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.summarizeHVACData = summarizeHVACData;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            summarizeHVACData
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
