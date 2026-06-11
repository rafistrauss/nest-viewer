(function (globalScope) {
    class AIProvider {
        async analyze(_prompt, _options = {}) {
            throw new Error('AIProvider.analyze must be implemented by subclasses');
        }
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.AIProvider = AIProvider;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            AIProvider
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
