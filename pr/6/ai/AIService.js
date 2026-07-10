(function (globalScope) {
    const LOCAL_STORAGE_KEY = 'nestViewer.ai.geminiApiKey';

    class AIService {
        constructor(options = {}) {
            this.localStorage = options.localStorage || globalScope.localStorage;
            this.cache = new Map();
            this.providerName = 'gemini';
            this.debug = options.debug !== undefined ? options.debug : Boolean(globalScope.NEST_DEBUG);
            this.providerFactory = options.providerFactory || ((apiKey) => {
                return new globalScope.NestAI.GeminiProvider(apiKey);
            });
        }

        getApiKey() {
            try {
                return (this.localStorage?.getItem(LOCAL_STORAGE_KEY) || '').trim();
            } catch (_error) {
                return '';
            }
        }

        saveApiKey(apiKey) {
            const key = (apiKey || '').trim();
            if (!key) {
                throw new Error('Please enter a Gemini API key.');
            }
            this.localStorage?.setItem(LOCAL_STORAGE_KEY, key);
        }

        removeApiKey() {
            this.localStorage?.removeItem(LOCAL_STORAGE_KEY);
        }

        hasApiKey() {
            return Boolean(this.getApiKey());
        }

        getRedactedApiKey() {
            const apiKey = this.getApiKey();
            if (!apiKey) return '';
            if (apiKey.length <= 8) return '••••';
            return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
        }

        clearCache() {
            this.cache.clear();
        }

        async analyzePrompt(prompt, options = {}) {
            const apiKey = this.getApiKey();
            if (!apiKey) {
                throw new Error('No Gemini API key configured.');
            }

            const cacheKey = options.cacheKey || `${this.providerName}:${prompt}`;
            if (this.cache.has(cacheKey)) {
                return this.cache.get(cacheKey);
            }

            if (this.debug) {
                this.logDebugRequest(prompt, { cacheKey, ...options });
            }

            const provider = this.providerFactory(apiKey);
            const output = await provider.analyze(prompt, { signal: options.signal });
            this.cache.set(cacheKey, output);
            return output;
        }

        logDebugRequest(prompt, meta = {}) {
            const logger = globalScope.console;
            if (!logger) return;
            const label = `🐞 [NestAI debug] ${this.providerName} request — ${meta.label || meta.cacheKey || 'prompt'}`;
            if (typeof logger.groupCollapsed === 'function') {
                logger.groupCollapsed(label);
            } else {
                logger.log(label);
            }
            if (meta.data !== undefined) {
                logger.log('Summarized data:', meta.data);
            }
            logger.log('Prompt to be sent:\n' + prompt);
            if (typeof logger.groupEnd === 'function') {
                logger.groupEnd();
            }
        }

        async analyzeHVAC(summary, options = {}) {
            const prompt = globalScope.NestAI.buildHVACAnalysisPrompt(summary);
            return this.analyzePrompt(prompt, {
                ...options,
                label: 'HVAC analysis',
                data: summary,
                cacheKey: options.cacheKey || `hvac:${JSON.stringify(summary)}`
            });
        }
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.AIService = AIService;
    globalScope.NestAI.AI_STORAGE_KEY = LOCAL_STORAGE_KEY;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            AIService,
            AI_STORAGE_KEY: LOCAL_STORAGE_KEY
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
