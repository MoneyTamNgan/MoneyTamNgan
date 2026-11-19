import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    aiProvider, geminiToOllama, ollamaEndpoint, ollamaFetch, ollamaToGemini, toJsonSchema,
} from '../../lib/ai/ollama.js';
import { vertexEndpoint, accessHeaders, fetchVertexWithRetry } from '../../lib/vertex/tor-extractor.js';
import { embeddingConfig } from '../../lib/embedding-config.js';

const env = { AI_PROVIDER: 'ollama', OLLAMA_BASE_URL: 'http://10.0.0.5:11434/', OLLAMA_NUM_CTX: '4096' };

describe('local Ollama provider', () => {
    test('is opt-in', () => {
        assert.equal(aiProvider({}), 'vertex');
        assert.equal(aiProvider(env), 'ollama');
    });

    test('upper-case Gemini schema becomes JSON Schema', () => {
        const schema = toJsonSchema({
            type: 'OBJECT',
            required: ['year'],
            properties: { year: { type: 'INTEGER', minimum: 2500 }, tags: { type: 'ARRAY', items: { type: 'STRING' } } },
            propertyOrdering: ['year'],
        });
        assert.deepEqual(schema, {
            type: 'object',
            required: ['year'],
            properties: { year: { type: 'integer', minimum: 2500 }, tags: { type: 'array', items: { type: 'string' } } },
        });
    });

    test('request maps system, user, schema and options', () => {
        const request = geminiToOllama({
            systemInstruction: { parts: [{ text: 'rules' }] },
            contents: [{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }],
            generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' } },
        }, 'qwen2.5:3b', env);
        assert.equal(request.model, 'qwen2.5:3b');
        assert.equal(request.stream, false);
        assert.deepEqual(request.messages, [{ role: 'system', content: 'rules' }, { role: 'user', content: 'ab' }]);
        assert.deepEqual(request.format, { type: 'object' });
        assert.equal(request.options.num_ctx, 4096);
    });

    test('response maps to the Gemini shape and flags truncation', () => {
        assert.equal(ollamaToGemini({ message: { content: '{}' }, done: true, done_reason: 'stop' }, 'm').candidates[0].finishReason, 'STOP');
        assert.equal(ollamaToGemini({ message: { content: '{' }, done: true, done_reason: 'length' }, 'm').candidates[0].finishReason, 'MAX_TOKENS');
    });

    test('ollamaFetch posts to /api/chat and returns Gemini JSON', async () => {
        let seen;
        const fetchImpl = async (url, init) => {
            seen = { url, body: JSON.parse(init.body), headers: init.headers };
            return new Response(JSON.stringify({ message: { content: '{"ok":true}' }, done: true, done_reason: 'stop', model: 'qwen2.5:3b' }));
        };
        const response = await ollamaFetch(ollamaEndpoint('qwen2.5:3b', env), {
            method: 'POST', headers: { Authorization: 'Bearer x' },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
        }, fetchImpl, env);
        assert.equal(seen.url, 'http://10.0.0.5:11434/api/chat');
        assert.equal(seen.body.model, 'qwen2.5:3b');
        assert.equal(seen.headers.Authorization, undefined);
        const payload = await response.json();
        assert.equal(payload.candidates[0].content.parts[0].text, '{"ok":true}');
    });

    test('ollamaFetch passes upstream errors through', async () => {
        const response = await ollamaFetch('http://h/api/chat?model=m', { body: '{}' }, async () => new Response('x', { status: 500 }), env);
        assert.equal(response.status, 500);
    });

    test('Vertex path is untouched unless AI_PROVIDER=ollama', async () => {
        assert.match(vertexEndpoint('p', 'global', 'gemini-2.5-flash'), /aiplatform\.googleapis\.com/);
        process.env.AI_PROVIDER = 'ollama';
        process.env.OLLAMA_BASE_URL = 'http://10.0.0.5:11434';
        try {
            assert.match(vertexEndpoint('p', 'global', 'qwen2.5:3b'), /^http:\/\/10\.0\.0\.5:11434\/api\/chat\?model=qwen2\.5%3A3b$/);
            assert.deepEqual(await accessHeaders(), {});
            const calls = [];
            const res = await fetchVertexWithRetry(vertexEndpoint('p', 'global', 'qwen2.5:3b'), {
                method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'x' }] }] }),
            }, { fetchImpl: async (url) => { calls.push(url); return new Response(JSON.stringify({ message: { content: 'hi' }, done: true })); } });
            assert.deepEqual(calls, ['http://10.0.0.5:11434/api/chat']);
            assert.equal((await res.json()).candidates[0].finishReason, 'STOP');
        } finally {
            delete process.env.AI_PROVIDER;
            delete process.env.OLLAMA_BASE_URL;
        }
    });

    test('embeddings stay off with the local provider', () => {
        assert.equal(embeddingConfig({ VERTEX_AI_ENABLED: 'true' }).enabled, true);
        assert.equal(embeddingConfig({ VERTEX_AI_ENABLED: 'true', AI_PROVIDER: 'ollama' }).enabled, false);
    });
});
