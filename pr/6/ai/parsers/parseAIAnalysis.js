(function (globalScope) {
    /**
     * Extracts an optional anomalies JSON block from an AI markdown response.
     *
     * The HVAC analysis prompt asks the model to append a fenced ```json block
     * containing `{ "anomalies": [...] }` after its markdown. This parser pulls
     * that block out (if present), validates/normalizes the anomalies, and
     * returns the markdown with the block removed so it can be rendered cleanly.
     *
     * @param {string} response Raw AI response text.
     * @returns {{ markdown: string, anomalies: Array<Object> }}
     */
    function parseAIAnalysis(response) {
        const text = response == null ? '' : String(response);
        const empty = { markdown: text.trim(), anomalies: [] };
        if (!text.trim()) return empty;

        // Find fenced ```json ... ``` blocks; use the last one that parses into
        // an object containing an `anomalies` array.
        const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
        let match;
        let chosen = null;
        while ((match = fencePattern.exec(text)) !== null) {
            const body = match[1].trim();
            if (!body) continue;
            let parsed;
            try {
                parsed = JSON.parse(body);
            } catch (_error) {
                continue;
            }
            if (parsed && Array.isArray(parsed.anomalies)) {
                chosen = { parsed, index: match.index, length: match[0].length };
            }
        }

        if (!chosen) {
            return empty;
        }

        const anomalies = normalizeAnomalies(chosen.parsed.anomalies);

        // Remove the chosen JSON block from the markdown.
        const before = text.slice(0, chosen.index);
        const after = text.slice(chosen.index + chosen.length);
        const markdown = (before + after)
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return { markdown, anomalies };
    }

    function normalizeAnomalies(rawList) {
        const validSeverities = ['high', 'medium', 'low'];
        const result = [];

        rawList.forEach((raw) => {
            if (!raw || typeof raw !== 'object') return;

            const startMs = toTime(raw.start);
            const endMsRaw = toTime(raw.end);
            if (startMs === null) return;

            // Allow a missing/invalid end: treat as a point-in-time marker.
            const endMs = endMsRaw === null ? startMs : endMsRaw;

            const severityRaw = String(raw.severity || '').toLowerCase();
            const severity = validSeverities.includes(severityRaw) ? severityRaw : 'medium';

            const title = String(raw.title || '').trim() || 'Anomaly';
            const detail = String(raw.detail || '').trim();

            const lo = Math.min(startMs, endMs);
            const hi = Math.max(startMs, endMs);

            result.push({
                start: new Date(lo).toISOString(),
                end: new Date(hi).toISOString(),
                startMs: lo,
                endMs: hi,
                severity,
                title,
                detail
            });
        });

        return result.sort((a, b) => a.startMs - b.startMs);
    }

    function toTime(value) {
        if (value === null || value === undefined) return null;
        const ms = new Date(value).getTime();
        return Number.isFinite(ms) ? ms : null;
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.parseAIAnalysis = parseAIAnalysis;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            parseAIAnalysis
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
