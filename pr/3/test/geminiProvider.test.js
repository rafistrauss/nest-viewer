const test = require('node:test');
const assert = require('node:assert/strict');

const { GeminiProvider } = require('../ai/GeminiProvider');

test('GeminiProvider returns generated text', async () => {
    const provider = new GeminiProvider('key-12345678901234567890', {
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: 'ok' }] } }]
            })
        })
    });

    const output = await provider.analyze('hello');
    assert.equal(output, 'ok');
});

test('GeminiProvider maps invalid key errors', async () => {
    const provider = new GeminiProvider('bad-key-value', {
        fetchImpl: async () => ({
            ok: false,
            status: 403,
            json: async () => ({ error: { message: 'permission denied' } })
        })
    });

    await assert.rejects(() => provider.analyze('hello'), /invalid/i);
});
