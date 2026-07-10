const test = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdown } = require('../ai/markdown/renderMarkdown');

test('renderMarkdown converts headings, lists and bold', () => {
    const md = '## Observations\n- First **finding**\n- Second finding\n\nA paragraph.';
    const html = renderMarkdown(md);
    assert.match(html, /<h2>Observations<\/h2>/);
    assert.match(html, /<ul><li>First <strong>finding<\/strong><\/li><li>Second finding<\/li><\/ul>/);
    assert.match(html, /<p>A paragraph\.<\/p>/);
});

test('renderMarkdown escapes HTML to prevent injection', () => {
    const html = renderMarkdown('- <script>alert(1)</script>');
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
});

test('renderMarkdown handles empty and null input', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown(null), '');
});
