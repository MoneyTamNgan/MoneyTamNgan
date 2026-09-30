import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import { processProject } from '../lib/processing-pipeline.js';
import { TOR_PROMPT_VERSION } from '../lib/vertex/response-schema.js';

async function fixture(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tor-pipeline-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'local.pdf');
    await writeFile(pdf, '%PDF-fixture');
    const record = { _id: 'test', project_id: '68019088742', is_software: true,
        classification: { status: 'manual_override' }, pdf_path: pdf, pdf_content_type: 'application/pdf',
        document: { local_path: pdf, sha256: 'pdf-hash' }, ocr: { processor_version: 'engine-version' }, processing: {} };
    const updates = [];
    const normalizedWrites = { ocr: 0, summary: 0, existingSummary: null, vertex: null };
    t.mock.method(Project, 'findOne', () => ({ lean: async () => record }));
    t.mock.method(Project, 'updateOne', async (filter, update) => { updates.push(update); return {}; });
    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { if (old === undefined) delete process.env.VERTEX_AI_ENABLED; else process.env.VERTEX_AI_ENABLED = old; });
    const dependencies = {
        persist: async () => ({ sha256: 'pdf-hash', size: 10, gcsUri: null }),
        hashSource: async () => ({ sha256: 'pdf-hash', size: 10 }),
        cleanupSource: async () => {},
        savePdfRecords: async () => ({
            _id: 'document-test', project_id: record.project_id, sha256: 'pdf-hash',
        }),
        saveOcrPages: async () => {},
        saveVertexSummary: async () => ({ _id: 'summary-test' }),
        saveOcrBundle: async (project, document, textResult, uri, legacyUpdate) => {
            normalizedWrites.ocr++;
            updates.push(legacyUpdate);
            return { _id: new mongoose.Types.ObjectId(), processor_fingerprint: textResult.fingerprint };
        },
        saveSummaryBundle: async (project, document, run, textResult, vertex, review, legacyUpdate) => {
            normalizedWrites.summary++;
            normalizedWrites.vertex = vertex;
            updates.push(legacyUpdate);
            return { _id: 'summary-test' };
        },
        SummaryModel: {
            findOne: () => ({ lean: async () => normalizedWrites.existingSummary }),
        },
        extractText: async (local, options) => {
            await options.onProgress({ pageCount: 2, pagesProcessed: 2, ocrPages: 1 });
            return { artifactPath: path.join(dir, 'document.json'), pages: [{ page_number: 1, text: 'ข้อความภาษาไทย'.repeat(10) }], textHash: 'text-hash',
                pageCount: 2, ocrPages: 1, fingerprint: 'engine-version', needsReview: false };
        },
        extractWithVertex: async () => { throw new Error('Vertex should not run'); },
    };
    return { record, updates, dependencies, normalizedWrites };
}

test('stored PDF resumes at OCR and waits for Vertex configuration with durable progress', async t => {
    const { updates, dependencies } = await fixture(t);
    const result = await processProject('68019088742', { allowBrowserFallback: false }, dependencies);
    assert.equal(result.status, 'ai_pending');
    assert.ok(updates.some(u => u.$set?.['workflow.status'] === 'text_extracted'));
    assert.equal(updates.at(-1).$set['processing.status'], 'ai_pending');
    assert.ok(!updates.some(u => u.$inc?.['processing.download_attempts']));
});

test('OCR failures leave retry state and record the extraction error', async t => {
    const { updates, dependencies } = await fixture(t);
    dependencies.extractText = async () => { throw new Error('OCR unavailable'); };
    await assert.rejects(processProject('68019088742', {}, dependencies), /OCR unavailable/);
    assert.equal(updates.at(-1).$set['processing.status'], 'retry_pending');
    assert.equal(updates.at(-1).$set['workflow.status'], 'retry_pending');
});

test('unchanged text and model restore completed state without re-running Vertex', async t => {
    const { updates, dependencies, normalizedWrites } = await fixture(t);
    normalizedWrites.existingSummary = { _id: 'summary-existing', needs_review: false };
    const result = await processProject('68019088742', {}, dependencies);
    assert.equal(result.reused, true);
    assert.equal(updates.at(-1).$set['processing.status'], 'completed');
});

test('empty OCR output is sent to review without a Vertex call', async t => {
    const { updates, dependencies } = await fixture(t);
    dependencies.extractText = async () => ({ artifactPath: 'test.json', pages: [{ page_number: 1, text: '' }],
        pageCount: 1, textHash: 'empty', fingerprint: 'test', needsReview: true });
    const result = await processProject('68019088742', {}, dependencies);
    assert.equal(result.status, 'review_required');
    assert.match(updates.at(-1).$set['processing.error'], /No usable text/);
});

test('new OCR quality flags override a cached completed summary and persist page warnings', async t => {
    const { record, dependencies, normalizedWrites } = await fixture(t);
    normalizedWrites.existingSummary = { _id: 'summary-existing', needs_review: false };
    const original = dependencies.extractText;
    const reviewPages = [{ page_number: 2, codes: ['amount_words_mismatch'] }];
    dependencies.extractText = async (...args) => ({ ...await original(...args), needsReview: true, reviewPages });
    const result = await processProject(record.project_id, {}, dependencies);
    assert.equal(result.reused, true);
    assert.equal(result.status, 'review_required');
});

test('changed OCR processor invalidates a cached summary even when text is unchanged', async t => {
    const { record, dependencies } = await fixture(t);
    const result = await processProject(record.project_id, {}, dependencies);
    assert.equal(result.status, 'ai_pending');
    assert.notEqual(result.reused, true);
});

for (const needsReview of [false, true]) {
    test(`AI enrichment persists evidence and ${needsReview ? 'review' : 'completed'} status`, async t => {
        const { record, updates, dependencies, normalizedWrites } = await fixture(t);
        process.env.VERTEX_AI_ENABLED = 'true';
        const originalExtract = dependencies.extractText;
        dependencies.extractText = async (...args) => ({ ...await originalExtract(...args), needsReview });
        dependencies.extractWithVertex = async ({ pages }) => {
            assert.equal(pages[0].page_number, 1);
            return { extraction: { summary: 'สรุปทดสอบ', qualifications: [{ value: 'ประสบการณ์', page: 1 }],
                scope_of_work: [], tech_stack: [], flagged_clauses: [], confidence: 1 },
                model: 'test-model', modelVersion: 'test-version', promptVersion: TOR_PROMPT_VERSION,
                usage: { inputTokens: 100, outputTokens: 50 } };
        };
        const result = await processProject(record.project_id, {}, dependencies);
        assert.equal(result.status, needsReview ? 'review_required' : 'completed');
        const saved = updates.at(-1).$set;
        assert.equal(normalizedWrites.vertex.extraction.summary, 'สรุปทดสอบ');
        assert.equal(normalizedWrites.vertex.extraction.qualifications[0].page, 1);
        assert.equal(saved['processing.status'], needsReview ? 'review_required' : 'completed');
        assert.ok(!Object.hasOwn(saved, 'budget'));
        assert.equal(result.documentId, 'document-test');
        assert.equal(result.documentSummaryId, 'summary-test');
    });
}

test('Vertex failure records retry state while preserving completed OCR', async t => {
    const { updates, dependencies } = await fixture(t);
    process.env.VERTEX_AI_ENABLED = 'true';
    dependencies.extractWithVertex = async () => { throw new Error('Vertex temporarily unavailable'); };
    await assert.rejects(processProject('68019088742', {}, dependencies), /temporarily unavailable/);
    assert.ok(updates.some(u => u.$set?.['workflow.status'] === 'text_extracted'));
    assert.equal(updates.at(-1).$set['processing.status'], 'retry_pending');
    assert.equal(updates.at(-1).$set['ocr.status'], undefined);
});

test('normalized dual-write mode uses transactional OCR and summary bundles', async t => {
    const { record, dependencies, normalizedWrites } = await fixture(t);
    process.env.VERTEX_AI_ENABLED = 'true';
    dependencies.extractWithVertex = async () => ({
        extraction: { summary: 'สรุป', qualifications: [], scope_of_work: [],
            tech_stack: [], flagged_clauses: [], confidence: 0.9 },
        model: 'test-model', modelVersion: 'test-version', promptVersion: TOR_PROMPT_VERSION,
        usage: { inputTokens: 10, outputTokens: 5 },
    });
    const result = await processProject(record.project_id, {
        normalizedDualWrite: true,
    }, dependencies);
    assert.equal(result.status, 'completed');
    assert.equal(normalizedWrites.ocr, 1);
    assert.equal(normalizedWrites.summary, 1);
});
