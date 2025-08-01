class NestDataViewer {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.charts = {};
        this.temperatureUnit = 'F'; // Default to Fahrenheit
        this.runtimeAggregation = '15min'; // Default aggregation
        this.correlationAggregation = '15min'; // Default aggregation for correlation chart
        this.timeSeriesData = []; // Cached processed data
        this.isProcessing = false;
        this.dataWorker = null;
        this.updateTimeout = null; // For debouncing
        this.initializeEventListeners();
        this.initializeWorker();
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
                    this.debouncedUpdate(() => {
                        this.updateStats();
                        // When temperature unit changes, we need to recreate all charts
                        this.recreateChartsWithNewUnits();
                    });
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

        document.getElementById('resetZoom').addEventListener('click', () => {
            this.resetAllChartsZoom();
        });

        // Quick filter listeners
        document.querySelectorAll('.quick-filter').forEach(button => {
            button.addEventListener('click', (event) => {
                const days = parseInt(event.target.getAttribute('data-days'));
                this.applyQuickFilter(days);
            });
        });

        // Runtime aggregation listeners with debouncing
        const runtimeAggInputs = document.querySelectorAll('input[name="runtimeAggregation"]');
        runtimeAggInputs.forEach(input => {
            input.addEventListener('change', (event) => {
                this.runtimeAggregation = event.target.value;
                if (this.data.length > 0) {
                    this.debouncedUpdate(() => {
                        this.updateRuntimeChart();
                    });
                }
            });
        });

        // Correlation aggregation listeners with debouncing
        const correlationAggInputs = document.querySelectorAll('input[name="correlationAggregation"]');
        correlationAggInputs.forEach(input => {
            input.addEventListener('change', (event) => {
                this.correlationAggregation = event.target.value;
                if (this.data.length > 0) {
                    this.debouncedUpdate(() => {
                        this.updateCorrelationChart();
                    });
                }
            });
        });

        // Hot temperature threshold listeners with debouncing
        document.getElementById('enableHotThreshold').addEventListener('change', (event) => {
            if (this.data.length > 0) {
                this.debouncedUpdate(() => {
                    this.updateTemperatureChart();
                });
            }
        });

        document.getElementById('hotThreshold').addEventListener('input', (event) => {
            if (this.data.length > 0) {
                this.debouncedUpdate(() => {
                    this.updateTemperatureChart();
                });
            }
        });

        // Help modal listeners
        document.getElementById('helpButton').addEventListener('click', () => {
            document.getElementById('helpModal').style.display = 'block';
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            document.getElementById('helpModal').style.display = 'none';
        });

        // Close modal when clicking outside of it
        window.addEventListener('click', (event) => {
            const modal = document.getElementById('helpModal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        });

        // Close modal with Escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                document.getElementById('helpModal').style.display = 'none';
            }
        });

        // Initialize drag and drop
        this.initializeDragAndDrop();

        // Sample data button listener
        document.getElementById('loadSampleData').addEventListener('click', () => {
            this.loadSampleData();
        });
    }

    initializeWorker() {
        if (typeof Worker !== 'undefined') {
            this.dataWorker = new Worker('dataWorker.js');
            this.dataWorker.onmessage = (e) => {
                this.handleWorkerMessage(e.data);
            };
            this.dataWorker.onerror = (error) => {
                console.error('Worker error:', error);
                this.showError('Error processing data in background worker');
                this.showLoading(false);
                this.isProcessing = false;
            };
        }
    }

    handleWorkerMessage(message) {
        const { type, data, progress, error, aggregationType } = message;
        
        switch (type) {
            case 'progress':
                this.updateProgress(progress, message.processed, message.total);
                break;
                
            case 'parseComplete':
                this.updateProgressStep('processing');
                this.data = data;
                this.filteredData = [...this.data];
                // Use setTimeout to allow UI to update before heavy processing
                setTimeout(() => {
                    this.prepareChartData();
                }, 10);
                break;
                
            case 'chartDataReady':
                this.updateProgressStep('stats');
                this.timeSeriesData = data;
                
                // Break up the work into smaller chunks
                setTimeout(() => {
                    this.setupDateFilter();
                    this.updateStats();
                    this.updateProgressStep('charts');
                    
                    // Show sections immediately, then create charts
                    setTimeout(() => {
                        this.showSections();
                        this.createChartsProgressively();
                    }, 10);
                }, 10);
                break;
                
            case 'runtimeAggregated':
                this.updateRuntimeChartWithData(data, aggregationType);
                break;
                
            case 'temperatureAggregated':
                this.updateCorrelationChartWithData(data, aggregationType);
                break;
                
            case 'error':
                console.error('Worker error:', error);
                this.showError(`Error processing data: ${error}`);
                this.showLoading(false);
                this.isProcessing = false;
                break;
        }
    }

    debouncedUpdate(callback, delay = 300) {
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }
        this.updateTimeout = setTimeout(callback, delay);
    }

    updateProgress(progress, processed, total) {
        const loadingElement = document.getElementById('loading');
        if (loadingElement.classList.contains('show')) {
            loadingElement.innerHTML = `
                <p>🔄 Processing your data...</p>
                <p>Progress: ${progress}% (${processed.toLocaleString()} / ${total.toLocaleString()} lines)</p>
                <div style="width: 100%; background: #f0f0f0; border-radius: 10px; margin: 10px 0;">
                    <div style="width: ${progress}%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 20px; border-radius: 10px; transition: width 0.3s ease;"></div>
                </div>
            `;
        }
    }

    updateProgressStep(step, substep = '') {
        const loadingElement = document.getElementById('loading');
        if (loadingElement.classList.contains('show')) {
            const steps = {
                'parsing': '📄 Parsing data...',
                'processing': '⚡ Processing chart data...',
                'stats': '📊 Calculating statistics...',
                'charts': '📈 Creating charts...',
                'complete': '✅ Ready!'
            };
            
            const stepText = steps[step] || step;
            const substepText = substep ? `<br><small>${substep}</small>` : '';
            
            loadingElement.innerHTML = `
                <p>${stepText}${substepText}</p>
                <div style="width: 100%; background: #f0f0f0; border-radius: 10px; margin: 10px 0;">
                    <div style="width: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 20px; border-radius: 10px; animation: pulse 1.5s ease-in-out infinite;"></div>
                </div>
                <style>
                    @keyframes pulse {
                        0% { opacity: 0.6; }
                        50% { opacity: 1; }
                        100% { opacity: 0.6; }
                    }
                </style>
            `;
        }
    }

    initializeDragAndDrop() {
        const dropZone = document.getElementById('dropZone');
        const fileInput = document.getElementById('fileInput');

        if (!dropZone) return;

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        // Highlight drop zone when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => this.highlight(dropZone), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => this.unhighlight(dropZone), false);
        });

        // Handle dropped files
        dropZone.addEventListener('drop', (e) => this.handleDrop(e, fileInput), false);

        // Make the entire drop zone clickable, but not when clicking the label
        dropZone.addEventListener('click', (e) => {
            // Don't trigger if clicking on the label (it already triggers the file input)
            if (e.target.tagName.toLowerCase() !== 'label') {
                fileInput.click();
            }
        }, false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    highlight(element) {
        element.classList.add('dragover');
    }

    unhighlight(element) {
        element.classList.remove('dragover');
    }

    handleDrop(e, fileInput) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            // Set the file to the input element
            fileInput.files = files;
            
            // Trigger the change event to process the file
            const event = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(event);
        }
    }

    async loadSampleData() {
        if (this.isProcessing) return;
        
        this.showLoading(true);
        this.hideError();
        this.isProcessing = true;

        try {
            const response = await fetch('HvacRuntime_demo.jsonl');
            
            if (!response.ok) {
                throw new Error(`Failed to load sample data: ${response.status}`);
            }
            
            const text = await response.text();
            
            if (this.dataWorker) {
                this.dataWorker.postMessage({
                    type: 'parseJSONL',
                    data: { text: text }
                });
            } else {
                // Fallback for browsers without Worker support
                this.data = this.parseJSONL(text);
                this.prepareChartDataFallback();
            }
            
        } catch (error) {
            console.error('Error loading sample data:', error);
            this.showError(`Failed to load sample data: ${error.message}`);
            this.showLoading(false);
            this.isProcessing = false;
        }
    }

    async handleFileUpload(file) {
        if (!file || this.isProcessing) return;

        this.showLoading(true);
        this.hideError();
        this.isProcessing = true;

        try {
            const text = await this.readFile(file);
            
            if (this.dataWorker) {
                this.dataWorker.postMessage({
                    type: 'parseJSONL',
                    data: { text: text }
                });
            } else {
                // Fallback for browsers without Worker support
                this.data = this.parseJSONL(text);
                this.prepareChartDataFallback();
            }
            
        } catch (error) {
            this.showError(`Error processing file: ${error.message}`);
            this.showLoading(false);
            this.isProcessing = false;
        }
    }

    prepareChartData() {
        if (this.dataWorker && this.data.length > 0) {
            this.dataWorker.postMessage({
                type: 'prepareChartData',
                data: {
                    rawData: this.data,
                    temperatureUnit: this.temperatureUnit
                }
            });
        }
    }

    prepareChartDataFallback() {
        if (this.data.length === 0) {
            throw new Error('No valid data found in the file');
        }

        this.updateProgressStep('processing');
        this.filteredData = [...this.data];
        
        // Prepare chart data synchronously (fallback)
        setTimeout(() => {
            this.timeSeriesData = this.data.map(d => ({
                x: d.timestamp,
                indoorTemp: this.getTemperatureForDisplay(d.indoor_temp),
                outdoorTemp: this.getTemperatureForDisplay(d.outdoor_temp),
                coolingTarget: this.getTemperatureForDisplay(d.cooling_target),
                heatingTarget: this.getTemperatureForDisplay(d.heating_target),
                indoorHumidity: d.indoor_humidity,
                outdoorHumidity: d.outdoor_humidity,
                coolingTime: d.cooling_time / 60,
                heatingTime: d.heating_time / 60
            }));
            
            this.updateProgressStep('stats');
            setTimeout(() => {
                this.setupDateFilter();
                this.updateStats();
                this.updateProgressStep('charts');
                
                setTimeout(() => {
                    this.showSections();
                    this.createChartsProgressively();
                }, 10);
            }, 10);
        }, 10);
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
                if (record.interval_start && record.indoor_temp !== undefined && record.outdoor_temp !== undefined && record.outdoor_temp !== null) {
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
        const dataToUse = this.getFilteredTimeSeriesData();

        // Create all charts
        this.createTemperatureChart(dataToUse);
        this.createTargetChart(dataToUse);
        this.createHumidityChart(dataToUse);
        this.createRuntimeChart(dataToUse);
        this.createCorrelationChart(dataToUse);
    }

    createChartsProgressively() {
        this.destroyExistingCharts();
        const dataToUse = this.getFilteredTimeSeriesData();
        
        const charts = [
            { name: 'Temperature Chart', method: () => this.createTemperatureChart(dataToUse) },
            { name: 'Target Chart', method: () => this.createTargetChart(dataToUse) },
            { name: 'Humidity Chart', method: () => this.createHumidityChart(dataToUse) },
            { name: 'Runtime Chart', method: () => this.createRuntimeChart(dataToUse) },
            { name: 'Correlation Chart', method: () => this.createCorrelationChart(dataToUse) }
        ];
        
        let currentChart = 0;
        
        const createNextChart = () => {
            if (currentChart < charts.length) {
                const chart = charts[currentChart];
                this.updateProgressStep('charts', `Creating ${chart.name}... (${currentChart + 1}/${charts.length})`);
                
                // Use setTimeout to allow UI to update
                setTimeout(() => {
                    chart.method();
                    currentChart++;
                    createNextChart();
                }, 50);
            } else {
                // All charts created
                this.updateProgressStep('complete');
                setTimeout(() => {
                    this.showLoading(false);
                    this.isProcessing = false;
                }, 500);
            }
        };
        
        createNextChart();
    }

    getFilteredTimeSeriesData() {
        const dataToUse = this.filteredData.length > 0 ? this.filteredData : this.data;
        if (this.timeSeriesData.length === 0 || this.timeSeriesData.length !== dataToUse.length) {
            // Regenerate time series data if needed
            return dataToUse.map(d => ({
                x: d.timestamp,
                indoorTemp: this.getTemperatureForDisplay(d.indoor_temp),
                outdoorTemp: this.getTemperatureForDisplay(d.outdoor_temp),
                coolingTarget: this.getTemperatureForDisplay(d.cooling_target),
                heatingTarget: this.getTemperatureForDisplay(d.heating_target),
                indoorHumidity: d.indoor_humidity,
                outdoorHumidity: d.outdoor_humidity,
                coolingTime: d.cooling_time / 60,
                heatingTime: d.heating_time / 60
            }));
        }
        
        // Filter existing time series data if we have time filtering
        const startTime = dataToUse[0]?.timestamp;
        const endTime = dataToUse[dataToUse.length - 1]?.timestamp;
        
        if (!startTime || !endTime) return this.timeSeriesData;
        
        return this.timeSeriesData.filter(d => 
            d.x >= startTime && d.x <= endTime
        );
    }

    createTemperatureChart(timeSeriesData) {
        const enableHotThreshold = document.getElementById('enableHotThreshold').checked;
        const hotThresholdInput = document.getElementById('hotThreshold').value;
        const hotThresholdValue = parseFloat(hotThresholdInput) || 75;
        const temperatureThreshold = this.temperatureUnit === 'F' ? 
            hotThresholdValue : 
            hotThresholdValue;
        
        const temperatureBackgroundPlugin = {
            id: 'temperatureBackground',
            beforeDraw: (chart) => {
                if (!enableHotThreshold) return;
                
                const ctx = chart.ctx;
                const chartArea = chart.chartArea;
                const yScale = chart.scales.y;
                
                const thresholdY = yScale.getPixelForValue(temperatureThreshold);
                
                if (thresholdY >= chartArea.top && thresholdY <= chartArea.bottom) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
                    ctx.fillRect(
                        chartArea.left,
                        chartArea.top,
                        chartArea.right - chartArea.left,
                        thresholdY - chartArea.top
                    );
                    ctx.restore();
                }
            }
        };

        // Pre-process data to avoid mapping during chart creation
        const indoorTempData = [];
        const outdoorTempData = [];
        
        for (let i = 0; i < timeSeriesData.length; i++) {
            const d = timeSeriesData[i];
            indoorTempData.push({ x: d.x, y: d.indoorTemp });
            outdoorTempData.push({ x: d.x, y: d.outdoorTemp });
        }
        
        this.charts.temperature = new Chart(document.getElementById('temperatureChart'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Indoor Temperature',
                        data: indoorTempData,
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
                        data: outdoorTempData,
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
            options: this.getCommonChartOptions(`Temperature (${this.temperatureUnit === 'F' ? '°F' : '°C'})`),
            plugins: [temperatureBackgroundPlugin]
        });
    }

    updateTemperatureChart() {
        if (this.charts.temperature) {
            this.charts.temperature.destroy();
        }
        const timeSeriesData = this.getFilteredTimeSeriesData();
        this.createTemperatureChart(timeSeriesData);
    }

    createTargetChart(timeSeriesData) {
        // Pre-process data to avoid mapping during chart creation
        const indoorTempData = [];
        const coolingTargetData = [];
        const heatingTargetData = [];
        
        for (let i = 0; i < timeSeriesData.length; i++) {
            const d = timeSeriesData[i];
            indoorTempData.push({ x: d.x, y: d.indoorTemp });
            coolingTargetData.push({ x: d.x, y: d.coolingTarget });
            heatingTargetData.push({ x: d.x, y: d.heatingTarget });
        }
        
        this.charts.target = new Chart(document.getElementById('targetChart'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Indoor Temperature',
                        data: indoorTempData,
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
                        data: coolingTargetData,
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
                        data: heatingTargetData,
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
    }

    createHumidityChart(timeSeriesData) {
        // Pre-process data to avoid mapping during chart creation
        const indoorHumidityData = [];
        const outdoorHumidityData = [];
        
        for (let i = 0; i < timeSeriesData.length; i++) {
            const d = timeSeriesData[i];
            indoorHumidityData.push({ x: d.x, y: d.indoorHumidity });
            outdoorHumidityData.push({ x: d.x, y: d.outdoorHumidity });
        }
        
        this.charts.humidity = new Chart(document.getElementById('humidityChart'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Indoor Humidity',
                        data: indoorHumidityData,
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
                        data: outdoorHumidityData,
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
    }

    createRuntimeChart(timeSeriesData) {
        // Pre-process runtime data to avoid mapping during aggregation
        const runtimeData = [];
        for (let i = 0; i < timeSeriesData.length; i++) {
            const d = timeSeriesData[i];
            runtimeData.push({
                x: d.x,
                coolingTime: d.coolingTime,
                heatingTime: d.heatingTime
            });
        }
        
        if (this.dataWorker && runtimeData.length > 1000) {
            // Use worker for large datasets
            this.dataWorker.postMessage({
                type: 'aggregateRuntime',
                data: {
                    runtimeData: runtimeData,
                    aggregationType: this.runtimeAggregation
                }
            });
        } else {
            // Process synchronously for small datasets
            const aggregatedRuntimeData = this.aggregateRuntimeData(runtimeData, this.runtimeAggregation);
            this.updateRuntimeChartWithData(aggregatedRuntimeData, this.runtimeAggregation);
        }
    }

    updateRuntimeChart() {
        const timeSeriesData = this.getFilteredTimeSeriesData();
        this.createRuntimeChart(timeSeriesData);
    }

    updateRuntimeChartWithData(aggregatedData, aggregationType) {
        const runtimeLabel = this.getRuntimeChartLabel();
        
        if (this.charts.runtime) {
            this.charts.runtime.destroy();
        }
        
        this.charts.runtime = new Chart(document.getElementById('runtimeChart'), {
            type: 'bar',
            data: {
                datasets: [
                    {
                        label: `Cooling Time (${aggregationType === '15min' ? 'minutes' : 'hours'})`,
                        data: aggregatedData.map(d => ({ 
                            x: d.x, 
                            y: this.convertRuntimeForDisplay(d.coolingTime, aggregationType)
                        })),
                        backgroundColor: 'rgba(69, 183, 209, 0.7)',
                        borderColor: '#45b7d1',
                        borderWidth: 1
                    },
                    {
                        label: `Heating Time (${aggregationType === '15min' ? 'minutes' : 'hours'})`,
                        data: aggregatedData.map(d => ({ 
                            x: d.x, 
                            y: this.convertRuntimeForDisplay(d.heatingTime, aggregationType)
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

    createCorrelationChart(timeSeriesData) {
        // Pre-process correlation data to avoid mapping during aggregation
        const correlationData = [];
        for (let i = 0; i < timeSeriesData.length; i++) {
            const d = timeSeriesData[i];
            correlationData.push({
                x: d.x,
                outdoorTemp: d.outdoorTemp,
                coolingTime: d.coolingTime,
                heatingTime: d.heatingTime
            });
        }
        
        if (this.dataWorker && correlationData.length > 1000) {
            // Use worker for large datasets
            this.dataWorker.postMessage({
                type: 'aggregateTemperature',
                data: {
                    temperatureData: correlationData,
                    aggregationType: this.correlationAggregation
                }
            });
        } else {
            // Process synchronously for small datasets
            const aggregatedCorrelationData = this.aggregateTemperatureData(correlationData, this.correlationAggregation);
            this.updateCorrelationChartWithData(aggregatedCorrelationData, this.correlationAggregation);
        }
    }

    updateCorrelationChart() {
        const timeSeriesData = this.getFilteredTimeSeriesData();
        this.createCorrelationChart(timeSeriesData);
    }

    updateCorrelationChartWithData(aggregatedData, aggregationType) {
        const correlationRuntimeLabel = this.getRuntimeChartLabel();
        const correlationTempLabel = `Temperature (${this.temperatureUnit === 'F' ? '°F' : '°C'})`;
        
        if (this.charts.correlation) {
            this.charts.correlation.destroy();
        }
        
        this.charts.correlation = new Chart(document.getElementById('correlationChart'), {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Outdoor Temperature',
                        data: aggregatedData.map(d => ({ x: d.x, y: d.outdoorTemp })),
                        borderColor: '#ff9500',
                        backgroundColor: 'rgba(255, 149, 0, 0.1)',
                        borderWidth: 3,
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        yAxisID: 'y'
                    },
                    {
                        label: `Total HVAC Runtime (${aggregationType === '15min' ? 'minutes' : 'hours'})`,
                        data: aggregatedData.map(d => ({ 
                            x: d.x, 
                            y: this.convertRuntimeForDisplay(d.coolingTime + d.heatingTime, aggregationType)
                        })),
                        type: 'bar',
                        backgroundColor: 'rgba(155, 89, 182, 0.6)',
                        borderColor: '#9b59b6',
                        borderWidth: 1,
                        yAxisID: 'y1'
                    },
                    {
                        label: `Cooling Time (${aggregationType === '15min' ? 'minutes' : 'hours'})`,
                        data: aggregatedData.map(d => ({ 
                            x: d.x, 
                            y: this.convertRuntimeForDisplay(d.coolingTime, aggregationType)
                        })),
                        type: 'bar',
                        backgroundColor: 'rgba(69, 183, 209, 0.6)',
                        borderColor: '#45b7d1',
                        borderWidth: 1,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
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
                    },
                    zoom: {
                        limits: {
                            x: {min: 'original', max: 'original'},
                        },
                        pan: {
                            enabled: true,
                            mode: 'x',
                            modifierKey: 'shift',
                            onPanComplete: (context) => {
                                this.onChartInteraction(context.chart);
                            }
                        },
                        zoom: {
                            wheel: {
                                enabled: true,
                                speed: 0.1,
                            },
                            pinch: {
                                enabled: true
                            },
                            drag: {
                                enabled: true,
                                backgroundColor: 'rgba(102, 126, 234, 0.2)',
                                borderColor: 'rgba(102, 126, 234, 0.8)',
                                borderWidth: 1,
                            },
                            mode: 'x',
                            onZoomComplete: (context) => {
                                this.onChartInteraction(context.chart);
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
                        type: 'linear',
                        display: true,
                        position: 'left',
                        beginAtZero: false,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)'
                        },
                        title: {
                            display: true,
                            text: correlationTempLabel,
                            font: {
                                size: 12,
                                weight: 'bold'
                            },
                            color: '#ff9500'
                        },
                        ticks: {
                            color: '#ff9500'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        beginAtZero: true,
                        grid: {
                            drawOnChartArea: false,
                        },
                        title: {
                            display: true,
                            text: correlationRuntimeLabel,
                            font: {
                                size: 12,
                                weight: 'bold'
                            },
                            color: '#9b59b6'
                        },
                        ticks: {
                            color: '#9b59b6'
                        }
                    }
                }
            }
        });
    }

    recreateChartsWithNewUnits() {
        // When temperature unit changes, we need to regenerate time series data
        if (this.dataWorker && this.data.length > 0) {
            this.dataWorker.postMessage({
                type: 'prepareChartData',
                data: {
                    rawData: this.data,
                    temperatureUnit: this.temperatureUnit
                }
            });
        } else {
            // Fallback: regenerate synchronously
            this.timeSeriesData = [];
            this.createCharts();
        }
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

    aggregateTemperatureData(data, aggregationType) {
        if (aggregationType === '15min') {
            // Return original data for 15-minute intervals
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
        
        // Calculate averages for temperature
        return Array.from(aggregated.values()).map(entry => ({
            x: entry.x,
            outdoorTemp: entry.outdoorTemp / entry.count,
            coolingTime: entry.coolingTime,
            heatingTime: entry.heatingTime
        })).sort((a, b) => a.x - b.x);
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
        
        // Update the hot threshold input label and value
        const thresholdLabel = document.querySelector('.threshold-input span');
        const thresholdInput = document.getElementById('hotThreshold');
        const currentValue = parseFloat(thresholdInput.value) || 75;
        
        if (unit === '°C') {
            thresholdLabel.textContent = '°C and above';
            // Convert current Fahrenheit value to Celsius if switching to Celsius
            if (thresholdInput.dataset.unit !== 'C') {
                thresholdInput.value = Math.round(this.fahrenheitToCelsius(currentValue));
                thresholdInput.min = Math.round(this.fahrenheitToCelsius(60)); // ~15°C
                thresholdInput.max = Math.round(this.fahrenheitToCelsius(100)); // ~38°C
                thresholdInput.dataset.unit = 'C';
            }
        } else {
            thresholdLabel.textContent = '°F and above';
            // Convert current Celsius value to Fahrenheit if switching to Fahrenheit
            if (thresholdInput.dataset.unit === 'C') {
                thresholdInput.value = Math.round(this.celsiusToFahrenheit(currentValue));
                thresholdInput.min = 60;
                thresholdInput.max = 100;
                thresholdInput.dataset.unit = 'F';
            }
        }
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
                },
                zoom: {
                    limits: {
                        x: {min: 'original', max: 'original'},
                    },
                    pan: {
                        enabled: true,
                        mode: 'x',
                        modifierKey: 'shift',
                        onPanComplete: (context) => {
                            this.onChartInteraction(context.chart);
                        }
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                            speed: 0.1,
                        },
                        pinch: {
                            enabled: true
                        },
                        drag: {
                            enabled: true,
                            backgroundColor: 'rgba(102, 126, 234, 0.2)',
                            borderColor: 'rgba(102, 126, 234, 0.8)',
                            borderWidth: 1,
                        },
                        mode: 'x',
                        onZoomComplete: (context) => {
                            this.onChartInteraction(context.chart);
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

    onChartInteraction(chart) {
        // Get the current zoom range from the chart
        const xScale = chart.scales.x;
        if (!xScale) return;
        
        const startTime = new Date(xScale.min);
        const endTime = new Date(xScale.max);
        
        // Update the date filter inputs to reflect the chart selection
        const startInput = document.getElementById('startDate');
        const endInput = document.getElementById('endDate');
        
        if (startInput && endInput) {
            startInput.value = this.formatDateForInput(startTime);
            endInput.value = this.formatDateForInput(endTime);
            
            // Apply the filter based on chart selection
            this.debouncedUpdate(() => {
                this.applyDateFilterFromChart(startTime, endTime);
            }, 100);
        }
    }

    applyDateFilterFromChart(startDate, endDate) {
        // Filter data based on chart selection
        this.filteredData = this.data.filter(record => 
            record.timestamp >= startDate && record.timestamp <= endDate
        );
        
        if (this.filteredData.length === 0) {
            this.showError('No data found in the selected date range');
            return;
        }
        
        this.hideError();
        this.updateStats();
        
        // Update only non-chart UI elements to avoid zoom conflicts
        // Don't recreate charts as they are already showing the selected range
    }

    resetAllChartsZoom() {
        // Reset zoom on all charts
        Object.values(this.charts).forEach(chart => {
            if (chart && chart.resetZoom) {
                chart.resetZoom();
            }
        });
        
        // Reset the date filter
        this.resetDateFilter();
    }

    syncChartZoom(sourceChart) {
        // Sync zoom level across all charts for better UX
        if (!sourceChart || !sourceChart.scales || !sourceChart.scales.x) return;
        
        const xScale = sourceChart.scales.x;
        const min = xScale.min;
        const max = xScale.max;
        
        Object.values(this.charts).forEach(chart => {
            if (chart !== sourceChart && chart.scales && chart.scales.x) {
                chart.zoomScale('x', {min, max}, 'none');
            }
        });
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
        
        // Reset zoom on all charts as well
        setTimeout(() => {
            Object.values(this.charts).forEach(chart => {
                if (chart && chart.resetZoom) {
                    chart.resetZoom();
                }
            });
        }, 100);
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
    // Chart.js zoom plugin is automatically registered when loaded via CDN
    // No manual registration needed for CDN loaded plugins
    
    new NestDataViewer();
});
