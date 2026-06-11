(function (globalScope) {
    /**
     * @typedef {Object} EventSummary
     * @property {string} mode
     * @property {string} startTime
     * @property {string} endTime
     * @property {number} durationMinutes
     * @property {number|null} startIndoorTemp
     * @property {number|null} endIndoorTemp
     * @property {number|null} startSetpoint
     * @property {number|null} endSetpoint
     * @property {number|null} avgOutdoorTemp
     * @property {number|null} records
     */

    /**
     * @param {EventSummary} eventSummary
     * @returns {string}
     */
    function buildEventExplanationPrompt(eventSummary) {
        return [
            'You are helping explain a thermostat HVAC event in plain English.',
            'Use only the provided information.',
            'Requirements:',
            '- Explain what happened.',
            '- Explain likely reasons based on the data.',
            '- Clearly separate facts from assumptions.',
            '- Avoid speculation and never invent missing data.',
            '- Keep response concise and readable (max 6 bullet points).',
            '',
            'Event data:',
            JSON.stringify(eventSummary, null, 2),
            '',
            'Response format:',
            'Facts:',
            '- ...',
            'Assumptions (if any):',
            '- ...',
            'Summary sentence:',
            '- ...'
        ].join('\n');
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.buildEventExplanationPrompt = buildEventExplanationPrompt;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            buildEventExplanationPrompt
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
