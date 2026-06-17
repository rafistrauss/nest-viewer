class NestDataViewer {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.charts = {};
        this.temperatureUnit = 'F'; // Default to Fahrenheit
        this.runtimeAggregation = '15min'; // Default aggregation
        this.correlationAggregation = '15min'; // Default aggregation for correlation chart
        this.efficiencyAggregation = 'daily'; // Efficiency chart defaults to daily to reduce noise
        this.efficiencyMode = 'auto'; // 'auto' | 'cooling' | 'heating'
        this.efficiencyNormalization = 'relative'; // 'relative' | 'fixed'
        this.efficiencyBaseTempF = 65; // Conventional degree-day base (65°F / 18.3°C)
        this.timeSeriesData = []; // Cached processed data
        this.isProcessing = false;
        this.dataWorker = null;
        this.updateTimeout = null; // For debouncing
        this.parseStats = null; // Track parsing statistics
        const nestAI = globalThis.NestAI;
        this.aiService = nestAI?.AIService ? new nestAI.AIService() : null;
        this.aiRequestController = null;
        this.aiRequestInFlight = false;
        this.aiKeyVisible = false;
        this.hvacAnalysisRange = '30d';
        this.showCoolingTarget = false;
        this.showHeatingTarget = false;
        this.aiAnomalies = [];
        this.uploadCollapsed = false;
        this.storageKey = 'nestViewer.uploadedData.v1';
        this.settingsKey = 'nestViewer.settings.v1';
        this.aiAnalysisKey = 'nestViewer.aiAnalysis.v1';
        this.restoringFromStorage = false;
        this.uploadMode = 'replace';
        this.mergeOnNextParse = false;
        this.uploadWarnings = [];
        this.settings = this.loadSettings();
        this.applyLoadedSettings();
        this.initializeEventListeners();
        this.initializeWorker();
        this.initializeAISection();
        this.restoreAIAnalysis();
        this.restorePersistedData();
    }

    initializeEventListeners() {
        const fileInput = document.getElementById('fileInput');
        fileInput.addEventListener('change', (event) => {
            this.handleUploadFiles(Array.from(event.target.files || []), 'file')
                .catch(error => this.showError(error.message || 'Failed to process uploaded files.'))
                .finally(() => {
                    event.target.value = '';
                });
        });
        const folderInput = document.getElementById('folderInput');
        if (folderInput) {
            folderInput.addEventListener('change', (event) => {
                this.handleUploadFiles(Array.from(event.target.files || []), 'folder')
                    .catch(error => this.showError(error.message || 'Failed to process uploaded folder.'))
                    .finally(() => {
                        event.target.value = '';
                    });
            });
        }

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
                        this.updateAIDataPreview();
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

        document.getElementById('showCoolingTarget').addEventListener('change', (event) => {
            this.showCoolingTarget = event.target.checked;
            this.saveSetting('showCoolingTarget', event.target.checked);
            if (this.charts.temperature) {
                this.updateTemperatureChart();
            }
        });

        document.getElementById('showHeatingTarget').addEventListener('change', (event) => {
            this.showHeatingTarget = event.target.checked;
            this.saveSetting('showHeatingTarget', event.target.checked);
            if (this.charts.temperature) {
                this.updateTemperatureChart();
            }
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
                this.saveSetting('runtimeAggregation', event.target.value);
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
                this.saveSetting('correlationAggregation', event.target.value);
                if (this.data.length > 0) {
                    this.debouncedUpdate(() => {
                        this.updateCorrelationChart();
                    });
                }
            });
        });

        // Efficiency chart controls
        const efficiencyRerender = () => {
            if (this.data.length > 0) {
                this.debouncedUpdate(() => this.updateEfficiencyChart());
            }
        };

        document.querySelectorAll('input[name="efficiencyAggregation"]').forEach(input => {
            input.addEventListener('change', (event) => {
                this.efficiencyAggregation = event.target.value;
                this.saveSetting('efficiencyAggregation', event.target.value);
                efficiencyRerender();
            });
        });

        document.querySelectorAll('input[name="efficiencyMode"]').forEach(input => {
            input.addEventListener('change', (event) => {
                this.efficiencyMode = event.target.value;
                this.saveSetting('efficiencyMode', event.target.value);
                efficiencyRerender();
            });
        });

        document.querySelectorAll('input[name="efficiencyNormalization"]').forEach(input => {
            input.addEventListener('change', (event) => {
                this.efficiencyNormalization = event.target.value;
                this.saveSetting('efficiencyNormalization', event.target.value);
                efficiencyRerender();
            });
        });

        const efficiencyBaseInput = document.getElementById('efficiencyBaseTemp');
        if (efficiencyBaseInput) {
            efficiencyBaseInput.addEventListener('change', (event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                    // Stored canonically in °F; convert if the UI is showing °C.
                    this.efficiencyBaseTempF = this.temperatureUnit === 'F' ? value : (value * 9 / 5) + 32;
                    this.saveSetting('efficiencyBaseTempF', this.efficiencyBaseTempF);
                    efficiencyRerender();
                }
            });
        }

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

        document.getElementById('clearSavedData').addEventListener('click', () => {
            this.clearPersistedData();
        });

        document.getElementById('downloadData').addEventListener('click', () => {
            this.downloadData();
        });

        document.getElementById('saveApiKey').addEventListener('click', () => {
            this.saveGeminiApiKey();
        });

        document.getElementById('removeApiKey').addEventListener('click', () => {
            this.removeGeminiApiKey();
        });

        document.getElementById('toggleApiKeyVisibility').addEventListener('click', () => {
            this.toggleApiKeyVisibility();
        });

        document.getElementById('analyzeHVACWithAI').addEventListener('click', () => {
            this.analyzeHVACPerformance();
        });

        const hvacAnalysisRange = document.getElementById('hvacAnalysisRange');
        if (hvacAnalysisRange) {
            hvacAnalysisRange.addEventListener('change', (event) => {
                this.hvacAnalysisRange = event.target.value || '30d';
                this.saveSetting('hvacAnalysisRange', this.hvacAnalysisRange);
                this.updateAIDataPreview();
            });
        }

        document.getElementById('cancelAIRequest').addEventListener('click', () => {
            this.cancelAIRequest();
        });

        document.getElementById('toggleAIRaw').addEventListener('click', () => {
            this.toggleAIRaw();
        });

        document.getElementById('toggleUploadSection').addEventListener('click', () => {
            this.setUploadCollapsed(!this.uploadCollapsed);
        });

        document.querySelectorAll('input[name="uploadMode"]').forEach(input => {
            input.addEventListener('change', (event) => {
                this.uploadMode = event.target.value === 'merge' ? 'merge' : 'replace';
                this.saveSetting('uploadMode', this.uploadMode);
            });
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

    initializeAISection() {
        this.updateApiKeyUI();
        this.updateAIDataPreview();
        this.updateAIActionState();
    }

    getDataForAnalysis() {
        // filteredData is the current active selection; if it's empty, treat that as
        // "no data" (e.g. an empty date-range filter) rather than falling back.
        return Array.isArray(this.filteredData) ? this.filteredData : this.data;
    }

    updateApiKeyUI(message = '') {
        const keyInput = document.getElementById('geminiApiKey');
        const statusElement = document.getElementById('apiKeyStatus');
        const hasKey = this.aiService?.hasApiKey();
        const redactKey = this.aiService?.getRedactedApiKey() || '';

        keyInput.value = '';
        keyInput.placeholder = hasKey ? `Saved (${redactKey})` : 'Paste your Gemini API key';
        statusElement.textContent = message || (hasKey ? 'Gemini API key is saved in local browser storage.' : 'No API key configured.');
        statusElement.style.color = hasKey ? '#0a7f3f' : '#666';
    }

    toggleApiKeyVisibility() {
        const keyInput = document.getElementById('geminiApiKey');
        const toggleButton = document.getElementById('toggleApiKeyVisibility');
        this.aiKeyVisible = !this.aiKeyVisible;
        keyInput.type = this.aiKeyVisible ? 'text' : 'password';
        toggleButton.textContent = this.aiKeyVisible ? 'Hide' : 'Show';
    }

    saveGeminiApiKey() {
        if (!this.aiService) return;
        const keyInput = document.getElementById('geminiApiKey');
        const candidateKey = (keyInput.value || '').trim();

        if (candidateKey.length < 20) {
            this.updateApiKeyUI('Please enter a valid Gemini API key.');
            document.getElementById('apiKeyStatus').style.color = '#c0392b';
            return;
        }

        try {
            this.aiService.saveApiKey(candidateKey);
            this.aiService.clearCache();
            this.updateApiKeyUI('Gemini API key saved locally in this browser.');
            this.updateAIActionState();
        } catch (error) {
            this.updateApiKeyUI(error.message || 'Unable to save API key.');
            document.getElementById('apiKeyStatus').style.color = '#c0392b';
        }
    }

    removeGeminiApiKey() {
        if (!this.aiService) return;
        this.aiService.removeApiKey();
        this.aiService.clearCache();
        this.updateApiKeyUI('Gemini API key removed from browser storage.');
        document.getElementById('apiKeyStatus').style.color = '#666';
        this.updateAIActionState();
    }

    getRecordsInDisplayUnit(records) {
        // Raw Nest records store temperatures in Celsius. Convert the temperature
        // fields to the user's selected display unit so the AI summary matches
        // what is shown on the charts and is explicitly labeled.
        if (this.temperatureUnit !== 'F') {
            return records;
        }
        const tempFields = ['indoor_temp', 'outdoor_temp', 'cooling_target', 'heating_target'];
        return records.map(record => {
            const converted = { ...record };
            tempFields.forEach(field => {
                if (record[field] == null || record[field] === '') return;
                const value = Number(record[field]);
                if (Number.isFinite(value)) {
                    converted[field] = this.celsiusToFahrenheit(value);
                }
            });
            return converted;
        });
    }

    getHVACAnalysisRangeDays() {
        if (this.hvacAnalysisRange === 'all') return null;
        const value = Number.parseInt((this.hvacAnalysisRange || '').replace('d', ''), 10);
        return Number.isFinite(value) && value > 0 ? value : 30;
    }

    getHVACAnalysisWindow() {
        const records = this.getDataForAnalysis();
        if (!records.length) return null;

        const dataStart = new Date(records[0].timestamp);
        const dataEnd = new Date(records[records.length - 1].timestamp);
        const rangeDays = this.getHVACAnalysisRangeDays();
        const analysisStartMs = rangeDays == null
            ? dataStart.getTime()
            : Math.max(dataStart.getTime(), dataEnd.getTime() - (rangeDays * 24 * 60 * 60 * 1000));

        const analysisStart = new Date(analysisStartMs);
        const analysisEnd = dataEnd;
        const truncated = analysisStartMs > dataStart.getTime();
        const recordsForAnalysis = records.filter(record => {
            const time = new Date(record.timestamp).getTime();
            return Number.isFinite(time) && time >= analysisStartMs;
        });

        const spanDays = Math.max(1, Math.ceil((analysisEnd.getTime() - analysisStart.getTime()) / 86400000));
        return {
            dataStart,
            dataEnd,
            analysisStart,
            analysisEnd,
            truncated,
            analyzedCount: recordsForAnalysis.length,
            analysisPeriodDays: spanDays,
            recordsForAnalysis
        };
    }

    getBreakdownLabelForSpanDays(spanDays) {
        const helper = globalThis.NestAI?.getBreakdownGranularityForSpanDays;
        const granularity = helper ? helper(spanDays) : (spanDays <= 31 ? 'daily' : (spanDays <= 420 ? 'weekly' : 'monthly'));
        if (granularity === 'daily') return 'daily';
        if (granularity === 'weekly') return 'weekly';
        if (granularity === 'monthly') return 'monthly';
        return 'quarterly';
    }

    formatAnalysisDate(date) {
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    updateHVACAnalysisInfo() {
        const info = document.getElementById('hvacAnalysisInfo');
        if (!info) return;

        const analysisWindow = this.getHVACAnalysisWindow();
        if (!analysisWindow) {
            info.textContent = 'Upload data to analyze HVAC performance.';
            return;
        }

        const startDate = `<span class="analysis-date">${this.escapeHtml(this.formatAnalysisDate(analysisWindow.analysisStart))}</span>`;
        const endDate = `<span class="analysis-date">${this.escapeHtml(this.formatAnalysisDate(analysisWindow.analysisEnd))}</span>`;
        const rangeText = `${startDate} – ${endDate}`;
        const breakdownLabel = this.getBreakdownLabelForSpanDays(analysisWindow.analysisPeriodDays);
        const detail = analysisWindow.truncated
            ? `Analyzes the most recent ${this.getHVACAnalysisRangeDays()} days of the selected data (${rangeText}).`
            : `Analyzes the selected data (${rangeText}).`;
        info.innerHTML = `📊 ${detail} ${analysisWindow.analyzedCount.toLocaleString()} records, summarized ${breakdownLabel}.`;
    }

    escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    updateAIDataPreview() {
        const preview = document.getElementById('aiDataPreview');
        const records = this.getDataForAnalysis();

        this.updateHVACAnalysisInfo();

        const analysisWindow = this.getHVACAnalysisWindow();
        preview.textContent = records.length && analysisWindow
            ? [
                `- ${analysisWindow.analyzedCount.toLocaleString()} records from ${this.formatAnalysisDate(analysisWindow.analysisStart)} to ${this.formatAnalysisDate(analysisWindow.analysisEnd)}${analysisWindow.truncated ? ` (most recent ${this.getHVACAnalysisRangeDays()} days)` : ''}`,
                `- Temperatures in ${this.getTemperatureUnitLabel()}`,
                `- ${this.getBreakdownLabelForSpanDays(analysisWindow.analysisPeriodDays)} period breakdown of runtime and outdoor temperature`,
                '- Cooling & heating cycle metrics',
                '- Temperature performance and setpoint metrics'
            ].join('\n')
            : '- No dataset selected';
    }

    getTemperatureUnitLabel() {
        return this.temperatureUnit === 'F' ? 'Fahrenheit (°F)' : 'Celsius (°C)';
    }

    updateAIActionState(isLoading = false) {
        const hasData = this.getDataForAnalysis().length > 0;
        const hasKey = this.aiService?.hasApiKey();

        document.getElementById('analyzeHVACWithAI').disabled = !hasData || !hasKey || isLoading;
        document.getElementById('cancelAIRequest').style.display = isLoading ? 'inline-block' : 'none';

        // Surface the most relevant prerequisite hint, but only while idle so we
        // don't overwrite an in-progress spinner or a completed result.
        if (!isLoading && !this.aiRequestInFlight) {
            const statusElement = document.getElementById('aiStatus');
            const showingResult = Boolean(this.aiRawOutput);
            if (!hasKey) {
                this.setAIStatus('Configure a Gemini API key to enable AI analysis.', 'info');
            } else if (!hasData) {
                this.setAIStatus('Upload data to enable AI analysis.', 'info');
            } else if (statusElement && !showingResult && this.aiStatusType !== 'error') {
                // Prerequisites met and nothing to report yet — clear stale hints,
                // but leave any error message from the last request visible.
                this.setAIStatus('');
            }
        }
    }

    setAIStatus(message, type = 'info') {
        const statusElement = document.getElementById('aiStatus');
        this.aiStatusType = message ? type : null;
        statusElement.textContent = message;
        statusElement.style.color = type === 'error' ? '#c0392b' : (type === 'success' ? '#0a7f3f' : '#666');
    }

    setAILoading(active, message) {
        const loading = document.getElementById('aiLoading');
        const text = document.getElementById('aiLoadingText');
        if (!loading) return;
        if (text && message) text.textContent = message;
        loading.classList.toggle('active', Boolean(active));
        // While loading, the status line is redundant with the spinner label.
        if (active) {
            this.aiStatusType = null;
            const statusElement = document.getElementById('aiStatus');
            if (statusElement) statusElement.textContent = '';
        }
    }

    setAIOutput(content) {
        const rendered = document.getElementById('aiOutput');
        const raw = document.getElementById('aiOutputRaw');
        const toolbar = document.getElementById('aiOutputToolbar');
        const text = content == null ? '' : String(content);

        this.aiRawOutput = text;
        raw.textContent = text;

        // Pull out any structured anomalies the AI appended so we can both
        // render clean markdown and annotate the charts.
        const parser = globalThis.NestAI?.parseAIAnalysis;
        const parsed = parser ? parser(text) : { markdown: text, anomalies: [] };
        const markdown = parsed.markdown;

        const renderer = globalThis.NestAI?.renderMarkdown;
        rendered.innerHTML = renderer ? renderer(markdown) : '';
        if (!renderer) {
            rendered.textContent = markdown;
        }

        if (toolbar) {
            toolbar.style.display = text ? 'flex' : 'none';
        }
        this.setAIRawVisible(false);
        this.setAIAnomalies(parsed.anomalies);
    }

    setAIRawVisible(visible) {
        this.aiRawVisible = visible;
        const rendered = document.getElementById('aiOutput');
        const raw = document.getElementById('aiOutputRaw');
        const toggle = document.getElementById('toggleAIRaw');
        if (rendered) rendered.style.display = visible ? 'none' : 'block';
        if (raw) raw.style.display = visible ? 'block' : 'none';
        if (toggle) toggle.textContent = visible ? 'View formatted' : 'View raw response';
    }

    toggleAIRaw() {
        this.setAIRawVisible(!this.aiRawVisible);
    }

    setAIAnomalies(anomalies) {
        this.aiAnomalies = Array.isArray(anomalies) ? anomalies : [];
        this.updateAnomalyBanner();
        // Re-render the annotated charts so markers appear/disappear.
        if (this.charts.temperature) this.updateTemperatureChart();
        if (this.charts.runtime) this.updateRuntimeChart();
    }

    clearAIAnomalies() {
        this.setAIAnomalies([]);
    }

    getAnalysisRangeLabel(range) {
        const labels = {
            '30d': 'Most recent 30 days',
            '90d': 'Most recent 90 days',
            '180d': 'Most recent 6 months',
            '365d': 'Most recent 1 year',
            'all': 'All selected data'
        };
        return labels[range] || '';
    }

    saveAIAnalysis() {
        if (!this.aiRawOutput) return;
        try {
            const payload = {
                version: 1,
                output: this.aiRawOutput,
                range: this.hvacAnalysisRange,
                unit: this.getTemperatureUnitLabel(),
                recordCount: this.data.length,
                generatedAt: new Date().toISOString()
            };
            localStorage.setItem(this.aiAnalysisKey, JSON.stringify(payload));
            this.showAIAnalysisMeta(payload, false);
        } catch (error) {
            console.warn('Could not save AI analysis for next visit:', error);
        }
    }

    restoreAIAnalysis() {
        // Only restore a saved analysis when we also have saved data to back it,
        // so we never show an analysis that no longer matches any dataset.
        if (!this.hasPersistedData()) {
            this.clearSavedAIAnalysis();
            return;
        }

        let raw;
        try {
            raw = localStorage.getItem(this.aiAnalysisKey);
        } catch (error) {
            return;
        }
        if (!raw) return;

        let payload;
        try {
            payload = JSON.parse(raw);
        } catch (error) {
            this.clearSavedAIAnalysis();
            return;
        }

        if (!payload || typeof payload.output !== 'string' || !payload.output.trim()) {
            this.clearSavedAIAnalysis();
            return;
        }

        if (typeof payload.range === 'string') {
            this.hvacAnalysisRange = payload.range;
            const el = document.getElementById('hvacAnalysisRange');
            if (el) el.value = payload.range;
        }

        this.setAIOutput(payload.output);
        this.showAIAnalysisMeta(payload, true);
    }

    showAIAnalysisMeta(payload, restored) {
        const el = document.getElementById('aiAnalysisMeta');
        if (!el) return;
        if (!payload || !payload.generatedAt) {
            el.style.display = 'none';
            el.textContent = '';
            return;
        }
        const when = new Date(payload.generatedAt);
        const stamp = Number.isNaN(when.getTime()) ? '' : when.toLocaleString();
        const rangeLabel = this.getAnalysisRangeLabel(payload.range);
        const details = [stamp, rangeLabel].filter(Boolean).join(' · ');
        const prefix = restored ? '💾 Showing your saved analysis' : '💾 Analysis saved';
        el.textContent = `${prefix}${details ? ` (${details})` : ''}. It reloads automatically until you upload new data.`;
        el.style.display = 'block';
    }

    clearSavedAIAnalysis() {
        try {
            localStorage.removeItem(this.aiAnalysisKey);
        } catch (error) {
            console.warn('Could not clear saved AI analysis:', error);
        }
        const el = document.getElementById('aiAnalysisMeta');
        if (el) {
            el.style.display = 'none';
            el.textContent = '';
        }
    }

    updateAnomalyBanner() {
        const banner = document.getElementById('anomalyBanner');
        if (!banner) return;
        const count = this.aiAnomalies.length;
        if (!count) {
            banner.style.display = 'none';
            banner.innerHTML = '';
            return;
        }
        banner.style.display = 'flex';
        banner.innerHTML = '';
        const label = document.createElement('span');
        label.textContent = `📍 ${count} AI-flagged ${count === 1 ? 'range' : 'ranges'} marked on the charts above. Click a ⚠ marker for details.`;
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'anomaly-clear-btn';
        clear.textContent = 'Clear markers';
        clear.addEventListener('click', () => {
            this.hideAnomalyPopover();
            this.clearAIAnomalies();
        });
        banner.appendChild(label);
        banner.appendChild(clear);
    }

    getAnomalySeverityColor(severity, alpha = 1) {
        const colors = {
            high: `rgba(231, 76, 60, ${alpha})`,
            medium: `rgba(243, 156, 18, ${alpha})`,
            low: `rgba(52, 152, 219, ${alpha})`
        };
        return colors[severity] || colors.medium;
    }

    /**
     * Chart.js plugin that shades AI-flagged time ranges and draws a clickable
     * ⚠ marker for each. Marker hitboxes are stored on the chart instance so
     * the shared onClick handler can map a click to an anomaly.
     */
    createAnomalyMarkerPlugin() {
        const viewer = this;
        return {
            id: 'aiAnomalyMarkers',
            afterDatasetsDraw(chart) {
                chart.$anomalyMarkers = [];
                const anomalies = viewer.aiAnomalies;
                if (!anomalies || !anomalies.length) return;

                const xScale = chart.scales.x;
                const area = chart.chartArea;
                if (!xScale || !area) return;

                const ctx = chart.ctx;
                const viewMin = xScale.min;
                const viewMax = xScale.max;

                anomalies.forEach((anomaly) => {
                    // Skip anomalies entirely outside the visible window.
                    if (anomaly.endMs < viewMin || anomaly.startMs > viewMax) return;

                    const startPx = Math.max(area.left, xScale.getPixelForValue(Math.max(anomaly.startMs, viewMin)));
                    const endPx = Math.min(area.right, xScale.getPixelForValue(Math.min(anomaly.endMs, viewMax)));
                    const bandLeft = Math.min(startPx, endPx);
                    const bandRight = Math.max(startPx, endPx);
                    const bandWidth = Math.max(bandRight - bandLeft, 2);

                    ctx.save();
                    // Shaded band over the flagged range.
                    ctx.fillStyle = viewer.getAnomalySeverityColor(anomaly.severity, 0.12);
                    ctx.fillRect(bandLeft, area.top, bandWidth, area.bottom - area.top);

                    // Range edges.
                    ctx.strokeStyle = viewer.getAnomalySeverityColor(anomaly.severity, 0.5);
                    ctx.lineWidth = 1;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(bandLeft + 0.5, area.top);
                    ctx.lineTo(bandLeft + 0.5, area.bottom);
                    ctx.moveTo(bandRight - 0.5, area.top);
                    ctx.lineTo(bandRight - 0.5, area.bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // Clickable marker badge at the top-center of the band.
                    const markerX = (bandLeft + bandRight) / 2;
                    const markerY = area.top + 12;
                    const radius = 11;

                    ctx.beginPath();
                    ctx.arc(markerX, markerY, radius, 0, Math.PI * 2);
                    ctx.fillStyle = viewer.getAnomalySeverityColor(anomaly.severity, 1);
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = '#ffffff';
                    ctx.stroke();

                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 12px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('⚠', markerX, markerY + 0.5);
                    ctx.restore();

                    chart.$anomalyMarkers.push({
                        x: markerX,
                        y: markerY,
                        radius: radius + 3,
                        anomaly
                    });
                });
            }
        };
    }

    handleAnomalyClick(event, chart) {
        const markers = chart.$anomalyMarkers;
        if (!markers || !markers.length) return false;

        const rect = chart.canvas.getBoundingClientRect();
        const clientX = event.native ? event.native.clientX : event.clientX;
        const clientY = event.native ? event.native.clientY : event.clientY;
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        // Pick the closest marker within its hit radius.
        let hit = null;
        let bestDist = Infinity;
        markers.forEach((marker) => {
            const dist = Math.hypot(marker.x - x, marker.y - y);
            if (dist <= marker.radius && dist < bestDist) {
                bestDist = dist;
                hit = marker;
            }
        });

        if (!hit) {
            this.hideAnomalyPopover();
            return false;
        }

        this.showAnomalyPopover(hit.anomaly, clientX, clientY);
        return true;
    }

    showAnomalyPopover(anomaly, clientX, clientY) {
        let popover = document.getElementById('anomalyPopover');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 'anomalyPopover';
            popover.className = 'anomaly-popover';
            document.body.appendChild(popover);
            // Dismiss when clicking elsewhere.
            document.addEventListener('click', (e) => {
                if (!popover.contains(e.target) && !(e.target && e.target.tagName === 'CANVAS')) {
                    this.hideAnomalyPopover();
                }
            });
        }

        const start = new Date(anomaly.startMs);
        const end = new Date(anomaly.endMs);
        const sameInstant = anomaly.startMs === anomaly.endMs;
        const rangeText = sameInstant
            ? `${start.toLocaleString()}`
            : `${start.toLocaleString()} → ${end.toLocaleString()}`;
        const sevLabel = anomaly.severity.charAt(0).toUpperCase() + anomaly.severity.slice(1);

        popover.innerHTML = '';
        const header = document.createElement('div');
        header.className = 'anomaly-popover-header';

        const badge = document.createElement('span');
        badge.className = 'anomaly-popover-badge';
        badge.textContent = sevLabel;
        badge.style.backgroundColor = this.getAnomalySeverityColor(anomaly.severity, 1);

        const title = document.createElement('strong');
        title.textContent = anomaly.title;

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'anomaly-popover-close';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '×';
        close.addEventListener('click', () => this.hideAnomalyPopover());

        header.appendChild(badge);
        header.appendChild(title);
        header.appendChild(close);

        const range = document.createElement('div');
        range.className = 'anomaly-popover-range';
        range.textContent = rangeText;

        popover.appendChild(header);
        popover.appendChild(range);

        if (anomaly.detail) {
            const detail = document.createElement('p');
            detail.className = 'anomaly-popover-detail';
            detail.textContent = anomaly.detail;
            popover.appendChild(detail);
        }

        // Position near the click, then clamp into the viewport.
        popover.style.display = 'block';
        popover.style.visibility = 'hidden';
        const pw = popover.offsetWidth;
        const ph = popover.offsetHeight;
        let left = clientX + 14;
        let top = clientY + 14;
        if (left + pw > window.innerWidth - 8) left = clientX - pw - 14;
        if (left < 8) left = 8;
        if (top + ph > window.innerHeight - 8) top = clientY - ph - 14;
        if (top < 8) top = 8;
        popover.style.left = `${left + window.scrollX}px`;
        popover.style.top = `${top + window.scrollY}px`;
        popover.style.visibility = 'visible';
    }

    hideAnomalyPopover() {
        const popover = document.getElementById('anomalyPopover');
        if (popover) popover.style.display = 'none';
    }

    cancelAIRequest() {
        if (this.aiRequestController) {
            this.aiRequestController.abort();
            this.setAIStatus('AI request canceled.', 'info');
        }
    }

    async runAIRequest(requestCallback) {
        if (!this.aiService) {
            this.setAIStatus('AI service is unavailable in this build.', 'error');
            return;
        }

        if (this.aiRequestInFlight) {
            this.setAIStatus('An AI request is already running. Please wait or cancel it.', 'info');
            return;
        }

        this.aiRequestInFlight = true;
        this.aiRequestController = new AbortController();
        this.updateAIActionState(true);
        this.setAILoading(true);

        try {
            await requestCallback(this.aiRequestController.signal);
            this.setAIStatus('AI analysis complete.', 'success');
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.setAIStatus('AI request canceled.', 'info');
                return;
            }
            this.setAIStatus(error.message || 'AI request failed.', 'error');
        } finally {
            this.aiRequestInFlight = false;
            this.aiRequestController = null;
            this.updateAIActionState(false);
            this.setAILoading(false);
        }
    }

    async analyzeHVACPerformance() {
        const analysisWindow = this.getHVACAnalysisWindow();
        if (!analysisWindow || !analysisWindow.recordsForAnalysis.length) {
            this.setAIStatus('Upload data before running HVAC analysis.', 'error');
            return;
        }

        const recordsForAnalysis = this.getRecordsInDisplayUnit(analysisWindow.recordsForAnalysis);
        const summarizeHVACData = globalThis.NestAI?.summarizeHVACData;
        if (!summarizeHVACData) {
            this.setAIStatus('AI HVAC summarizer is not loaded. Refresh the page and try again.', 'error');
            return;
        }

        const summary = summarizeHVACData(recordsForAnalysis, analysisWindow.analysisPeriodDays, {
            temperatureUnit: this.getTemperatureUnitLabel()
        });

        await this.runAIRequest(async (signal) => {
            this.setAILoading(true, 'Analyzing HVAC performance with Gemini…');
            const output = await this.aiService.analyzeHVAC(summary, {
                cacheKey: `hvac:${JSON.stringify(summary)}`,
                signal
            });
            this.setAIOutput(output);
            this.saveAIAnalysis();
        });
    }

    handleWorkerMessage(message) {
        const { type, data, progress, error, aggregationType, stats } = message;
        
        switch (type) {
            case 'progress':
                this.updateProgress(progress, message.processed, message.total);
                break;
                
            case 'parseComplete':
                this.updateProgressStep('processing');
                if (this.mergeOnNextParse && !this.restoringFromStorage && this.data.length > 0) {
                    this.data = this.mergeWithExistingData(data);
                } else {
                    this.data = this.sortDataByTimestamp(data);
                }
                this.filteredData = [...this.data];
                this.parseStats = stats; // Store parsing statistics
                this.showValidationWarning(); // Show warning if there were skipped lines
                // A fresh upload/sample load invalidates any previously saved analysis.
                if (!this.restoringFromStorage) {
                    this.clearSavedAIAnalysis();
                    this.setAIOutput('');
                }
                this.updateAIDataPreview();
                this.updateAIActionState();
                this.persistCurrentData();
                this.mergeOnNextParse = false;
                if (this.uploadWarnings.length > 0) {
                    this.showUploadNotice(this.uploadWarnings.join(' '));
                } else {
                    this.hideUploadNotice();
                }
                this.uploadWarnings = [];
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
                
            case 'efficiencyAggregated':
                this.updateEfficiencyChartWithData(data, aggregationType);
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
        dropZone.addEventListener('drop', (e) => {
            this.handleDrop(e).catch(error => {
                this.showError(error.message || 'Failed to process dropped files.');
            });
        }, false);

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

    async handleDrop(e) {
        const files = await this.getDroppedFiles(e.dataTransfer);
        if (!files.length) {
            return;
        }
        await this.handleUploadFiles(files, 'drop');
    }

    async getDroppedFiles(dataTransfer) {
        if (!dataTransfer) return [];

        const items = Array.from(dataTransfer.items || []);
        const hasEntries = items.some(item => item && typeof item.webkitGetAsEntry === 'function');

        if (hasEntries) {
            const files = [];
            for (const item of items) {
                if (!item || typeof item.webkitGetAsEntry !== 'function') continue;
                const entry = item.webkitGetAsEntry();
                if (!entry) continue;
                const entryFiles = await this.readDroppedEntryFiles(entry);
                files.push(...entryFiles);
            }
            if (files.length) {
                return files;
            }
        }

        return Array.from(dataTransfer.files || []);
    }

    async readDroppedEntryFiles(entry) {
        if (!entry) return [];
        if (entry.isFile) {
            const file = await new Promise((resolve, reject) => {
                entry.file(resolve, reject);
            });
            return file ? [file] : [];
        }
        if (!entry.isDirectory) return [];

        const files = [];
        const reader = entry.createReader();
        let keepReading = true;

        while (keepReading) {
            const entries = await new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });
            if (!entries.length) {
                keepReading = false;
                continue;
            }
            for (const child of entries) {
                const childFiles = await this.readDroppedEntryFiles(child);
                files.push(...childFiles);
            }
        }

        return files;
    }

    loadSettings() {
        try {
            const raw = localStorage.getItem(this.settingsKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (error) {
            console.warn('Could not load saved settings:', error);
            return {};
        }
    }

    saveSetting(key, value) {
        this.settings[key] = value;
        try {
            localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
        } catch (error) {
            console.warn('Could not save settings:', error);
        }
    }

    applyLoadedSettings() {
        const s = this.settings || {};

        if (typeof s.showCoolingTarget === 'boolean') {
            this.showCoolingTarget = s.showCoolingTarget;
            const el = document.getElementById('showCoolingTarget');
            if (el) el.checked = s.showCoolingTarget;
        }

        if (typeof s.showHeatingTarget === 'boolean') {
            this.showHeatingTarget = s.showHeatingTarget;
            const el = document.getElementById('showHeatingTarget');
            if (el) el.checked = s.showHeatingTarget;
        }

        if (typeof s.runtimeAggregation === 'string') {
            this.runtimeAggregation = s.runtimeAggregation;
            const el = document.querySelector(`input[name="runtimeAggregation"][value="${s.runtimeAggregation}"]`);
            if (el) el.checked = true;
        }

        if (typeof s.correlationAggregation === 'string') {
            this.correlationAggregation = s.correlationAggregation;
            const el = document.querySelector(`input[name="correlationAggregation"][value="${s.correlationAggregation}"]`);
            if (el) el.checked = true;
        }

        if (typeof s.hvacAnalysisRange === 'string') {
            this.hvacAnalysisRange = s.hvacAnalysisRange;
            const el = document.getElementById('hvacAnalysisRange');
            if (el) el.value = s.hvacAnalysisRange;
        }

        if (typeof s.uploadMode === 'string') {
            this.uploadMode = s.uploadMode === 'merge' ? 'merge' : 'replace';
            const el = document.querySelector(`input[name="uploadMode"][value="${this.uploadMode}"]`);
            if (el) el.checked = true;
        }

        if (typeof s.efficiencyAggregation === 'string') {
            this.efficiencyAggregation = s.efficiencyAggregation;
            const el = document.querySelector(`input[name="efficiencyAggregation"][value="${s.efficiencyAggregation}"]`);
            if (el) el.checked = true;
        }

        if (typeof s.efficiencyMode === 'string') {
            this.efficiencyMode = s.efficiencyMode;
            const el = document.querySelector(`input[name="efficiencyMode"][value="${s.efficiencyMode}"]`);
            if (el) el.checked = true;
        }

        if (typeof s.efficiencyNormalization === 'string') {
            this.efficiencyNormalization = s.efficiencyNormalization;
            const el = document.querySelector(`input[name="efficiencyNormalization"][value="${s.efficiencyNormalization}"]`);
            if (el) el.checked = true;
        }

        if (typeof s.efficiencyBaseTempF === 'number' && Number.isFinite(s.efficiencyBaseTempF)) {
            this.efficiencyBaseTempF = s.efficiencyBaseTempF;
        }
        this.updateEfficiencyBaseInput();
    }

    // Reflect the canonical °F base temp into the input using the active unit.
    updateEfficiencyBaseInput() {
        const el = document.getElementById('efficiencyBaseTemp');
        if (!el) return;
        const display = this.temperatureUnit === 'F'
            ? this.efficiencyBaseTempF
            : (this.efficiencyBaseTempF - 32) * 5 / 9;
        el.value = Math.round(display * 10) / 10;
        const unitLabel = document.getElementById('efficiencyBaseUnit');
        if (unitLabel) unitLabel.textContent = this.temperatureUnit === 'F' ? '°F' : '°C';
    }

    async persistCurrentData() {
        if (!this.data.length || this.restoringFromStorage) {
            this.restoringFromStorage = false;
            this.updateClearSavedDataButton();
            return;
        }

        try {
            const payload = await this.buildPersistPayload();
            localStorage.setItem(this.storageKey, payload);
        } catch (error) {
            console.warn('Could not save uploaded data for next visit:', error);
            this.showError('Unable to save dataset to browser storage. Your data is still available for this session.');
            try {
                localStorage.removeItem(this.storageKey);
            } catch (_) { /* ignore */ }
        }

        this.updateClearSavedDataButton();
    }

    async buildPersistPayload() {
        const serialized = this.data.map(record => ({
            ...record,
            timestamp: new Date(record.timestamp).toISOString()
        }));

        const basePayload = {
            version: 2,
            savedAt: new Date().toISOString(),
            recordCount: serialized.length
        };

        if (typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined') {
            const compressed = await this.gzipToBase64(JSON.stringify(serialized));
            return JSON.stringify({
                ...basePayload,
                encoding: 'gzip-base64',
                data: compressed
            });
        }

        return JSON.stringify({
            ...basePayload,
            encoding: 'json',
            data: serialized
        });
    }

    async restorePersistedData() {
        let payload;
        try {
            payload = localStorage.getItem(this.storageKey);
        } catch (error) {
            console.warn('Could not access saved data:', error);
            return;
        }

        if (!payload) {
            this.updateClearSavedDataButton();
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(payload);
        } catch (error) {
            console.warn('Saved data was corrupt and will be cleared:', error);
            this.clearPersistedData();
            return;
        }

        if (!parsed) {
            this.clearPersistedData();
            return;
        }

        this.updateClearSavedDataButton();

        if (this.isProcessing) return;

        try {
            if (parsed.version === 2) {
                const restoredData = await this.restoreVersionTwoPayload(parsed);
                if (!restoredData.length) {
                    throw new Error('Saved data is empty.');
                }

                this.restoringFromStorage = true;
                this.showLoading(true);
                this.hideError();
                this.isProcessing = true;
                this.data = this.sortDataByTimestamp(restoredData);
                this.filteredData = [...this.data];
                this.parseStats = null;
                this.hideValidationWarning();
                this.updateAIDataPreview();
                this.updateAIActionState();
                this.updateClearSavedDataButton();
                this.prepareChartData();
                return;
            }

            if (parsed.version === 1 && typeof parsed.text === 'string' && parsed.text.trim()) {
                this.restoringFromStorage = true;
                this.showLoading(true);
                this.hideError();
                this.isProcessing = true;
                if (this.dataWorker) {
                    this.dataWorker.postMessage({
                        type: 'parseJSONL',
                        data: { text: parsed.text }
                    });
                } else {
                    this.data = this.parseJSONL(parsed.text);
                    this.prepareChartDataFallback();
                }
                return;
            } else {
                throw new Error('Saved data format is not supported.');
            }
        } catch (error) {
            console.warn('Failed to restore saved data:', error);
            this.restoringFromStorage = false;
            this.isProcessing = false;
            this.showLoading(false);
            this.clearPersistedData();
        }
    }

    async restoreVersionTwoPayload(payload) {
        if (payload.encoding === 'json' && Array.isArray(payload.data)) {
            return this.normalizeRestoredRecords(payload.data);
        }

        if (payload.encoding === 'gzip-base64' && typeof payload.data === 'string') {
            const json = await this.gunzipFromBase64(payload.data);
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) {
                throw new Error('Compressed saved data is invalid.');
            }
            return this.normalizeRestoredRecords(parsed);
        }

        throw new Error('Unsupported saved data encoding.');
    }

    normalizeRestoredRecords(records) {
        return records
            .map(record => ({
                ...record,
                timestamp: new Date(record.timestamp || record.interval_start)
            }))
            .filter(record => !Number.isNaN(record.timestamp.getTime()));
    }

    async gzipToBase64(text) {
        const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
        const compressed = await new Response(stream).arrayBuffer();
        return this.arrayBufferToBase64(compressed);
    }

    async gunzipFromBase64(base64) {
        const compressed = this.base64ToArrayBuffer(base64);
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).text();
    }

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    clearPersistedData() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.warn('Could not clear saved data:', error);
        }
        this.clearSavedAIAnalysis();
        this.updateClearSavedDataButton();
    }

    hasPersistedData() {
        try {
            return !!localStorage.getItem(this.storageKey);
        } catch (error) {
            return false;
        }
    }

    updateClearSavedDataButton() {
        const button = document.getElementById('clearSavedData');
        if (!button) return;
        button.style.display = this.hasPersistedData() ? 'inline-block' : 'none';
        this.updateDownloadButton();
    }

    updateDownloadButton() {
        const button = document.getElementById('downloadData');
        if (!button) return;
        button.style.display = this.data.length > 0 ? 'inline-block' : 'none';
    }

    downloadData() {
        if (!this.data.length) {
            this.showError('There is no data to download yet. Upload a file or try the sample data first.');
            return;
        }

        const jsonl = this.data
            .map(record => {
                const { timestamp, ...rest } = record;
                return JSON.stringify(rest);
            })
            .join('\n');

        const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
        const url = URL.createObjectURL(blob);
        const stamp = new Date().toISOString().slice(0, 10);
        const link = document.createElement('a');
        link.href = url;
        link.download = `nest-hvac-runtime-${stamp}.jsonl`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async loadSampleData() {
        if (this.isProcessing) return;

        this.mergeOnNextParse = false;
        this.hideUploadNotice();

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

    async handleUploadFiles(files, source = 'file') {
        if (!files?.length || this.isProcessing) return;

        this.showLoading(true);
        this.hideError();
        this.hideUploadNotice();
        this.isProcessing = true;
        this.updateProgressStep('parsing', 'Discovering upload contents...');
        this.uploadWarnings = [];

        try {
            const uploadInput = await this.prepareUploadInput(files, source);
            const hasExistingData = this.data.length > 0;
            this.mergeOnNextParse = this.uploadMode === 'merge' && hasExistingData;
            this.uploadWarnings = uploadInput.warnings || [];

            if (this.dataWorker) {
                this.dataWorker.postMessage({
                    type: 'parseJSONL',
                    data: { text: uploadInput.text }
                });
            } else {
                // Fallback for browsers without Worker support
                this.data = this.parseJSONL(uploadInput.text);
                this.data = this.mergeOnNextParse ? this.mergeWithExistingData(this.data) : this.sortDataByTimestamp(this.data);
                this.prepareChartDataFallback();
            }
            
        } catch (error) {
            this.showError(error.message);
            this.showLoading(false);
            this.isProcessing = false;
            this.mergeOnNextParse = false;
            this.uploadWarnings = [];
        }
    }

    validateFile(file) {
        const maxFileSize = 100 * 1024 * 1024; // 100MB
        
        // Check file size
        if (file.size > maxFileSize) {
            return `File is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 100MB.`;
        }
        
        // Check file extension
        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith('.jsonl') && !fileName.endsWith('.json') && !fileName.endsWith('.zip')) {
            return `Invalid file format. Expected .jsonl or .zip file, but got ${file.name}. Please upload a file exported from Google Takeout containing your Nest HVAC runtime data.`;
        }
        
        // Warn if uploading a .json file (usually wrong format)
        if (fileName.endsWith('.json') && !fileName.endsWith('.jsonl')) {
            return `You selected a .json file, but this tool requires a .jsonl file (JSON Lines format). If you exported from Google Takeout, look for the file named "HvacRuntime.jsonl" in the Nest data folder.`;
        }
        
        return null; // No validation error
    }

    async prepareUploadInput(files, source) {
        const validFiles = files.filter(file => file && file.size > 0);
        if (!validFiles.length) {
            throw new Error('No readable files were found in your upload.');
        }

        const validationErrors = validFiles
            .map(file => this.validateFile(file))
            .filter(Boolean);
        if (validationErrors.length === validFiles.length) {
            throw new Error(validationErrors[0]);
        }

        const zipFiles = validFiles.filter(file => file.name.toLowerCase().endsWith('.zip'));
        if (zipFiles.length > 1) {
            throw new Error('Please upload one zip archive at a time.');
        }
        if (zipFiles.length === 1 && validFiles.length > 1) {
            throw new Error('Upload a zip archive by itself, or upload files/folders without a zip.');
        }

        if (zipFiles.length === 1) {
            this.updateProgressStep('parsing', 'Extracting zip archive...');
            return this.prepareZipUploadInput(zipFiles[0]);
        }

        this.updateProgressStep('parsing', source === 'folder' || validFiles.length > 1 ? 'Reading folder contents...' : 'Reading uploaded file...');
        return this.prepareFileListUploadInput(validFiles);
    }

    async prepareFileListUploadInput(files) {
        const jsonlCandidates = files.filter(file => file.name.toLowerCase().endsWith('.jsonl'));
        const unsupportedFiles = files.filter(file => !file.name.toLowerCase().endsWith('.jsonl'));

        if (!jsonlCandidates.length) {
            throw new Error('No .jsonl data files were found. Upload the Nest HVAC runtime JSONL file (often named HvacRuntime.jsonl).');
        }

        const prioritized = this.prioritizeRuntimeFiles(jsonlCandidates);
        const textParts = [];

        for (const file of prioritized) {
            const text = await this.readFile(file);
            if (typeof text === 'string' && text.trim()) {
                textParts.push(text.trim());
            }
        }

        if (!textParts.length) {
            throw new Error('No readable JSONL content was found in the selected files.');
        }

        return {
            text: textParts.join('\n'),
            warnings: this.buildUnsupportedFileWarnings(unsupportedFiles)
        };
    }

    async prepareZipUploadInput(zipFile) {
        if (!window.JSZip) {
            throw new Error('Zip support is unavailable because JSZip failed to load. Check your connection and try again.');
        }

        const zip = await window.JSZip.loadAsync(await this.readFileAsArrayBuffer(zipFile));
        const entries = [];
        zip.forEach((relativePath, entry) => {
            if (!entry.dir) {
                entries.push(entry);
            }
        });

        const jsonlEntries = entries.filter(entry => entry.name.toLowerCase().endsWith('.jsonl'));
        if (!jsonlEntries.length) {
            throw new Error('No .jsonl files were found in the zip archive. Use a Google Takeout archive that contains Nest HVAC runtime JSONL data.');
        }

        const prioritized = this.prioritizeRuntimeFiles(jsonlEntries);
        const textParts = [];

        for (const entry of prioritized) {
            const text = await entry.async('string');
            if (text && text.trim()) {
                textParts.push(text.trim());
            }
        }

        if (!textParts.length) {
            throw new Error('No readable JSONL content was found in the zip archive.');
        }

        const unsupported = entries.filter(entry => !entry.name.toLowerCase().endsWith('.jsonl'));
        return {
            text: textParts.join('\n'),
            warnings: this.buildUnsupportedFileWarnings(unsupported.map(entry => ({ name: entry.name })))
        };
    }

    prioritizeRuntimeFiles(files) {
        const rank = (name) => {
            const lower = name.toLowerCase();
            if (lower.endsWith('hvacruntime.jsonl')) return 0;
            if (lower.includes('hvac') && lower.includes('runtime')) return 1;
            return 2;
        };
        return [...files].sort((a, b) => rank(a.name) - rank(b.name));
    }

    buildUnsupportedFileWarnings(files) {
        if (!files.length) return [];
        const preview = files.slice(0, 4).map(file => file.name).join(', ');
        const more = files.length > 4 ? ` (+${files.length - 4} more)` : '';
        return [`Ignored unsupported files: ${preview}${more}`];
    }

    mergeWithExistingData(incomingData) {
        const deduped = new Map();
        const addRecord = (record) => {
            const key = this.getRecordDedupeKey(record);
            deduped.set(key, record);
        };

        this.data.forEach(addRecord);
        incomingData.forEach(addRecord);
        return this.sortDataByTimestamp(Array.from(deduped.values()));
    }

    getRecordDedupeKey(record) {
        const source = record?.interval_start || record?.timestamp;
        const date = new Date(source);
        if (Number.isNaN(date.getTime())) {
            return JSON.stringify(record);
        }
        return date.toISOString();
    }

    sortDataByTimestamp(records) {
        return [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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
        this.persistCurrentData();

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
                this.showValidationWarning(); // Show warning if there were skipped lines
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

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file as binary data'));
            reader.readAsArrayBuffer(file);
        });
    }

    showValidationWarning() {
        if (!this.parseStats || (this.parseStats.invalidJsonLines === 0 && this.parseStats.missingFieldsLines === 0)) {
            this.hideValidationWarning();
            return;
        }

        const { invalidJsonLines, missingFieldsLines } = this.parseStats;
        const warningDiv = document.getElementById('validationWarning');
        const detailsDiv = document.getElementById('validationWarningDetails');
        
        if (!warningDiv || !detailsDiv) return;
        
        let details = [];
        if (invalidJsonLines > 0) {
            details.push(`${invalidJsonLines} line(s) with invalid JSON format`);
        }
        if (missingFieldsLines > 0) {
            details.push(`${missingFieldsLines} line(s) missing required fields`);
        }
        
        detailsDiv.innerHTML = `
            <p><strong>Skipped invalid records:</strong></p>
            <ul>
                ${details.map(d => `<li>${d}</li>`).join('')}
            </ul>
            <p style="font-size: 0.85rem; color: #555; margin-top: 8px;">
                These lines were excluded from the analysis. The remaining ${this.data.length.toLocaleString()} valid records are displayed below.
            </p>
        `;
        
        warningDiv.style.display = 'block';
    }

    hideValidationWarning() {
        const warningDiv = document.getElementById('validationWarning');
        if (warningDiv) {
            warningDiv.style.display = 'none';
        }
    }

    parseJSONL(text) {
        const lines = text.trim().split('\n');
        const data = [];
        let emptyLines = 0;
        let invalidJsonLines = 0;
        let missingFieldsLines = 0;

        for (let i = 0; i < lines.length; i++) {
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
                
                // Validate required fields
                if (record.interval_start && record.indoor_temp !== undefined && record.outdoor_temp !== undefined && record.outdoor_temp !== null) {
                    record.timestamp = new Date(record.interval_start);
                    data.push(record);
                } else {
                    missingFieldsLines++;
                }
            } catch (error) {
                invalidJsonLines++;
                console.warn(`Error parsing line ${i + 1}:`, error);
            }
        }

        // Store stats for warning display
        this.parseStats = {
            invalidJsonLines,
            missingFieldsLines,
            emptyLines
        };

        // Check if we got any valid data
        if (data.length === 0) {
            const errorParts = [];
            
            if (invalidJsonLines > 0) {
                errorParts.push(`${invalidJsonLines} line(s) with invalid JSON`);
            }
            if (missingFieldsLines > 0) {
                errorParts.push(`${missingFieldsLines} line(s) missing required fields`);
            }
            
            let errorMsg;
            if (emptyLines > 0 && invalidJsonLines === 0 && missingFieldsLines === 0) {
                errorMsg = 'The file is empty or contains only blank lines. Please make sure you selected the correct HVAC runtime data file from Google Takeout.';
            } else if (errorParts.length > 0) {
                errorMsg = `No valid HVAC runtime records found. Issues: ${errorParts.join(', ')}. The file should contain lines with fields: interval_start, indoor_temp, outdoor_temp, and other HVAC runtime data.`;
            } else {
                errorMsg = 'No valid data found in file. Make sure you uploaded a Nest HVAC runtime data file from Google Takeout.';
            }
            
            throw new Error(errorMsg);
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
        this.createEfficiencyChart();
    }

    createChartsProgressively() {
        this.destroyExistingCharts();
        const dataToUse = this.getFilteredTimeSeriesData();
        
        const charts = [
            { name: 'Temperature Chart', method: () => this.createTemperatureChart(dataToUse) },
            { name: 'Target Chart', method: () => this.createTargetChart(dataToUse) },
            { name: 'Humidity Chart', method: () => this.createHumidityChart(dataToUse) },
            { name: 'Runtime Chart', method: () => this.createRuntimeChart(dataToUse) },
            { name: 'Correlation Chart', method: () => this.createCorrelationChart(dataToUse) },
            { name: 'Efficiency Chart', method: () => this.createEfficiencyChart() }
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
        const coolingTargetData = [];
        const heatingTargetData = [];

        for (let i = 0; i < timeSeriesData.length; i++) {
            const d = timeSeriesData[i];
            indoorTempData.push({ x: d.x, y: d.indoorTemp });
            outdoorTempData.push({ x: d.x, y: d.outdoorTemp });
            coolingTargetData.push({ x: d.x, y: d.coolingTarget });
            heatingTargetData.push({ x: d.x, y: d.heatingTarget });
        }

        const datasets = [
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
        ];

        if (this.showCoolingTarget) {
            datasets.push({
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
            });
        }

        if (this.showHeatingTarget) {
            datasets.push({
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
            });
        }

        this.charts.temperature = new Chart(document.getElementById('temperatureChart'), {
            type: 'line',
            data: {
                datasets
            },
            options: this.getCommonChartOptions(`Temperature (${this.temperatureUnit === 'F' ? '°F' : '°C'})`),
            plugins: [temperatureBackgroundPlugin, this.createAnomalyMarkerPlugin()]
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
            },
            plugins: [this.createAnomalyMarkerPlugin()]
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
                                enabled: false,
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

    // ===== HVAC Efficiency (weather-normalized runtime) =====

    getEfficiencyBaseTempC() {
        const f = Number(this.efficiencyBaseTempF);
        const base = Number.isFinite(f) ? f : 65;
        return (base - 32) * 5 / 9;
    }

    getEfficiencyRawData() {
        return this.filteredData.length > 0 ? this.filteredData : this.data;
    }

    // Local mirror of DataProcessor.aggregateEfficiencyData for small/no-worker paths.
    aggregateEfficiencyLocal(rawData, aggregationType, baseTempC) {
        const buckets = new Map();
        const bucketKey = (date) => {
            const d = new Date(date);
            switch (aggregationType) {
                case 'hourly':
                    d.setMinutes(0, 0, 0);
                    return d.getTime();
                case 'weekly': {
                    d.setDate(d.getDate() - d.getDay());
                    d.setHours(0, 0, 0, 0);
                    return d.getTime();
                }
                case 'daily':
                default:
                    d.setHours(0, 0, 0, 0);
                    return d.getTime();
            }
        };

        for (const record of rawData) {
            if (!record) continue;
            const rawOutdoor = record.outdoor_temp;
            if (rawOutdoor == null || rawOutdoor === '') continue;
            const outdoor = Number(rawOutdoor);
            if (!Number.isFinite(outdoor)) continue;
            const start = record.timestamp ? new Date(record.timestamp) : new Date(record.interval_start);
            if (Number.isNaN(start.getTime())) continue;

            let intervalHours = 0.25;
            if (record.interval_end && record.interval_start) {
                const diffH = (new Date(record.interval_end).getTime() - new Date(record.interval_start).getTime()) / 3600000;
                if (Number.isFinite(diffH) && diffH > 0 && diffH <= 24) intervalHours = diffH;
            }
            const dayFraction = intervalHours / 24;
            const coolingHours = Math.max(0, Number(record.cooling_time) || 0) / 3600;
            const heatingHours = Math.max(0, Number(record.heating_time) || 0) / 3600;
            const cdd = Math.max(outdoor - baseTempC, 0) * dayFraction;
            const hdd = Math.max(baseTempC - outdoor, 0) * dayFraction;

            const key = bucketKey(start);
            if (!buckets.has(key)) {
                buckets.set(key, { x: new Date(key), coolingHours: 0, heatingHours: 0, cdd: 0, hdd: 0, count: 0 });
            }
            const b = buckets.get(key);
            b.coolingHours += coolingHours;
            b.heatingHours += heatingHours;
            b.cdd += cdd;
            b.hdd += hdd;
            b.count++;
        }
        return Array.from(buckets.values()).sort((a, b) => a.x - b.x);
    }

    // Minimum degree-days a bucket must have before its ratio is meaningful.
    getEfficiencyMinDegreeDays() {
        switch (this.efficiencyAggregation) {
            case '15min': return 0.1;
            case 'hourly': return 0.25;
            case 'weekly': return 3;
            case 'daily':
            default: return 1;
        }
    }

    // Pick the mode + ratio (runtime hours per degree-day) for a bucket.
    selectEfficiencyRatio(bucket) {
        const minDD = this.getEfficiencyMinDegreeDays();
        const cooling = bucket.cdd >= minDD ? { mode: 'cooling', ratio: bucket.coolingHours / bucket.cdd, runtimeHours: bucket.coolingHours, degreeDays: bucket.cdd } : null;
        const heating = bucket.hdd >= minDD ? { mode: 'heating', ratio: bucket.heatingHours / bucket.hdd, runtimeHours: bucket.heatingHours, degreeDays: bucket.hdd } : null;

        if (this.efficiencyMode === 'cooling') return cooling;
        if (this.efficiencyMode === 'heating') return heating;
        // Auto: whichever mode actually ran more during the bucket.
        if (cooling && heating) return bucket.coolingHours >= bucket.heatingHours ? cooling : heating;
        return cooling || heating;
    }

    percentile(sortedValues, p) {
        if (!sortedValues.length) return null;
        const idx = (sortedValues.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sortedValues[lo];
        return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
    }

    // Convert per-bucket ratios into 0–100 scores (higher = more efficient).
    computeEfficiencyScores(buckets) {
        const points = [];
        for (const bucket of buckets) {
            const selected = this.selectEfficiencyRatio(bucket);
            if (!selected || !Number.isFinite(selected.ratio)) continue;
            points.push({ x: bucket.x, ...selected });
        }
        if (!points.length) return [];

        let bestRatio;
        let worstRatio;
        if (this.efficiencyNormalization === 'fixed') {
            // Estimated absolute anchors (runtime hours per °C·degree-day).
            // Documented as an estimate; comparable over time and across homes.
            bestRatio = 0.15;
            worstRatio = 1.2;
        } else {
            const ratios = points.map(p => p.ratio).sort((a, b) => a - b);
            bestRatio = this.percentile(ratios, 0.10);
            worstRatio = this.percentile(ratios, 0.90);
            if (bestRatio === worstRatio) {
                // Degenerate spread (e.g. one bucket) — show a neutral score.
                return points.map(p => ({ ...p, score: 100 }));
            }
        }

        const span = worstRatio - bestRatio;
        return points.map(p => {
            let score = span > 0 ? (100 * (worstRatio - p.ratio) / span) : 100;
            score = Math.max(0, Math.min(100, score));
            return { ...p, score: Math.round(score) };
        });
    }

    createEfficiencyChart() {
        const rawData = this.getEfficiencyRawData();
        const baseTempC = this.getEfficiencyBaseTempC();

        if (this.dataWorker && rawData.length > 1000) {
            this.dataWorker.postMessage({
                type: 'aggregateEfficiency',
                data: {
                    efficiencyRawData: rawData,
                    aggregationType: this.efficiencyAggregation,
                    baseTempC: baseTempC
                }
            });
        } else {
            const buckets = this.aggregateEfficiencyLocal(rawData, this.efficiencyAggregation, baseTempC);
            this.updateEfficiencyChartWithData(buckets, this.efficiencyAggregation);
        }
    }

    updateEfficiencyChart() {
        this.createEfficiencyChart();
    }

    updateEfficiencyChartWithData(buckets, aggregationType) {
        const canvas = document.getElementById('efficiencyChart');
        if (!canvas) return;

        const scored = this.computeEfficiencyScores(buckets);
        this.updateEfficiencyEmptyState(scored.length === 0);

        const unitSymbol = this.temperatureUnit === 'F' ? '°F' : '°C';
        // Degree-days are computed in °C internally; scale for display in °F.
        const ddScale = this.temperatureUnit === 'F' ? 9 / 5 : 1;
        const coolingColor = '#45b7d1';
        const heatingColor = '#f39c12';

        const pointData = scored.map(p => ({ x: p.x, y: p.score }));
        const pointColors = scored.map(p => p.mode === 'heating' ? heatingColor : coolingColor);

        if (this.charts.efficiency) {
            this.charts.efficiency.destroy();
        }

        const self = this;
        this.charts.efficiency = new Chart(canvas, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Efficiency Score (0–100, higher is better)',
                    data: pointData,
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.15)',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: pointColors,
                    pointBorderColor: pointColors,
                    tension: 0.25,
                    spanGaps: true,
                    fill: true
                }]
            },
            options: {
                ...this.getCommonChartOptions('Efficiency Score'),
                scales: {
                    ...this.getCommonChartOptions('Efficiency Score').scales,
                    y: {
                        ...this.getCommonChartOptions('Efficiency Score').scales.y,
                        beginAtZero: true,
                        min: 0,
                        max: 100,
                        title: { display: true, text: 'Efficiency Score (0–100)', font: { size: 12, weight: 'bold' } }
                    }
                },
                plugins: {
                    ...this.getCommonChartOptions('Efficiency Score').plugins,
                    tooltip: {
                        ...this.getCommonChartOptions('Efficiency Score').plugins.tooltip,
                        callbacks: {
                            title: function(items) {
                                const d = new Date(items[0].parsed.x);
                                return d.toLocaleDateString();
                            },
                            label: function(item) {
                                const p = scored[item.dataIndex];
                                if (!p) return '';
                                const ratioDisplay = (p.ratio / ddScale).toFixed(2);
                                const ddDisplay = (p.degreeDays * ddScale).toFixed(1);
                                return [
                                    `Score: ${p.score}/100`,
                                    `Mode: ${p.mode === 'heating' ? 'Heating' : 'Cooling'}`,
                                    `Runtime: ${p.runtimeHours.toFixed(2)} h`,
                                    `Ratio: ${ratioDisplay} runtime h / ${unitSymbol}-degree-day (lower is better)`,
                                    `Degree-days: ${ddDisplay} ${unitSymbol}-days`
                                ];
                            }
                        }
                    }
                }
            }
        });
    }

    updateEfficiencyEmptyState(isEmpty) {
        const note = document.getElementById('efficiencyEmpty');
        if (note) note.style.display = isEmpty ? 'block' : 'none';
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
        if (celsius == null || celsius === '' || !Number.isFinite(Number(celsius))) return null;
        return (Number(celsius) * 9/5) + 32;
    }

    fahrenheitToCelsius(fahrenheit) {
        if (fahrenheit == null || fahrenheit === '' || !Number.isFinite(Number(fahrenheit))) return null;
        return (Number(fahrenheit) - 32) * 5/9;
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
        // Nest data is in Celsius, convert if needed. Preserve null/missing
        // values so charts render a gap instead of a bogus 32°F point.
        if (temp == null || temp === '' || !Number.isFinite(Number(temp))) return null;
        return this.temperatureUnit === 'F' ? this.celsiusToFahrenheit(temp) : Number(temp);
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
        this.updateEfficiencyBaseInput();
    }

    getCommonChartOptions(yAxisLabel) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements, chart) => {
                this.handleAnomalyClick(event, chart);
            },
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
                            enabled: false,
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
        this.updateAIDataPreview();
        this.updateAIActionState();
        
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
        this.hideUploadNotice();
        const error = document.getElementById('error');
        error.textContent = message;
        error.classList.add('show');
    }

    hideError() {
        const error = document.getElementById('error');
        error.classList.remove('show');
    }

    showUploadNotice(message) {
        const notice = document.getElementById('uploadNotice');
        if (!notice || !message) return;
        notice.textContent = message;
        notice.classList.add('show');
    }

    hideUploadNotice() {
        const notice = document.getElementById('uploadNotice');
        if (!notice) return;
        notice.classList.remove('show');
        notice.textContent = '';
    }

    showSections() {
        document.getElementById('filterSection').style.display = 'block';
        document.getElementById('statsSection').style.display = 'grid';
        document.getElementById('chartsSection').style.display = 'block';
        this.setUploadCollapsed(true);
    }

    buildUploadSummaryText() {
        const count = this.data.length;
        if (!count) return 'No data loaded.';
        const first = this.data[0].timestamp;
        const last = this.data[this.data.length - 1].timestamp;
        return `✅ ${count.toLocaleString()} records loaded · ${this.formatAnalysisDate(first)} – ${this.formatAnalysisDate(last)}`;
    }

    setUploadCollapsed(collapsed) {
        this.uploadCollapsed = collapsed;
        const section = document.getElementById('uploadSection');
        const body = document.getElementById('uploadSectionBody');
        const summary = document.getElementById('uploadSummary');
        const toggle = document.getElementById('toggleUploadSection');
        const hasData = this.data.length > 0;

        if (!section || !body || !summary || !toggle) return;

        // The toggle only makes sense once there is data to hide.
        toggle.style.display = hasData ? 'inline-block' : 'none';

        if (collapsed && hasData) {
            body.style.display = 'none';
            summary.style.display = 'flex';
            summary.innerHTML = '';
            const label = document.createElement('span');
            label.textContent = this.buildUploadSummaryText();
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'upload-summary-edit';
            edit.textContent = 'Change file / settings';
            edit.addEventListener('click', () => this.setUploadCollapsed(false));
            summary.appendChild(label);
            summary.appendChild(edit);
            toggle.textContent = 'Show';
        } else {
            this.uploadCollapsed = false;
            body.style.display = 'block';
            summary.style.display = 'none';
            toggle.textContent = 'Hide';
        }
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
        this.updateAIDataPreview();
        this.updateAIActionState();
    }

    resetDateFilter() {
        this.filteredData = [...this.data];
        this.setupDateFilter(); // Reset date inputs to full range
        this.hideError();
        this.updateStats();
        this.createCharts();
        this.updateAIDataPreview();
        this.updateAIActionState();
        
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
        this.updateAIDataPreview();
        this.updateAIActionState();
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    // Chart.js zoom plugin is automatically registered when loaded via CDN
    // No manual registration needed for CDN loaded plugins
    
    new NestDataViewer();
});
