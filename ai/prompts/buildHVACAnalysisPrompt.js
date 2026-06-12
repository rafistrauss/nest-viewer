(function (globalScope) {
    /**
     * @param {Record<string, number|null>} summary
     * @returns {string}
     */
    function buildHVACAnalysisPrompt(summary) {
        return [
            'Analyze this summarized thermostat HVAC performance data.',
            'Do not assume data that is not present.',
            'Notes on the data:',
            '- Temperatures are in the source-native unit (typically Celsius) and are NOT converted; reason in relative terms unless the unit is obvious.',
            '- "weeklyBreakdown" is the most important field: it shows how the system behaved week-by-week. ALWAYS analyze trends over time here before drawing conclusions.',
            '- Compare each week\'s runtime/cycle metrics against that same week\'s "avgOutdoorTemp". High runtime in a mild week is suspicious; high runtime in a hot week may be normal.',
            '- Window-wide aggregates (averages, "maxCoolingCycleMinutes", "coolingIntervalsTempRose", etc.) are summed/averaged across the WHOLE period and can be dominated by a single bad week. Do NOT assume an extreme reflects the current/most-recent state — attribute it to the week(s) it occurred in using "weeklyBreakdown".',
            '- Explicitly state whether any problem appears ongoing or whether it improved/resolved over the period (e.g. an early-period anomaly that normalized in later weeks).',
            '- Interpret runtime relative to outdoor conditions: long cycles in extreme outdoor temps can be normal, while long cycles in mild weather may indicate a problem.',
            '- "avgIndoorMinusCoolingTarget"/"avgIndoorMinusHeatingTarget" show how far the room sits from its setpoint while that mode runs; large persistent deviations suggest the system cannot reach setpoint.',
            '- "coolingIntervalsTempRose"/"heatingIntervalsTempFell" count intervals where the system ran but temperature moved the wrong way (a struggling-system signal).',
            '- "coolingCyclesPerDay"/"heatingCyclesPerDay" are normalized over "actualDataSpanDays"; many short cycles can indicate short-cycling.',
            '- Treat "minIndoorTemp"/"maxIndoorTemp" as extremes that may be outliers; prefer "avgIndoorTemp" for typical conditions.',
            'Requirements:',
            '- Identify unusual patterns.',
            '- Identify possible inefficiencies.',
            '- Identify possible HVAC issues.',
            '- Note time-based trends, including whether issues are ongoing or appear resolved.',
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
