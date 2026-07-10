(function (globalScope) {
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function renderInline(text) {
        let html = escapeHtml(text);
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
        return html;
    }

    /**
     * Minimal, dependency-free Markdown renderer for the subset the AI emits:
     * ## headings, - / * bullet lists, **bold**, *italics*, `code`, paragraphs.
     * Output is escaped before formatting, so it is safe to inject as HTML.
     * @param {string} markdown
     * @returns {string} HTML string
     */
    function renderMarkdown(markdown) {
        if (markdown == null) return '';
        const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
        const html = [];
        let listItems = null;

        function flushList() {
            if (listItems && listItems.length) {
                html.push(`<ul>${listItems.join('')}</ul>`);
            }
            listItems = null;
        }

        lines.forEach(rawLine => {
            const line = rawLine.replace(/\s+$/, '');
            const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
            const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);

            if (headingMatch) {
                flushList();
                const level = headingMatch[1].length;
                html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
            } else if (bulletMatch) {
                if (!listItems) listItems = [];
                listItems.push(`<li>${renderInline(bulletMatch[1])}</li>`);
            } else if (line.trim() === '') {
                flushList();
            } else {
                flushList();
                html.push(`<p>${renderInline(line.trim())}</p>`);
            }
        });

        flushList();
        return html.join('\n');
    }

    globalScope.NestAI = globalScope.NestAI || {};
    globalScope.NestAI.renderMarkdown = renderMarkdown;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            ...(module.exports || {}),
            renderMarkdown
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);
