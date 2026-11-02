import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmbeddingText, embedPending, embedProject, embedText, embeddingSourceHash } from '../../lib/vertex/embedding.js';
import { embeddingConfig } from '../../lib/embedding-config.js';
import { ensureVectorSearchIndex, vectorIndexDefinition } from '../../lib/vector-index.js';

const config = { enabled: true, projectId: 'proj', location: 'us-central1', model: 'text-embedding-005', dimensions: 4 };
const project = { _id: 'p1', project_id: '1', project_name: 'จัดซื้อระบบ', dept_name: 'กรมทดสอบ', latest_summary_id: 's1' };
const summary = { _id: 's1', extraction: { summary: 'ระบบจัดการเอกสาร', tech_stack: [{ value: 'PostgreSQL', page: 3 }, 'Kubernetes'], scope_of_work: [{ value: 'พัฒนาระบบ', page: 2 }] } };
const okResponse = values => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ predictions: [{ embeddings: { values } }] }) });
const headers = async () => ({ Authorization: 'Bearer test' });

function memoryStore(overrides = {}) {
    const calls = { ready: [], failed: [] };
    return {
        calls,
        loadProject: async () => ({ ...project, ...overrides.project }),
        loadSummary: async () => summary,
        saveReady: async (id, data) => calls.ready.push([id, data]),
        saveFailed: async (id, data) => calls.failed.push([id, data]),
        findPending: async () => ['1', '2'],
    };
}

test('config defaults to text-embedding-005 with 768 dimensions', () => {
    const defaults = embeddingConfig({});
    assert.equal(defaults.model, 'text-embedding-005');
    assert.equal(defaults.dimensions, 768);
    assert.equal(defaults.enabled, false);
    assert.equal(embeddingConfig({ VERTEX_AI_ENABLED: 'TRUE', VERTEX_EMBEDDING_DIMENSIONS: '256' }).dimensions, 256);
});

test('embedding text covers title, agency, summary, scope and tech stack, and is capped', () => {
    const text = buildEmbeddingText(project, summary);
    for (const part of ['จัดซื้อระบบ', 'กรมทดสอบ', 'ระบบจัดการเอกสาร', 'พัฒนาระบบ', 'PostgreSQL, Kubernetes']) assert.match(text, new RegExp(part));
    assert.equal(buildEmbeddingText({ project_name: 'x'.repeat(20000) }, null).length, 8000);
});

test('source hash changes with the text, model and dimensions', () => {
    const base = embeddingSourceHash('a', config);
    assert.notEqual(base, embeddingSourceHash('b', config));
    assert.notEqual(base, embeddingSourceHash('a', { ...config, dimensions: 8 }));
    assert.equal(base, embeddingSourceHash('a', config));
});

test('embedText calls the regional predict endpoint and returns the vector', async () => {
    let seen;
    const values = await embedText('hello', config, { headers, fetchImpl: async (url, options) => { seen = { url, body: JSON.parse(options.body) }; return okResponse([1, 2, 3, 4]); } });
    assert.deepEqual(values, [1, 2, 3, 4]);
    assert.match(seen.url, /^https:\/\/us-central1-aiplatform\.googleapis\.com\/v1\/projects\/proj\/locations\/us-central1\/publishers\/google\/models\/text-embedding-005:predict$/);
    assert.equal(seen.body.parameters.outputDimensionality, 4);
    assert.equal(seen.body.instances[0].task_type, 'RETRIEVAL_DOCUMENT');
});

test('embedText rejects a vector of the wrong size or HTTP errors', async () => {
    await assert.rejects(embedText('x', config, { headers, fetchImpl: async () => okResponse([1, 2]) }), /invalid embedding \(expected 4/);
    await assert.rejects(embedText('x', config, { headers, fetchImpl: async () => ({ ok: false, status: 403, headers: new Headers(), json: async () => ({ error: { message: 'denied' } }) }) }), /HTTP 403: denied/);
    await assert.rejects(embedText('x', { ...config, projectId: '' }, { headers }), /GOOGLE_CLOUD_PROJECT/);
});

test('embedProject is skipped when Vertex is disabled or there is no summary', async () => {
    assert.deepEqual(await embedProject('1', { config: { ...config, enabled: false }, store: memoryStore() }), { projectId: '1', status: 'skipped', reason: 'vertex_disabled' });
    const store = memoryStore({ project: { latest_summary_id: null } });
    assert.equal((await embedProject('1', { config, store })).reason, 'no_summary');
    assert.equal(store.calls.ready.length + store.calls.failed.length, 0);
});

test('embedProject stores the vector and marks the project ready', async () => {
    const store = memoryStore();
    const result = await embedProject('1', { config, store, headers, fetchImpl: async () => okResponse([0.1, 0.2, 0.3, 0.4]) });
    assert.equal(result.status, 'ready');
    const [id, data] = store.calls.ready[0];
    assert.equal(id, 'p1');
    assert.deepEqual(data.values, [0.1, 0.2, 0.3, 0.4]);
    assert.equal(data.summaryId, 's1');
    assert.equal(data.sourceHash, embeddingSourceHash(buildEmbeddingText(project, summary), config));
});

test('embedProject does nothing when the stored embedding is current, but redoes it when the summary changed', async () => {
    const hash = embeddingSourceHash(buildEmbeddingText(project, summary), config);
    const current = memoryStore({ project: { embedding: { status: 'ready', source_hash: hash } } });
    let fetched = 0;
    const fetchImpl = async () => { fetched++; return okResponse([1, 1, 1, 1]); };
    assert.equal((await embedProject('1', { config, store: current, headers, fetchImpl })).status, 'unchanged');
    assert.equal(fetched, 0);
    const stale = memoryStore({ project: { embedding: { status: 'ready', source_hash: 'old-hash' } } });
    assert.equal((await embedProject('1', { config, store: stale, headers, fetchImpl })).status, 'ready');
    assert.equal(fetched, 1);
});

test('embedProject records a failure with an attempt count instead of throwing', async () => {
    const hash = embeddingSourceHash(buildEmbeddingText(project, summary), config);
    const store = memoryStore({ project: { embedding: { status: 'failed', source_hash: hash, attempts: 2 } } });
    const result = await embedProject('1', { config, store, headers, maxAttempts: 1, fetchImpl: async () => ({ ok: false, status: 400, headers: new Headers(), json: async () => ({ error: { message: 'bad' } }) }) });
    assert.equal(result.status, 'failed');
    assert.equal(result.attempts, 3);
    assert.match(store.calls.failed[0][1].error, /HTTP 400: bad/);
    assert.equal(store.calls.ready.length, 0);
});

test('a failure for changed text restarts the attempt counter', async () => {
    const store = memoryStore({ project: { embedding: { status: 'failed', source_hash: 'other', attempts: 4 } } });
    const result = await embedProject('1', { config, store, headers, maxAttempts: 1, fetchImpl: async () => { throw Object.assign(new Error('boom'), { name: 'Error' }); } });
    assert.equal(result.attempts, 1);
});

test('embedPending processes every pending id', async () => {
    const results = await embedPending({ limit: 5 }, { config, store: memoryStore(), headers, fetchImpl: async () => okResponse([1, 2, 3, 4]) });
    assert.deepEqual(results.map(item => item.status), ['ready', 'ready']);
});

function fakeCollection(existing) {
    const log = [];
    return {
        log,
        listSearchIndexes: () => ({ toArray: async () => (existing ? [existing] : []) }),
        createSearchIndex: async spec => log.push(['create', spec]),
        updateSearchIndex: async (name, definition) => log.push(['update', name, definition]),
    };
}

test('vector index definition targets vectorEmbedding with cosine similarity and filters', () => {
    const { fields } = vectorIndexDefinition(768);
    assert.deepEqual(fields[0], { type: 'vector', path: 'vectorEmbedding', numDimensions: 768, similarity: 'cosine' });
    assert.deepEqual(fields.slice(1).map(field => field.path), ['is_software', 'dept_name']);
});

test('ensureVectorSearchIndex creates, leaves alone, or updates the index', async () => {
    const empty = fakeCollection(null);
    assert.equal(await ensureVectorSearchIndex(empty, { dimensions: 768 }), 'created');
    assert.equal(empty.log[0][1].type, 'vectorSearch');
    assert.equal(empty.log[0][1].name, 'project_vector_index');

    const same = fakeCollection({ latestDefinition: vectorIndexDefinition(768) });
    assert.equal(await ensureVectorSearchIndex(same, { dimensions: 768 }), 'unchanged');
    assert.equal(same.log.length, 0);

    const resized = fakeCollection({ latestDefinition: vectorIndexDefinition(768) });
    assert.equal(await ensureVectorSearchIndex(resized, { dimensions: 1024 }), 'updated');
    assert.equal(resized.log[0][2].fields[0].numDimensions, 1024);
});
