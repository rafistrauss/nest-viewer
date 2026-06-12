(function (globalScope) {
    /**
     * @typedef {Object} HvacRecord
     * @property {Date|string} timestamp
     * @property {number|null|undefined} indoor_temp
     * @property {number|null|undefined} cooling_time
     * @property {number|null|undefined} heating_time
     */

    function average(values) {
        if (!values.length) return null;
        return values.reduce((sum, value) => sum + value, 0) / values.length;
    }

    function round(value) {
        return value == null ? null : Math.round(value * 100) / 100;
    }

    function getCycleDurations(records, mode) {
        const durations = [];
        let currentSeconds = 0;

        records.forEach(record => {
            const seconds = Number(record[`${mode}_time`] || 0);
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

    function getPerHourTemperatureRates(records, mode) {
        const rates = [];

        for (let index = 1; index < records.length; index += 1) {
            const previous = records[index - 1];
            const current = records[index];
            const previousIndoor = Number(previous.indoor_temp);
            const currentIndoor = Number(current.indoor_temp);

            if (!Number.isFinite(previousIndoor) || !Number.isFinite(currentIndoor)) {
                continue;
            }

            const previousTime = new Date(previous.timestamp).getTime();
            const currentTime = new Date(current.timestamp).getTime();
            const hours = (currentTime - previousTime) / 3600000;

            if (!Number.isFinite(hours) || hours <= 0) {
                continue;
            }

            const seconds = Number(current[`${mode}_time`] || 0);
            if (seconds <= 0) {
                continue;
            }

            if (mode === 'cooling' && previousIndoor > currentIndoor) {
                rates.push((previousIndoor - currentIndoor) / hours);
            }

            if (mode === 'heating' && currentIndoor > previousIndoor) {
                rates.push((currentIndoor - previousIndoor) / hours);
            }
        }

        return rates;
    }

    /**
     * @param {HvacRecord[]} records
     * @param {number} [analysisPeriodDays=30]
     */
    function summarizeHVACData(records, analysisPeriodDays = 30) {
        if (!Array.isArray(records) || records.length === 0) {
            return {
                analysisPeriodDays,
                avgCoolingCycleMinutes: null,
                avgHeatingCycleMinutes: null,
                coolingCyclesPerDay: null,
                heatingCyclesPerDay: null,
                maxIndoorTemp: null,
                minIndoorTemp: null,
                avgTempDropPerHour: null,
                avgTempRisePerHour: null,
                dataPoints: 0
            };
        }

        const sortedRecords = [...records].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
        const windowEnd = new Date(sortedRecords[sortedRecords.length - 1].timestamp);
        const windowStart = new Date(windowEnd.getTime() - (analysisPeriodDays * 24 * 60 * 60 * 1000));
        const windowedRecords = sortedRecords.filter(record => new Date(record.timestamp) >= windowStart);

        const coolingCycles = getCycleDurations(windowedRecords, 'cooling');
        const heatingCycles = getCycleDurations(windowedRecords, 'heating');

        const indoorTemps = windowedRecords
            .map(record => Number(record.indoor_temp))
            .filter(temp => Number.isFinite(temp));

        const periodDays = Math.max(1, (windowEnd.getTime() - windowStart.getTime()) / 86400000);

        return {
            analysisPeriodDays,
            avgCoolingCycleMinutes: round(average(coolingCycles)),
            avgHeatingCycleMinutes: round(average(heatingCycles)),
            coolingCyclesPerDay: round(coolingCycles.length / periodDays),
            heatingCyclesPerDay: round(heatingCycles.length / periodDays),
            maxIndoorTemp: indoorTemps.length ? round(Math.max(...indoorTemps)) : null,
            minIndoorTemp: indoorTemps.length ? round(Math.min(...indoorTemps)) : null,
            avgTempDropPerHour: round(average(getPerHourTemperatureRates(windowedRecords, 'cooling'))),
            avgTempRisePerHour: round(average(getPerHourTemperatureRates(windowedRecords, 'heating'))),
            dataPoints: windowedRecords.length
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
