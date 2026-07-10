const test = require('node:test');
const assert = require('node:assert/strict');

globalThis.NestAI = globalThis.NestAI || {};
Object.assign(globalThis.NestAI, require('../ai/prompts/buildHVACAnalysisPrompt'));
Object.assign(globalThis.NestAI, require('../ai/GeminiProvider'));

const { AIService } = require('../ai/AIService');

test('AIService requires API key', async () => {
    const storage = {
        getItem: () => '',
        setItem: () => {},
        removeItem: () => {}
    };

    const service = new AIService({
        localStorage: storage,
        providerFactory: () => ({ analyze: async () => 'unused' })
    });

    await assert.rejects(() => service.analyzePrompt('hello'), /No Gemini API key configured/);
});

test('AIService caches repeated prompts', async () => {
    const store = new Map();
    let callCount = 0;

    const service = new AIService({
        localStorage: {
            getItem: (key) => store.get(key) || '',
            setItem: (key, value) => store.set(key, value),
            removeItem: (key) => store.delete(key)
        },
        providerFactory: () => ({
            analyze: async () => {
                callCount += 1;
                return 'cached-output';
            }
        })
    });

    service.saveApiKey('key-12345678901234567890');
    const first = await service.analyzePrompt('hello');
    const second = await service.analyzePrompt('hello');

    assert.equal(first, 'cached-output');
    assert.equal(second, 'cached-output');
    assert.equal(callCount, 1);
});
