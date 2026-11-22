import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchVertexWithRetry, safeAccessHeaders, fallbackEnabled } from '../../lib/vertex/tor-extractor.js';

const VERTEX = 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-2.5-flash:generateContent';
const EMBED = 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/text-embedding:predict';
const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { responseMimeType: 'application/json' } });
const options = { method: 'POST', headers: { Authorization: 'Bearer vertex-secret', 'Content-Type': 'application/json' }, body };
const ollamaReply = () => new Response(JSON.stringify({ message: { content: '{"ok":true}' }, done: true, done_reason: 'stop' }), { status: 200 });
const noWait = { wait: async () => {}, random: () => 0, maxAttempts: 1 };
const saved = {};
const keys = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER', 'AI_FALLBACK_MODEL', 'OLLAMA_BASE_URL', 'VERTEX_MODEL'];

describe('fallback after Vertex refuses', () => {
    beforeEach(() => { for (const k of keys) saved[k] = process.env[k]; process.env.AI_PROVIDER = 'vertex'; process.env.AI_FALLBACK_PROVIDER = 'ollama'; process.env.OLLAMA_BASE_URL = 'http://bridge.test:11500'; delete process.env.AI_FALLBACK_MODEL; });
    afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

    test('a Vertex 403 is answered by the fallback, in Gemini shape, without the Vertex token', async () => {
        const calls = [];
        const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return String(url).includes('aiplatform') ? new Response('denied', { status: 403 }) : ollamaReply(); };
        const response = await fetchVertexWithRetry(VERTEX, options, { fetchImpl, ...noWait });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.candidates[0].content.parts[0].text, '{"ok":true}');
        assert.equal(calls.length, 2);
        assert.equal(calls[1].url, 'http://bridge.test:11500/api/chat');
        assert.equal(JSON.stringify(calls[1].init.headers).includes('vertex-secret'), false);
    });

    test('a Vertex network failure falls back too', async () => {
        const fetchImpl = async url => { if (String(url).includes('aiplatform')) throw Object.assign(new Error('offline'), { name: 'TypeError' }); return ollamaReply(); };
        const response = await fetchVertexWithRetry(VERTEX, options, { fetchImpl, ...noWait });
        assert.equal(response.status, 200);
    });

    test('a working Vertex is not replaced', async () => {
        const calls = [];
        const fetchImpl = async url => { calls.push(String(url)); return new Response('{"candidates":[]}', { status: 200 }); };
        const response = await fetchVertexWithRetry(VERTEX, options, { fetchImpl, ...noWait });
        assert.equal(response.status, 200);
        assert.deepEqual(calls, [VERTEX]);
    });

    test('without AI_FALLBACK_PROVIDER the Vertex refusal is returned unchanged', async () => {
        delete process.env.AI_FALLBACK_PROVIDER;
        const calls = [];
        const fetchImpl = async url => { calls.push(String(url)); return new Response('denied', { status: 403 }); };
        const response = await fetchVertexWithRetry(VERTEX, options, { fetchImpl, ...noWait });
        assert.equal(response.status, 403);
        assert.equal(calls.length, 1);
    });

    test('when the fallback fails as well, the original Vertex failure is reported', async () => {
        const fetchImpl = async url => String(url).includes('aiplatform') ? new Response('denied', { status: 403 }) : new Response('down', { status: 502 });
        const response = await fetchVertexWithRetry(VERTEX, options, { fetchImpl, ...noWait });
        assert.equal(response.status, 403);
        const thrown = async url => { if (String(url).includes('aiplatform')) throw Object.assign(new Error('x'), { name: 'TimeoutError' }); throw new TypeError('bridge down'); };
        await assert.rejects(fetchVertexWithRetry(VERTEX, options, { fetchImpl: thrown, ...noWait }), { name: 'TimeoutError' });
    });

    test('embedding requests never fall back', async () => {
        assert.equal(fallbackEnabled(EMBED), false);
        assert.equal(fallbackEnabled(VERTEX), true);
        process.env.AI_PROVIDER = 'ollama';
        assert.equal(fallbackEnabled(VERTEX), false);
    });

    test('credentials that Vertex refuses to issue fall back to no headers; without the fallback they still throw', async () => {
        const refused = async () => { throw new Error('no credentials'); };
        assert.deepEqual(await safeAccessHeaders(refused), {});
        delete process.env.AI_FALLBACK_PROVIDER;
        await assert.rejects(safeAccessHeaders(refused), /no credentials/);
    });
});

describe('agy as a name for the Ollama-protocol provider', () => {
    test('AI_PROVIDER=agy and AI_FALLBACK_PROVIDER=agy work like ollama; AGY_BASE_URL wins over OLLAMA_BASE_URL', async () => {
        const { aiProvider, ollamaBaseUrl } = await import('../../lib/ai/ollama.js');
        const { embeddingConfig } = await import('../../lib/embedding-config.js');
        assert.equal(aiProvider({ AI_PROVIDER: 'agy' }), 'ollama');
        assert.equal(aiProvider({ AI_PROVIDER: 'AGY' }), 'ollama');
        assert.equal(aiProvider({ AI_PROVIDER: 'other' }), 'vertex');
        assert.equal(ollamaBaseUrl({ AGY_BASE_URL: 'http://bridge:11500/', OLLAMA_BASE_URL: 'http://local:11434' }), 'http://bridge:11500');
        assert.equal(ollamaBaseUrl({ OLLAMA_BASE_URL: 'http://local:11434' }), 'http://local:11434');
        assert.equal(embeddingConfig({ VERTEX_AI_ENABLED: 'true', AI_PROVIDER: 'agy' }).enabled, false);
        const saved = ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER'].map(k => process.env[k]);
        process.env.AI_PROVIDER = 'vertex'; process.env.AI_FALLBACK_PROVIDER = 'agy';
        try { assert.equal(fallbackEnabled(VERTEX), true); } finally {
            ['AI_PROVIDER', 'AI_FALLBACK_PROVIDER'].forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
        }
    });
});
