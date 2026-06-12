(function (globalScope) {
    /**
     * @param {Record<string, number|null>} summary
     * @returns {string}
     */
    function buildHVACAnalysisPrompt(summary) {
        return [
            'Analyze this summarized thermostat HVAC performance data.',
            'Do not assume data that is not present.',
            'Requirements:',
            '- Identify unusual patterns.',
            '- Identify possible inefficiencies.',
            '- Identify possible HVAC issues.',
            '- Explain confidence levels.',
            '- Separate observations from hypotheses.',
            '- Avoid certainty when evidence is limited.',
            '',
            'Summarized data:',
            JSON.stringify(summary, null, 2),
            '',
            'Return markdown with this exact structure:',
            '## Observations',
            '- Fact-based findings',
            '',
            '## Possible Issues',
            '- Potential concerns with confidence level',
            '',
            '## Recommendations',
            '- Practical next steps, including when HVAC inspection may be warranted'
        ].join('\n');
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.buildHVACAnalysisPrompt = buildHVACAnalysisPrompt;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            buildHVACAnalysisPrompt
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
