// Web Worker for processing large datasets
class DataProcessor {
    static parseJSONLChunk(lines, startIndex, chunkSize) {
        const data = [];
        const endIndex = Math.min(startIndex + chunkSize, lines.length);
        
        for (let i = startIndex; i < endIndex; i++) {
            try {
                let line = lines[i].trim();
                if (!line) continue;

                const fixed = line
                    .replace(/^"(.*)"$/, '$1') // Remove outer quotes
                    .replace(/""/g, '"');     // Replace double double-quotes with single

                const record = JSON.parse(fixed);
                
                // Validate required fields
                if (record.interval_start && record.indoor_temp !== undefined && record.outdoor_temp !== undefined && record.outdoor_temp !== null) {
                    record.timestamp = new Date(record.interval_start);
                    data.push(record);
                }
            } catch (error) {
                // Skip invalid lines
                console.warn(`Error parsing line ${i + 1}:`, error);
            }
        }
        
        return data;
    }

    static aggregateRuntimeData(data, aggregationType) {
        if (aggregationType === '15min') {
            return data.map(d => ({
                x: d.x,
                coolingTime: d.coolingTime,
                heatingTime: d.heatingTime
            }));
        }

        const aggregated = new Map();
        
        data.forEach(d => {
            let key;
            const date = new Date(d.x);
            
            switch (aggregationType) {
                case 'hourly':
                    date.setMinutes(0, 0, 0);
                    key = date.getTime();
                    break;
                case 'daily':
                    date.setHours(0, 0, 0, 0);
                    key = date.getTime();
                    break;
                case 'weekly':
                    const dayOfWeek = date.getDay();
                    date.setDate(date.getDate() - dayOfWeek);
                    date.setHours(0, 0, 0, 0);
                    key = date.getTime();
                    break;
                default:
                    key = d.x.getTime();
            }
            
            if (!aggregated.has(key)) {
                aggregated.set(key, {
                    x: new Date(key),
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

    static aggregateTemperatureData(data, aggregationType) {
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
            let key;
            const date = new Date(d.x);
            
            switch (aggregationType) {
                case 'hourly':
                    date.setMinutes(0, 0, 0);
                    key = date.getTime();
                    break;
                case 'daily':
                    date.setHours(0, 0, 0, 0);
                    key = date.getTime();
                    break;
                case 'weekly':
                    const dayOfWeek = date.getDay();
                    date.setDate(date.getDate() - dayOfWeek);
                    date.setHours(0, 0, 0, 0);
                    key = date.getTime();
                    break;
                default:
                    key = d.x.getTime();
            }
            
            if (!aggregated.has(key)) {
                aggregated.set(key, {
                    x: new Date(key),
                    outdoorTemp: 0,
                    coolingTime: 0,
                    heatingTime: 0,
                    count: 0
                });
            }
            
            const entry = aggregated.get(key);
            entry.outdoorTemp += d.outdoorTemp;
            entry.coolingTime += d.coolingTime;
            entry.heatingTime += d.heatingTime;
            entry.count++;
        });
        
        return Array.from(aggregated.values()).map(entry => ({
            x: entry.x,
            outdoorTemp: entry.outdoorTemp / entry.count,
            coolingTime: entry.coolingTime,
            heatingTime: entry.heatingTime
        })).sort((a, b) => a.x - b.x);
    }

    static convertTemperature(tempC, targetUnit) {
        if (targetUnit === 'F') {
            return tempC * 9/5 + 32;
        }
        return tempC; // Already in Celsius
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
                
                // Process in chunks to avoid blocking
                for (let i = 0; i < totalLines; i += chunkSize) {
                    const chunkData = DataProcessor.parseJSONLChunk(lines, i, chunkSize);
                    allData = allData.concat(chunkData);
                    
                    // Report progress
                    const progress = Math.min(100, Math.round(((i + chunkSize) / totalLines) * 100));
                    self.postMessage({
                        type: 'progress',
                        progress: progress,
                        processed: i + chunkSize,
                        total: totalLines
                    });
                }
                
                // Sort by timestamp
                allData.sort((a, b) => a.timestamp - b.timestamp);
                
                self.postMessage({
                    type: 'parseComplete',
                    data: allData
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
                const { runtimeData, aggregationType } = data;
                const aggregatedData = DataProcessor.aggregateRuntimeData(runtimeData, aggregationType);
                
                self.postMessage({
                    type: 'runtimeAggregated',
                    data: aggregatedData,
                    aggregationType: aggregationType
                });
                break;
                
            case 'aggregateTemperature':
                const { temperatureData, aggregationType: tempAggType } = data;
                const tempAggregatedData = DataProcessor.aggregateTemperatureData(temperatureData, tempAggType);
                
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
