// Web Worker for processing large datasets

// Timezone-aware bucketing helpers (mirrors app.js) so aggregation reflects the
// thermostat's local time from the data's `time_zone` field rather than UTC.
function getZonedParts(ms, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = {};
    for (const p of dtf.formatToParts(ms)) {
        if (p.type !== 'literal') parts[p.type] = p.value;
    }
    return {
        year: +parts.year, month: +parts.month, day: +parts.day,
        hour: +parts.hour, minute: +parts.minute, second: +parts.second
    };
}

function getZoneOffsetMs(ms, timeZone) {
    const p = getZonedParts(ms, timeZone);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUTC - ms;
}

function computeZonedBucket(ms, unit, timeZone) {
    if (unit !== 'hourly' && unit !== 'daily' && unit !== 'weekly') {
        return { key: ms, start: ms };
    }
    const p = getZonedParts(ms, timeZone);
    let wallUTC;
    if (unit === 'hourly') {
        wallUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, 0, 0);
    } else if (unit === 'daily') {
        wallUTC = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0);
    } else { // weekly, Sunday start
        const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
        wallUTC = Date.UTC(p.year, p.month - 1, p.day - dow, 0, 0, 0);
    }
    const offset = getZoneOffsetMs(ms, timeZone);
    return { key: wallUTC, start: wallUTC - offset };
}

class DataProcessor {
    static parseJSONLChunk(lines, startIndex, chunkSize) {
        const data = [];
        const endIndex = Math.min(startIndex + chunkSize, lines.length);
        let invalidJsonLines = 0;
        let missingFieldsLines = 0;
        let emptyLines = 0;
        
        for (let i = startIndex; i < endIndex; i++) {
            try {
                let line = lines[i].trim();
                if (!line) {
                    emptyLines++;
                    continue;
                }

                const fixed = line
                    .replace(/^"(.*)"$/, '$1') // Remove outer quotes
                    .replace(/""/g, '"');     // Replace double double-quotes with single

                const record = JSON.parse(fixed);
                
                // Validate required fields. outdoor_temp is optional weather
                // data (frequently null) and must not disqualify an otherwise
                // valid record, or its HVAC runtime would be silently dropped.
                if (record.interval_start && record.indoor_temp !== undefined && record.indoor_temp !== null) {
                    record.timestamp = new Date(record.interval_start);
                    data.push(record);
                } else {
                    missingFieldsLines++;
                }
            } catch (error) {
                // Track invalid JSON lines
                invalidJsonLines++;
                console.warn(`Error parsing line ${i + 1}:`, error);
            }
        }
        
        return {
            data,
            stats: {
                invalidJsonLines,
                missingFieldsLines,
                emptyLines
            }
        };
    }

    static aggregateRuntimeData(data, aggregationType, timeZone) {
        if (aggregationType === '15min') {
            return data.map(d => ({
                x: d.x,
                coolingTime: d.coolingTime,
                heatingTime: d.heatingTime
            }));
        }

        const aggregated = new Map();
        
        data.forEach(d => {
            const ms = d.x instanceof Date ? d.x.getTime() : new Date(d.x).getTime();
            const { key, start } = computeZonedBucket(ms, aggregationType, timeZone);
            
            if (!aggregated.has(key)) {
                aggregated.set(key, {
                    x: new Date(start),
                    coolingTime: 0,
                    heatingTime: 0,
                    count: 0
                });
            }
            
            const entry = aggregated.get(key);
            entry.coolingTime += d.coolingTime;
            entry.heatingTime += d.heatingTime;
            entry.count++;
        });
        
        return Array.from(aggregated.values()).sort((a, b) => a.x - b.x);
    }

    static aggregateTemperatureData(data, aggregationType, timeZone) {
        if (aggregationType === '15min') {
            return data.map(d => ({
                x: d.x,
                outdoorTemp: d.outdoorTemp,
                coolingTime: d.coolingTime,
                heatingTime: d.heatingTime
            }));
        }

        const aggregated = new Map();
        
        data.forEach(d => {
            const ms = d.x instanceof Date ? d.x.getTime() : new Date(d.x).getTime();
            const { key, start } = computeZonedBucket(ms, aggregationType, timeZone);
            
            if (!aggregated.has(key)) {
                aggregated.set(key, {
                    x: new Date(start),
                    outdoorTemp: 0,
                    outdoorTempCount: 0,
                    coolingTime: 0,
                    heatingTime: 0,
                    count: 0
                });
            }
            
            const entry = aggregated.get(key);
            // Only average valid outdoor temperatures; null/NaN samples (missing
            // weather data) must not poison the average.
            if (d.outdoorTemp != null && Number.isFinite(d.outdoorTemp)) {
                entry.outdoorTemp += d.outdoorTemp;
                entry.outdoorTempCount++;
            }
            entry.coolingTime += d.coolingTime;
            entry.heatingTime += d.heatingTime;
            entry.count++;
        });
        
        return Array.from(aggregated.values()).map(entry => ({
            x: entry.x,
            outdoorTemp: entry.outdoorTempCount > 0 ? entry.outdoorTemp / entry.outdoorTempCount : null,
            coolingTime: entry.coolingTime,
            heatingTime: entry.heatingTime
        })).sort((a, b) => a.x - b.x);
    }

    static convertTemperature(tempC, targetUnit) {
        // Preserve null/missing values so charts render a gap instead of a
        // bogus 32°F point (null * 9/5 + 32 === 32).
        if (tempC == null || tempC === '' || !Number.isFinite(Number(tempC))) return null;
        if (targetUnit === 'F') {
            return Number(tempC) * 9/5 + 32;
        }
        return Number(tempC); // Already in Celsius
    }

    static prepareTimeSeriesData(data, temperatureUnit) {
        return data.map(d => ({
            x: d.timestamp,
            indoorTemp: this.convertTemperature(d.indoor_temp, temperatureUnit),
            outdoorTemp: this.convertTemperature(d.outdoor_temp, temperatureUnit),
            coolingTarget: this.convertTemperature(d.cooling_target, temperatureUnit),
            heatingTarget: this.convertTemperature(d.heating_target, temperatureUnit),
            indoorHumidity: d.indoor_humidity,
            outdoorHumidity: d.outdoor_humidity,
            coolingTime: d.cooling_time / 60, // Convert to minutes
            heatingTime: d.heating_time / 60  // Convert to minutes
        }));
    }
}

// Web Worker message handler
self.onmessage = function(e) {
    const { type, data, options } = e.data;
    
    try {
        switch (type) {
            case 'parseJSONL':
                const { text, chunkSize = 1000 } = data;
                const lines = text.trim().split('\n');
                const totalLines = lines.length;
                let allData = [];
                let totalInvalidJsonLines = 0;
                let totalMissingFieldsLines = 0;
                let totalEmptyLines = 0;
                
                // Process in chunks to avoid blocking
                for (let i = 0; i < totalLines; i += chunkSize) {
                    const result = DataProcessor.parseJSONLChunk(lines, i, chunkSize);
                    allData = allData.concat(result.data);
                    totalInvalidJsonLines += result.stats.invalidJsonLines;
                    totalMissingFieldsLines += result.stats.missingFieldsLines;
                    totalEmptyLines += result.stats.emptyLines;
                    
                    // Report progress
                    const progress = Math.min(100, Math.round(((i + chunkSize) / totalLines) * 100));
                    self.postMessage({
                        type: 'progress',
                        progress: progress,
                        processed: i + chunkSize,
                        total: totalLines
                    });
                }
                
                // Check if we got any valid data
                if (allData.length === 0) {
                    const errorParts = [];
                    if (totalInvalidJsonLines > 0) {
                        errorParts.push(`${totalInvalidJsonLines} line(s) with invalid JSON`);
                    }
                    if (totalMissingFieldsLines > 0) {
                        errorParts.push(`${totalMissingFieldsLines} line(s) missing required fields`);
                    }
                    if (totalEmptyLines > 0 && totalInvalidJsonLines === 0 && totalMissingFieldsLines === 0) {
                        self.postMessage({
                            type: 'error',
                            error: 'The file is empty or contains only blank lines. Please check that you selected the correct file.'
                        });
                        break;
                    }
                    
                    const errorMsg = errorParts.length > 0 
                        ? `No valid HVAC runtime records found. Issues: ${errorParts.join(', ')}. The file should contain lines with fields: interval_start, indoor_temp, outdoor_temp, and other HVAC runtime data from Google Nest.`
                        : 'No valid data found in file. Make sure you uploaded a Nest HVAC runtime data file from Google Takeout.';
                    
                    self.postMessage({
                        type: 'error',
                        error: errorMsg
                    });
                    break;
                }
                
                // Sort by timestamp
                allData.sort((a, b) => a.timestamp - b.timestamp);
                
                self.postMessage({
                    type: 'parseComplete',
                    data: allData,
                    stats: {
                        invalidJsonLines: totalInvalidJsonLines,
                        missingFieldsLines: totalMissingFieldsLines,
                        emptyLines: totalEmptyLines
                    }
                });
                break;
                
            case 'prepareChartData':
                const { rawData, temperatureUnit } = data;
                const timeSeriesData = DataProcessor.prepareTimeSeriesData(rawData, temperatureUnit);
                
                self.postMessage({
                    type: 'chartDataReady',
                    data: timeSeriesData
                });
                break;
                
            case 'aggregateRuntime':
                const { runtimeData, aggregationType, timeZone: runtimeTz } = data;
                const aggregatedData = DataProcessor.aggregateRuntimeData(runtimeData, aggregationType, runtimeTz);
                
                self.postMessage({
                    type: 'runtimeAggregated',
                    data: aggregatedData,
                    aggregationType: aggregationType
                });
                break;
                
            case 'aggregateTemperature':
                const { temperatureData, aggregationType: tempAggType, timeZone: tempTz } = data;
                const tempAggregatedData = DataProcessor.aggregateTemperatureData(temperatureData, tempAggType, tempTz);
                
                self.postMessage({
                    type: 'temperatureAggregated',
                    data: tempAggregatedData,
                    aggregationType: tempAggType
                });
                break;
                
            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message
        });
    }
};
