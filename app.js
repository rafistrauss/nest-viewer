class NestDataViewer {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.charts = {};
        this.temperatureUnit = 'F'; // Default to Fahrenheit
        this.runtimeAggregation = '15min'; // Default aggregation
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (event) => {
            this.handleFileUpload(event.target.files[0]);
        });

        // Temperature unit toggle listeners
        const tempUnitInputs = document.querySelectorAll('input[name="tempUnit"]');
        tempUnitInputs.forEach(input => {
            input.addEventListener('change', (event) => {
                this.temperatureUnit = event.target.value;
                this.updateTemperatureUnits();
                if (this.data.length > 0) {
                    this.updateStats();
                    this.createCharts();
                }
            });
        });

        // Date filter listeners
        document.getElementById('applyFilter').addEventListener('click', () => {
            this.applyDateFilter();
        });

        document.getElementById('resetFilter').addEventListener('click', () => {
            this.resetDateFilter();
        });

        // Quick filter listeners
        document.querySelectorAll('.quick-filter').forEach(button => {
            button.addEventListener('click', (event) => {
                const days = parseInt(event.target.getAttribute('data-days'));
                this.applyQuickFilter(days);
            });
        });

        // Runtime aggregation listeners
        const runtimeAggInputs = document.querySelectorAll('input[name="runtimeAggregation"]');
        runtimeAggInputs.forEach(input => {
            input.addEventListener('change', (event) => {
                this.runtimeAggregation = event.target.value;
                if (this.data.length > 0) {
                    this.createCharts();
                }
            });
        });
    }

    async handleFileUpload(file) {
        if (!file) return;

        this.showLoading(true);
        this.hideError();

        try {
            const text = await this.readFile(file);
            this.data = this.parseJSONL(text);
            
            if (this.data.length === 0) {
                throw new Error('No valid data found in the file');
            }

            this.filteredData = [...this.data]; // Initialize filtered data with all data
            this.setupDateFilter();
            this.updateStats();
            this.createCharts();
            this.showSections();
            
        } catch (error) {
            this.showError(`Error processing file: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    parseJSONL(text) {
        const lines = text.trim().split('\n');
        const data = [];

        for (let i = 0; i < lines.length; i++) {
            try {
                let line = lines[i].trim();
                if (!line) continue;

                const fixed = line
                .replace(/^"(.*)"$/, '$1') // Remove outer quotes
                .replace(/""/g, '"');     // Replace double double-quotes with single

                
                const record = JSON.parse(fixed);
                
                // Validate required fields
                if (record.interval_start && record.indoor_temp !== undefined) {
                    record.timestamp = new Date(record.interval_start);
                    data.push(record);
                }
            } catch (error) {
                console.warn(`Error parsing line ${i + 1}:`, error);
            }
        }

        // Sort by timestamp
        data.sort((a, b) => a.timestamp - b.timestamp);
        return data;
    }

    updateStats() {
        const dataToUse = this.filteredData.length > 0 ? this.filteredData : this.data;
        const totalRecords = dataToUse.length;
        const indoorTemps = dataToUse.map(d => d.indoor_temp).filter(t => t != null);
        const outdoorTemps = dataToUse.map(d => d.outdoor_temp).filter(t => t != null);
        
        const avgIndoorTemp = indoorTemps.reduce((a, b) => a + b, 0) / indoorTemps.length;
        const avgOutdoorTemp = outdoorTemps.reduce((a, b) => a + b, 0) / outdoorTemps.length;
        
        // Convert temperatures for display
        const displayIndoorTemp = this.getTemperatureForDisplay(avgIndoorTemp);
        const displayOutdoorTemp = this.getTemperatureForDisplay(avgOutdoorTemp);
        
        const firstDate = dataToUse[0]?.timestamp;
        const lastDate = dataToUse[dataToUse.length - 1]?.timestamp;
        
        document.getElementById('totalRecords').textContent = totalRecords.toLocaleString();
        document.getElementById('avgIndoorTemp').textContent = displayIndoorTemp.toFixed(1);
        document.getElementById('avgOutdoorTemp').textContent = displayOutdoorTemp.toFixed(1);
        
        if (firstDate && lastDate) {
            const dateRange = `${firstDate.toLocaleDateString()} - ${lastDate.toLocaleDateString()}`;
            document.getElementById('dateRange').textContent = dateRange;
        }
        
        // Update temperature unit labels
        this.updateTemperatureUnits();
    }

    createCharts() {
        this.destroyExistingCharts();
        
        // Use filtered data for charts
        const dataToUse = this.filteredData.length > 0 ? this.filteredData : this.data;
        
        // Prepare data - create datasets with x,y pairs for time series
        const timeSeriesData = dataToUse.map(d => ({
            x: d.timestamp,
            indoorTemp: this.getTemperatureForDisplay(d.indoor_temp),
            outdoorTemp: this.getTemperatureForDisplay(d.outdoor_temp),
            coolingTarget: this.getTemperatureForDisplay(d.cooling_target),
            heatingTarget: this.getTemperatureForDisplay(d.heating_target),
            indoorHumidity: d.indoor_humidity,
            outdoorHumidity: d.outdoor_humidity,
            coolingTime: d.cooling_time / 60, // Convert to minutes
            heatingTime: d.heating_time / 60  // Convert to minutes
        }));

        // Temperature Chart
        this.charts.temperature = new Chart(document.getElementById('temperatureChart'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Indoor Temperature',
                        data: timeSeriesData.map(d => ({ x: d.x, y: d.indoorTemp })),
                        borderColor: '#ff6b6b',
                        backgroundColor: 'rgba(255, 107, 107, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'Outdoor Temperature',
                        data: timeSeriesData.map(d => ({ x: d.x, y: d.outdoorTemp })),
                        borderColor: '#4ecdc4',
                        backgroundColor: 'rgba(78, 205, 196, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: this.getCommonChartOptions(`Temperature (${this.temperatureUnit === 'F' ? '°F' : '°C'})`)
        });

        // Target vs Actual Chart
        this.charts.target = new Chart(document.getElementById('targetChart'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Indoor Temperature',
                        data: timeSeriesData.map(d => ({ x: d.x, y: d.indoorTemp })),
                        borderColor: '#ff6b6b',
                        backgroundColor: 'rgba(255, 107, 107, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'Cooling Target',
                        data: timeSeriesData.map(d => ({ x: d.x, y: d.coolingTarget })),
                        borderColor: '#45b7d1',
                        backgroundColor: 'rgba(69, 183, 209, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'Heating Target',
                        data: timeSeriesData.map(d => ({ x: d.x, y: d.heatingTarget })),
                        borderColor: '#f39c12',
                        backgroundColor: 'rgba(243, 156, 18, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: this.getCommonChartOptions(`Temperature (${this.temperatureUnit === 'F' ? '°F' : '°C'})`)
        });

        // Humidity Chart
        this.charts.humidity = new Chart(document.getElementById('humidityChart'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Indoor Humidity',
                        data: timeSeriesData.map(d => ({ x: d.x, y: d.indoorHumidity })),
                        borderColor: '#9b59b6',
                        backgroundColor: 'rgba(155, 89, 182, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: 'Outdoor Humidity',
                        data: timeSeriesData.map(d => ({ x: d.x, y: d.outdoorHumidity })),
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: this.getCommonChartOptions('Humidity (%)')
        });

        // Runtime Chart
        const runtimeData = timeSeriesData.map(d => ({
            x: d.x,
            coolingTime: d.coolingTime,
            heatingTime: d.heatingTime
        }));
        
        const aggregatedRuntimeData = this.aggregateRuntimeData(runtimeData, this.runtimeAggregation);
        const runtimeLabel = this.getRuntimeChartLabel();
        
        this.charts.runtime = new Chart(document.getElementById('runtimeChart'), {
            type: 'bar',
            data: {
                datasets: [
                    {
                        label: `Cooling Time (${this.runtimeAggregation === '15min' ? 'minutes' : 'hours'})`,
                        data: aggregatedRuntimeData.map(d => ({ 
                            x: d.x, 
                            y: this.convertRuntimeForDisplay(d.coolingTime, this.runtimeAggregation)
                        })),
                        backgroundColor: 'rgba(69, 183, 209, 0.7)',
                        borderColor: '#45b7d1',
                        borderWidth: 1
                    },
                    {
                        label: `Heating Time (${this.runtimeAggregation === '15min' ? 'minutes' : 'hours'})`,
                        data: aggregatedRuntimeData.map(d => ({ 
                            x: d.x, 
                            y: this.convertRuntimeForDisplay(d.heatingTime, this.runtimeAggregation)
                        })),
                        backgroundColor: 'rgba(243, 156, 18, 0.7)',
                        borderColor: '#f39c12',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                ...this.getCommonChartOptions(runtimeLabel),
                scales: {
                    ...this.getCommonChartOptions(runtimeLabel).scales,
                    x: {
                        ...this.getCommonChartOptions(runtimeLabel).scales.x,
                        stacked: true
                    },
                    y: {
                        ...this.getCommonChartOptions(runtimeLabel).scales.y,
                        stacked: true
                    }
                }
            }
        });
    }

    aggregateRuntimeData(data, aggregationType) {
        if (aggregationType === '15min') {
            // Return original data for 15-minute intervals
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
                    // Round to nearest hour
                    date.setMinutes(0, 0, 0);
                    key = date.getTime();
                    break;
                case 'daily':
                    // Round to start of day
                    date.setHours(0, 0, 0, 0);
                    key = date.getTime();
                    break;
                case 'weekly':
                    // Round to start of week (Sunday)
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

    getRuntimeChartLabel() {
        switch (this.runtimeAggregation) {
            case 'hourly':
                return 'Runtime (hours)';
            case 'daily':
                return 'Runtime (hours)';
            case 'weekly':
                return 'Runtime (hours)';
            default:
                return 'Runtime (minutes)';
        }
    }

    convertRuntimeForDisplay(minutes, aggregationType) {
        switch (aggregationType) {
            case 'hourly':
            case 'daily':
            case 'weekly':
                return minutes / 60; // Convert to hours
            default:
                return minutes; // Keep as minutes
        }
    }

    // Temperature conversion utilities
    celsiusToFahrenheit(celsius) {
        return (celsius * 9/5) + 32;
    }

    fahrenheitToCelsius(fahrenheit) {
        return (fahrenheit - 32) * 5/9;
    }

    convertTemperature(temp, fromUnit, toUnit) {
        if (fromUnit === toUnit) return temp;
        if (fromUnit === 'C' && toUnit === 'F') {
            return this.celsiusToFahrenheit(temp);
        }
        if (fromUnit === 'F' && toUnit === 'C') {
            return this.fahrenheitToCelsius(temp);
        }
        return temp;
    }

    getTemperatureForDisplay(temp) {
        // Nest data is in Celsius, convert if needed
        return this.temperatureUnit === 'F' ? this.celsiusToFahrenheit(temp) : temp;
    }

    updateTemperatureUnits() {
        const unit = this.temperatureUnit === 'F' ? '°F' : '°C';
        document.getElementById('tempUnit1').textContent = unit;
        document.getElementById('tempUnit2').textContent = unit;
    }

    getCommonChartOptions(yAxisLabel) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: 'white',
                    bodyColor: 'white',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        title: function(tooltipItems) {
                            const date = new Date(tooltipItems[0].parsed.x);
                            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        displayFormats: {
                            hour: 'MMM dd HH:mm',
                            day: 'MMM dd',
                            week: 'MMM dd',
                            month: 'MMM yyyy'
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    ticks: {
                        maxTicksLimit: 10
                    }
                },
                y: {
                    beginAtZero: false,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    title: {
                        display: true,
                        text: yAxisLabel,
                        font: {
                            size: 12,
                            weight: 'bold'
                        }
                    }
                }
            }
        };
    }

    destroyExistingCharts() {
        Object.values(this.charts).forEach(chart => {
            if (chart) chart.destroy();
        });
        this.charts = {};
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        loading.classList.toggle('show', show);
    }

    showError(message) {
        const error = document.getElementById('error');
        error.textContent = message;
        error.classList.add('show');
    }

    hideError() {
        const error = document.getElementById('error');
        error.classList.remove('show');
    }

    showSections() {
        document.getElementById('filterSection').style.display = 'block';
        document.getElementById('statsSection').style.display = 'grid';
        document.getElementById('chartsSection').style.display = 'block';
    }

    setupDateFilter() {
        if (this.data.length === 0) return;
        
        const firstDate = this.data[0].timestamp;
        const lastDate = this.data[this.data.length - 1].timestamp;
        
        // Set default values for date inputs
        const startInput = document.getElementById('startDate');
        const endInput = document.getElementById('endDate');
        
        // Format dates for datetime-local input (YYYY-MM-DDTHH:MM)
        startInput.value = this.formatDateForInput(firstDate);
        endInput.value = this.formatDateForInput(lastDate);
        
        // Set min/max values
        startInput.min = this.formatDateForInput(firstDate);
        startInput.max = this.formatDateForInput(lastDate);
        endInput.min = this.formatDateForInput(firstDate);
        endInput.max = this.formatDateForInput(lastDate);
    }

    formatDateForInput(date) {
        // Convert to local timezone and format for datetime-local input
        const offset = date.getTimezoneOffset();
        const localDate = new Date(date.getTime() - (offset * 60 * 1000));
        return localDate.toISOString().slice(0, 16);
    }

    applyDateFilter() {
        const startInput = document.getElementById('startDate');
        const endInput = document.getElementById('endDate');
        
        if (!startInput.value || !endInput.value) {
            this.showError('Please select both start and end dates');
            return;
        }
        
        const startDate = new Date(startInput.value);
        const endDate = new Date(endInput.value);
        
        if (startDate >= endDate) {
            this.showError('Start date must be before end date');
            return;
        }
        
        this.filteredData = this.data.filter(record => 
            record.timestamp >= startDate && record.timestamp <= endDate
        );
        
        if (this.filteredData.length === 0) {
            this.showError('No data found in the selected date range');
            return;
        }
        
        this.hideError();
        this.updateStats();
        this.createCharts();
    }

    resetDateFilter() {
        this.filteredData = [...this.data];
        this.setupDateFilter(); // Reset date inputs to full range
        this.hideError();
        this.updateStats();
        this.createCharts();
    }

    applyQuickFilter(days) {
        if (this.data.length === 0) return;
        
        const endDate = this.data[this.data.length - 1].timestamp;
        const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));
        
        this.filteredData = this.data.filter(record => 
            record.timestamp >= startDate && record.timestamp <= endDate
        );
        
        // Update the date inputs to reflect the quick filter
        document.getElementById('startDate').value = this.formatDateForInput(startDate);
        document.getElementById('endDate').value = this.formatDateForInput(endDate);
        
        this.hideError();
        this.updateStats();
        this.createCharts();
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new NestDataViewer();
});
