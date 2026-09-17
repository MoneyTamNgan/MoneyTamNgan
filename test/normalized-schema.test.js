import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import {
    extractionRunKey,
    linkExistingSummaryBundle,
    persistOcrBundle,
    persistSummaryBundle,
} from '../lib/mongo-artifacts.js';
import {
    hydrateProjectCompatibility,
    hydrateProjectsCompatibility,
} from '../lib/project-compat.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';
import ProcessingJob from '../models/ProcessingJob.js';
import { completeJob, enqueueProject } from '../lib/job-queue.js';

const query = value => ({ lean: async () => value });

test('normalized schemas expose history and active-job uniqueness indexes', () => {
    assert.ok(Document.schema.indexes().some(([keys, options]) => (
        keys.project_id === 1 && keys.is_current_primary === 1 && options.unique
    )));
    assert.ok(ExtractionRun.schema.indexes().some(([keys, options]) => (
        keys.document_id === 1 && keys.processor_fingerprint === 1
        && keys.text_sha256 === 1 && options.unique
    )));
    assert.ok(DocumentPage.schema.indexes().some(([keys, options]) => (
        keys.extraction_run_id === 1 && keys.page_number === 1 && options.unique
    )));
    assert.ok(DocumentSummary.schema.indexes().some(([keys, options]) => (
        keys.extraction_run_id === 1 && keys.model === 1
        && keys.model_version === 1 && keys.prompt_version === 1 && options.unique
    )));
    assert.ok(ProcessingJob.schema.indexes().some(([keys, options]) => (
        keys.active_key === 1 && options.unique
    )));
});

test('extraction run identity is deterministic and changes with processor output', () => {
    const document = { _id: 'doc-1', sha256: 'pdf-hash' };
    const base = { fingerprint: 'ocr-v1', textHash: 'text-v1' };
    assert.equal(extractionRunKey(document, base), extractionRunKey(document, base));
    assert.notEqual(
        extractionRunKey(document, base),
        extractionRunKey(document, { ...base, fingerprint: 'ocr-v2' })
    );
});

test('OCR bundle writes extraction pages and project pointers in one transaction', async () => {
    const writes = { pages: [], project: [], documents: [] };
    const run = { _id: new mongoose.Types.ObjectId() };
    const models = {
        ExtractionRunModel: { findOneAndUpdate: async () => run },
        PageModel: {
            updateMany: async () => {},
            bulkWrite: async operations => writes.pages.push(...operations),
            deleteMany: async () => {},
        },
        DocumentModel: { updateOne: async (...args) => writes.documents.push(args) },
        ProjectModel: { updateOne: async (...args) => writes.project.push(args) },
    };
    const project = { _id: new mongoose.Types.ObjectId(), project_id: '67000000001' };
    const document = { _id: new mongoose.Types.ObjectId(), project_id: project.project_id, sha256: 'pdf' };
    const textResult = {
        fingerprint: 'ocr-v1', textHash: 'text-v1', pageCount: 1, ocrPages: 1,
        needsReview: false, reviewPages: [],
        pages: [{ page_number: 1, text: 'ข้อความ', extraction_method: 'ocr', warnings: [] }],
    };
    const result = await persistOcrBundle(
        project,
        document,
        textResult,
        null,
        { $set: { 'processing.status': 'text_extracted' } },
        models,
        { transactionRunner: work => work('session-test') }
    );
    assert.equal(result, run);
    assert.equal(writes.pages[0].updateOne.filter.extraction_run_id, run._id);
    assert.equal(writes.project[0][1].$set.latest_extraction_run_id, run._id);
    assert.equal(writes.project[0][1].$set['processing.status'], 'text_extracted');
});

test('summary bundle stores versioned result and latest pointers atomically', async () => {
    const writes = { project: [], document: [], summary: [] };
    const summary = { _id: new mongoose.Types.ObjectId() };
    const models = {
        SummaryModel: {
            findOneAndUpdate: async (filter, update) => {
                writes.summary.push({ filter, update });
                return summary;
            },
        },
        DocumentModel: { updateOne: async (...args) => writes.document.push(args) },
        ProjectModel: { updateOne: async (...args) => writes.project.push(args) },
    };
    const project = { _id: new mongoose.Types.ObjectId(), project_id: '67000000001' };
    const document = { _id: new mongoose.Types.ObjectId(), project_id: project.project_id, sha256: 'pdf' };
    const run = { _id: new mongoose.Types.ObjectId() };
    const vertex = {
        model: 'gemini', modelVersion: '2.5', promptVersion: 'v1',
        extraction: { summary: 'สรุป', confidence: 0.9 },
        usage: { inputTokens: 10, outputTokens: 5 },
    };
    await persistSummaryBundle(
        project,
        document,
        run,
        { textHash: 'text' },
        vertex,
        false,
        { $set: { 'processing.status': 'completed' } },
        models,
        { transactionRunner: work => work('session-test') }
    );
    assert.equal(writes.summary[0].filter.extraction_run_id, run._id);
    assert.equal(writes.project[0][1].$set.latest_summary_id, summary._id);
    assert.equal(writes.project[0][1].$set['processing.summary_record_id'], summary._id);
});

test('completed legacy summary is linked to the normalized run without regeneration', async () => {
    const writes = { project: [], document: [], summary: [] };
    const summary = { _id: new mongoose.Types.ObjectId() };
    let lookup = 0;
    const models = {
        SummaryModel: {
            findOneAndUpdate: async (filter, update) => {
                writes.summary.push({ filter, update });
                lookup += 1;
                return lookup === 1 ? null : summary;
            },
        },
        DocumentModel: { updateOne: async (...args) => writes.document.push(args) },
        ProjectModel: { updateOne: async (...args) => writes.project.push(args) },
    };
    const project = { _id: new mongoose.Types.ObjectId(), project_id: '67000000001' };
    const document = { _id: new mongoose.Types.ObjectId(), project_id: project.project_id };
    const run = { _id: new mongoose.Types.ObjectId() };
    const result = await linkExistingSummaryBundle(
        project,
        document,
        run,
        { textHash: 'text' },
        { model: 'gemini', model_version: '2.5', prompt_version: 'v1' },
        'review_required',
        models,
        { transactionRunner: work => work('session-test') }
    );
    assert.equal(result, summary);
    assert.equal(writes.summary[1].update.$set.extraction_run_id, run._id);
    assert.equal(writes.project[0][1].$set.latest_summary_id, summary._id);
    assert.equal(writes.project[0][1].$set['workflow.status'], 'review_required');
});

test('compatibility mapper preserves legacy reads and can hydrate normalized records', async () => {
    const project = {
        _id: new mongoose.Types.ObjectId(), project_id: '67000000001',
        pdf_url: 'legacy-url', extracted_data: { summary: 'legacy' },
        workflow: { status: 'completed', error: null },
        primary_document_id: new mongoose.Types.ObjectId(),
        latest_extraction_run_id: new mongoose.Types.ObjectId(),
        latest_summary_id: new mongoose.Types.ObjectId(),
    };
    const legacy = await hydrateProjectCompatibility(project, {}, { enabled: false });
    assert.equal(legacy.pdf_url, 'legacy-url');
    assert.equal(Object.hasOwn(legacy, 'primary_document_id'), false);

    const models = {
        DocumentModel: { find: () => query([{ _id: project.primary_document_id,
            source_url: 'normalized-url', filename: 'tor.pdf', sha256: 'pdf',
            storage: { backend: 'remote', mime_type: 'application/pdf', size_bytes: 12 } }]) },
        ExtractionRunModel: { find: () => query([{ _id: project.latest_extraction_run_id,
            text_sha256: 'text', page_count: 2, ocr_pages: 2, status: 'completed' }]) },
        SummaryModel: { find: () => query([{ _id: project.latest_summary_id,
            model: 'gemini', model_version: '2.5', prompt_version: 'v1',
            extraction: { summary: 'normalized', qualifications: [], scope_of_work: [], tech_stack: [] },
            usage: {}, confidence: 0.9 }]) },
    };
    const [normalized] = await hydrateProjectsCompatibility([project], models, { enabled: true });
    assert.equal(normalized.pdf_url, 'normalized-url');
    assert.equal(normalized.extracted_data.summary, 'normalized');
    assert.equal(normalized.document.text_sha256, 'text');
    assert.equal(normalized.processing.status, 'completed');
    assert.equal(Object.hasOwn(normalized, 'latest_summary_id'), false);
});

test('job enqueue resolves a concurrent duplicate through the active key', async t => {
    const existing = { _id: 'job-1', project_id: '67000000001', status: 'queued' };
    t.mock.method(ProcessingJob, 'findOne', filter => ({
        lean: async () => filter.active_key ? existing : null,
    }));
    t.mock.method(ProcessingJob, 'create', async () => {
        const error = new Error('duplicate active key');
        error.code = 11000;
        throw error;
    });
    const result = await enqueueProject(existing.project_id);
    assert.equal(result.reused, true);
    assert.equal(result.job._id, existing._id);
});

test('completed jobs release their active key', async t => {
    let update;
    t.mock.method(ProcessingJob, 'updateOne', async (filter, value) => { update = value; });
    await completeJob('job-1', { status: 'completed' });
    assert.deepEqual(update.$unset, { active_key: '' });
});
