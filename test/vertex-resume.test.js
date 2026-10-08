import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTorWithVertex, fetchVertexWithRetry } from '../lib/vertex/tor-extractor.js';

test('Vertex retries capacity errors with bounded backoff, not authorization errors', async () => {
    const delays = [];
    let calls = 0;
    const response = await fetchVertexWithRetry('https://example.test', {}, {
        fetchImpl: async () => new Response('{}', { status: ++calls === 1 ? 429 : 200,
            headers: { 'retry-after': '2' } }),
        wait: async delay => delays.push(delay), random: () => 0, maxAttempts: 3,
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [2000]);
    calls = 0;
    await fetchVertexWithRetry('https://example.test', {}, {
        fetchImpl: async () => { calls++; return new Response('{}', { status: 403 }); },
        wait: async () => assert.fail('403 must not retry'),
    });
    assert.equal(calls, 1);
});

test('a partial Vertex run resumes validated checkpoints without paying for completed chunks again', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'fixture';
    t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = old; });
    const cache = new Map();
    let calls = 0, fail = true;
    const extraction = { summary: 'สรุป', qualifications: [], scope_of_work: [],
        tech_stack: [], flagged_clauses: [], risk_findings: [], confidence: 0.9, document_language: 'th' };
    const dependencies = {
        checkpoints: { load: async key => cache.get(key), save: async (key, value) => cache.set(key, value) },
        headers: async () => ({}), maxAttempts: 1,
        fetchImpl: async () => {
            calls++;
            if (fail && calls === 2) return new Response('{}', { status: 429 });
            return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(extraction) }] } }] });
        },
    };
    const input = { extractionRunId: 'run', pages: [{ page_number: 1, text: 'ก'.repeat(25000) }] };
    await assert.rejects(extractTorWithVertex(input, dependencies), /HTTP 429/);
    assert.equal(cache.size, 1);
    fail = false;
    const result = await extractTorWithVertex(input, dependencies);
    assert.equal(cache.size, 2);
    assert.equal(calls, 3);
    assert.equal(result.extraction.summary, 'สรุป\n\nสรุป');
});
