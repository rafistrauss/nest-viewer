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
            `- Temperatures are expressed in ${summary && summary.temperatureUnit ? summary.temperatureUnit : 'the source-native unit'}. Interpret all temperature values, deltas, and per-hour rates in that unit.`,
            '- IMPORTANT context for judging cooling performance: if "avgIndoorMinusCoolingTarget" is small (roughly within 1 degree F, or ~0.5 degree C), the system IS keeping the home at setpoint and is performing well, even if cycles are long. Long continuous run times during hot outdoor weather are normal and expected for a correctly sized system; do NOT treat long cycles alone as a fault.',
            '- Only flag a cooling problem when the evidence converges: e.g. the indoor temperature drifts meaningfully ABOVE the cooling setpoint ("avgIndoorMinusCoolingTarget" clearly positive) AND/OR runtime is high during MILD outdoor weather. A few "coolingIntervalsTempRose" while indoor stays at setpoint is normal noise (sun load, door openings) and is not itself evidence of a failing system.',
            '- "weeklyBreakdown" is the most important field: it shows how the system behaved week-by-week. ALWAYS analyze trends over time here before drawing conclusions.',
            '- Compare each week\'s runtime/cycle metrics against that same week\'s "avgOutdoorTemp". High runtime in a mild week is suspicious; high runtime in a hot week may be normal.',
            '- Window-wide aggregates (averages, "maxCoolingCycleMinutes", "coolingIntervalsTempRose", etc.) are summed/averaged across the WHOLE period and can be dominated by a single hot week. Do NOT assume an extreme reflects the current/most-recent state — attribute it to the week(s) it occurred in using "weeklyBreakdown".',
            '- Explicitly state whether any problem appears ongoing or whether it improved/resolved over the period (e.g. an early-period anomaly that normalized in later weeks).',
            '- "avgIndoorMinusCoolingTarget"/"avgIndoorMinusHeatingTarget" show how far the room sits from its setpoint while that mode runs; large persistent deviations suggest the system cannot reach setpoint.',
            '- "coolingIntervalsTempRose"/"heatingIntervalsTempFell" count intervals where the system ran but temperature moved the wrong way; weigh these against how far indoor sat from setpoint rather than in isolation.',
            '- "coolingCyclesPerDay"/"heatingCyclesPerDay" are normalized over "actualDataSpanDays"; many short cycles can indicate short-cycling.',
            '- Treat "minIndoorTemp"/"maxIndoorTemp" as extremes that may be outliers; prefer "avgIndoorTemp" for typical conditions.',
            '- Calibrate your tone to the evidence: if the home is consistently held at setpoint, lead with the fact that the system appears to be performing well before listing any minor or speculative concerns.',
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
