(function (globalScope) {
    const GEMINI_MODEL = 'gemini-2.5-flash';

    class GeminiProvider {
        constructor(apiKey, options = {}) {
            this.apiKey = (apiKey || '').trim();
            this.model = options.model || GEMINI_MODEL;
            this.fetchImpl = options.fetchImpl || globalScope.fetch;
        }

        buildUrl() {
            return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
        }

        async analyze(prompt, options = {}) {
            if (!this.apiKey) {
                throw new Error('No Gemini API key configured.');
            }

            if (typeof prompt !== 'string' || !prompt.trim()) {
                throw new Error('Prompt cannot be empty.');
            }

            if (!this.fetchImpl) {
                throw new Error('Fetch API is not available in this environment.');
            }

            const response = await this.fetchImpl(this.buildUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [{ text: prompt }]
                        }
                    ]
                }),
                signal: options.signal
            });

            let payload = null;
            try {
                payload = await response.json();
            } catch (_error) {
                payload = null;
            }

            if (!response.ok) {
                const message = this.mapGeminiError(response.status, payload);
                throw new Error(message);
            }

            const text = this.extractText(payload);
            if (!text) {
                throw new Error('Gemini returned an empty response. Please try again.');
            }

            return text;
        }

        mapGeminiError(statusCode, payload) {
            const rawMessage = payload?.error?.message || '';

            if (statusCode === 400 || statusCode === 401 || statusCode === 403) {
                return 'Your Gemini API key appears to be invalid.';
            }

            if (statusCode === 429) {
                return 'Gemini is currently rate limiting requests. Please try again later.';
            }

            if (statusCode === 413 || /token|context|too long|too large/i.test(rawMessage)) {
                return 'The selected dataset is too large to analyze.';
            }

            if (statusCode >= 500) {
                return 'Gemini is temporarily unavailable. Please try again in a moment.';
            }

            return 'Gemini request failed. Please try again.';
        }

        extractText(payload) {
            const parts = payload?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts)) return '';
            return parts
                .map(part => (typeof part?.text === 'string' ? part.text : ''))
                .filter(Boolean)
                .join('\n')
                .trim();
        }
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.GEMINI_MODEL = GEMINI_MODEL;
    globalScope.NestAI.GeminiProvider = GeminiProvider;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            GEMINI_MODEL,
            GeminiProvider
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
