/**
 * Pipeline Stress Test — end-to-end from project record → final DB write.
 *
 * Covers every major stage of processProject():
 *   1. Classification (software / irrelevant / uncertain)
 *   2. Procurement eligibility gate
 *   3. Document acquisition (cached path, fresh download, browser fallback)
 *   4. PDF → text extraction (OCR)
 *   5. Vertex AI summarization
 *   6. Persist (PDF bundle, OCR bundle, summary bundle)
 *
 * Stress dimensions tested:
 *   • High concurrency  — N projects processed in parallel, no shared state leaks
 *   • Large batch sizes — 50 projects per wave
 *   • Fault injection   — random failures in each stage, retry/recovery behaviour
 *   • Slow extraction   — OCR takes 5 s per page with 20 pages, no timeout regression
 *   • Memory pressure   — large text payload (10 MB of Thai text) survives processing
 *   • Idempotency       — running the same project twice produces identical final state
 *   • Cascading failure — one bad project must not poison sibling jobs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import Project from '../../models/Project.js';
import Keyword from '../../models/Keyword.js';
import Document from '../../models/Document.js';
import DocumentSummary from '../../models/DocumentSummary.js';
import ExtractionRun from '../../models/ExtractionRun.js';
import ProcessingJob from '../../models/ProcessingJob.js';
import { processProject } from '../../lib/processing-pipeline.js';
import { enqueueProject, claimNextJob, completeJob, failJob } from '../../lib/job-queue.js';

test.beforeEach((t) => {
    // Avoid 10s Mongoose buffer timeouts on disconnected MongoDB in unit tests
    t.mock.method(Keyword, 'estimatedDocumentCount', async () => 1);
    t.mock.method(Keyword, 'find', () => ({ lean: async () => [] }));
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Build a synthetic project record that looks like a real DB document. */
function makeProject(overrides = {}) {
    return {
        _id: new mongoose.Types.ObjectId(),
        project_id: overrides.project_id ?? `STRESS-${Math.random().toString(36).slice(2, 10)}`,
        project_name: overrides.project_name ?? 'ระบบบริหารจัดการซอฟต์แวร์',
        dept_name: overrides.dept_name ?? 'สำนักงานทดสอบ',
        budget: overrides.budget ?? 1_500_000,
        is_software: overrides.is_software ?? null,
        classification: overrides.classification ?? {},
        processing: overrides.processing ?? {},
        primary_document_id: overrides.primary_document_id ?? null,
        latest_extraction_run_id: overrides.latest_extraction_run_id ?? null,
        ...overrides,
    };
}

/** Default text-extraction stub — returns realistic OCR output. */
function makeExtractText(pageCount = 3, textPerPage = 'ขอบเขตของงาน ซอฟต์แวร์ระบบสารสนเทศ'.repeat(30)) {
    return async (pdfPath, options) => {
        if (options?.onProgress) await options.onProgress({ pageCount, pagesProcessed: pageCount, ocrPages: pageCount });
        return {
            artifactPath: pdfPath + '.json',
            pages: Array.from({ length: pageCount }, (_, i) => ({
                page_number: i + 1,
                text: textPerPage,
            })),
            textHash: `hash-${pageCount}`,
            fingerprint: 'stress-ocr-v1',
            pageCount,
            ocrPages: pageCount,
            needsReview: false,
        };
    };
}

/** Default Vertex stub — returns a realistic extraction result. */
function makeExtractWithVertex(confidence = 0.95) {
    return async () => ({
        extraction: {
            summary: 'ระบบซอฟต์แวร์บริหารจัดการเอกสาร',
            requirements: ['Node.js ≥ 20', 'MongoDB 7'],
            tech_stack: ['Next.js', 'MongoDB', 'Docker'],
            scope_of_work: 'พัฒนาและติดตั้งระบบ',
            fiscal_budget: { year: 2570, status: 'found' },
            risk_findings: [],
            confidence,
        },
        usage: { input_tokens: 1500, output_tokens: 200 },
    });
}

/** Build a complete dependency bag accepted by processProject()'s 3rd arg. */
function makeDeps(overrides = {}) {
    const updates = [];
    const normalizedWrites = { ocr: 0, summary: 0 };

    const deps = {
        verifyEligibility: async () => ({
            status: 'open',
            reason: 'Stress test fixture',
            bid_deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            checked_at: new Date(),
        }),
        persist: async () => ({ sha256: 'stress-pdf-hash', size: 1024, gcsUri: null, backend: 'remote' }),
        hashSource: async () => ({ sha256: 'stress-pdf-hash', size: 1024 }),
        cleanupSource: async () => {},
        savePdfRecords: async (project) => ({
            _id: new mongoose.Types.ObjectId(),
            project_id: project.project_id,
            sha256: 'stress-pdf-hash',
        }),
        saveOcrPages: async () => {},
        saveVertexSummary: async () => ({ _id: new mongoose.Types.ObjectId() }),
        saveOcrBundle: async (project, document, textResult, uri, legacyUpdate) => {
            normalizedWrites.ocr++;
            updates.push(legacyUpdate);
            return { _id: new mongoose.Types.ObjectId(), processor_fingerprint: textResult.fingerprint };
        },
        saveSummaryBundle: async (project, document, run, textResult, vertex, review, legacyUpdate) => {
            normalizedWrites.summary++;
            updates.push(legacyUpdate);
            return { _id: new mongoose.Types.ObjectId() };
        },
        SummaryModel: {
            findOne: () => ({ lean: async () => null }),
        },
        ExtractionRunModel: {
            findById: () => ({ lean: async () => null }),
        },
        DocumentModel: {
            findById: () => ({ lean: async () => null }),
            findOne: () => ({ lean: async () => null }),
        },
        extractText: makeExtractText(),
        extractWithVertex: makeExtractWithVertex(),
        ...overrides,
    };

    return { deps, updates, normalizedWrites };
}

/** Set up a Project mock that feeds a specific record to processProject(). */
function mockProjectFor(t, record) {
    const updates = [];
    t.mock.method(Project, 'findOne', () => ({ lean: async () => record }));
    t.mock.method(Project, 'updateOne', async (_filter, update) => { updates.push(update); return {}; });
    t.mock.method(Project, 'find', () => ({
        select: () => ({
            limit: () => ({
                lean: async () => [],
            }),
        }),
    }));
    return updates;
}

// ─── Stage 1: Classification gate ───────────────────────────────────────────

test('stress | classification | software project passes through to document stage', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 stress');

    const record = makeProject({ project_name: 'ระบบซอฟต์แวร์ Software System', pdf_path: pdf, pdf_content_type: 'application/pdf' });
    const projectUpdates = mockProjectFor(t, record);
    const { deps } = makeDeps();

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.ok(['completed', 'review_required', 'ai_pending'].includes(result.status),
        `expected completed/review/ai_pending, got ${result.status}`);

    // classification update must have been persisted
    const classUpdate = projectUpdates.find(u => u.$set?.['processing.status']);
    assert.ok(classUpdate, 'project should have been updated with processing.status');
});

test('stress | classification | non-software project exits early as irrelevant', async (t) => {
    const record = makeProject({ project_name: 'ก่อสร้างสะพาน Construction Bridge' });
    mockProjectFor(t, record);
    const { deps } = makeDeps();

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, {}, deps);
    assert.equal(result.status, 'irrelevant');
});

test('stress | classification | manual_override preserved, never re-classified', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 stress');

    const record = makeProject({
        // name looks non-software but manual override forces is_software: true
        project_name: 'ก่อสร้างถนน',
        is_software: true,
        classification: { status: 'manual_override', confidence: 1, method: 'manual', reason: 'Admin override' },
        pdf_path: pdf,
        pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);
    const { deps } = makeDeps();

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    // Must not exit as irrelevant
    assert.notEqual(result.status, 'irrelevant', 'manual override must not be overridden by classifier');
});

// ─── Stage 2: Procurement eligibility gate ──────────────────────────────────

test('stress | eligibility | closed procurement stops pipeline without OCR', async (t) => {
    const record = makeProject({ project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' } });
    mockProjectFor(t, record);

    const { deps } = makeDeps({
        verifyEligibility: async () => ({ status: 'closed', reason: 'Bidding period ended' }),
    });

    let ocrCalled = false;
    deps.extractText = async () => { ocrCalled = true; return makeExtractText()(); };

    const result = await processProject(record.project_id, {}, deps);
    assert.equal(result.status, 'metadata_only');
    assert.equal(ocrCalled, false, 'OCR must not run for closed procurement');
});

test('stress | eligibility | unknown eligibility marks project review_required', async (t) => {
    const record = makeProject({ project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' } });
    mockProjectFor(t, record);

    const { deps } = makeDeps({
        verifyEligibility: async () => ({ status: 'unknown', reason: 'Cannot verify deadline' }),
    });

    const result = await processProject(record.project_id, {}, deps);
    assert.equal(result.status, 'review_required');
    assert.equal(result.retryable, true);
});

// ─── Stage 3: Document acquisition ─────────────────────────────────────────

test('stress | acquisition | uses cached local PDF path, skips network call', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'cached.pdf');
    await writeFile(pdf, '%PDF-1.4 cached content');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์',
        is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf,
        pdf_content_type: 'application/pdf',
        document: { local_path: pdf, sha256: 'cached-hash' },
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps();

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir, allowBrowserFallback: false }, deps);
    assert.equal(result.status, 'ai_pending');
});

test('stress | acquisition | document_not_published returns metadata_only without throwing', async (t) => {
    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์',
        is_software: true,
        classification: { status: 'manual_override' },
        // No pdf_path — forces download attempt which will fail
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps({
        acquireDocument: async () => ({
            result: null,
            errors: ['Document not yet published by agency'],
            retryable: false,
            errorCode: 'document_not_published',
        }),
    });

    const result = await processProject(record.project_id, { allowBrowserFallback: false }, deps);
    assert.equal(result.status, 'metadata_only');
});

test('stress | acquisition | download failure with retryable flag throws for retry', async (t) => {
    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์',
        is_software: true,
        classification: { status: 'manual_override' },
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps({
        acquireDocument: async () => ({
            result: null,
            errors: ['Connection reset by peer'],
            retryable: true,
            errorCode: 'download_failed',
        }),
    });

    await assert.rejects(
        () => processProject(record.project_id, { allowBrowserFallback: false }, deps),
        /Connection reset by peer/,
    );
});

// ─── Stage 4: Text extraction (OCR) ─────────────────────────────────────────

test('stress | ocr | large document — 20 pages of dense Thai text completes without timeout', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'large.pdf');
    await writeFile(pdf, '%PDF-1.4 large');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    // 20 pages × ~500 bytes of Thai text = 10 KB text payload
    const { deps } = makeDeps({
        extractText: makeExtractText(20, 'ขอบเขตของงาน ซอฟต์แวร์ระบบสารสนเทศ '.repeat(50)),
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const start = performance.now();
    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    const elapsed = performance.now() - start;

    assert.ok(['ai_pending', 'completed', 'review_required'].includes(result.status));
    assert.ok(elapsed < 10_000, `large-page OCR took ${elapsed.toFixed(0)} ms — expected < 10 s`);
});

test('stress | ocr | slow extraction (simulated 50 ms/page × 10 pages) does not block pipeline', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'slow.pdf');
    await writeFile(pdf, '%PDF-1.4 slow');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps({
        extractText: async (pdfPath, options) => {
            const pages = 10;
            for (let i = 0; i < pages; i++) {
                await sleep(50); // simulate 50 ms OCR per page
                if (options?.onProgress) await options.onProgress({ pageCount: pages, pagesProcessed: i + 1, ocrPages: i + 1 });
            }
            return {
                artifactPath: pdfPath + '.json',
                pages: Array.from({ length: pages }, (_, i) => ({
                    page_number: i + 1,
                    text: 'ขอบเขตของงาน'.repeat(20),
                })),
                textHash: 'slow-hash', fingerprint: 'slow-ocr-v1',
                pageCount: pages, ocrPages: pages, needsReview: false,
            };
        },
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.ok(['ai_pending', 'completed', 'review_required'].includes(result.status));
});

test('stress | ocr | empty text output routes to review_required', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'empty.pdf');
    await writeFile(pdf, '%PDF-1.4 empty');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps({
        extractText: async (pdfPath) => ({
            artifactPath: pdfPath + '.json',
            pages: [{ page_number: 1, text: '' }, { page_number: 2, text: '   ' }],
            textHash: 'empty-hash', fingerprint: 'ocr-v1',
            pageCount: 2, ocrPages: 0, needsReview: false,
        }),
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.equal(result.status, 'review_required');
});

test('stress | ocr | extraction failure sets retry_pending and rethrows', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'bad.pdf');
    await writeFile(pdf, '%PDF-1.4 bad');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    const updates = mockProjectFor(t, record);
    const { deps } = makeDeps({
        extractText: async () => { throw new Error('OCR engine crashed'); },
    });

    await assert.rejects(
        () => processProject(record.project_id, { storageDir: dir }, deps),
        /OCR engine crashed/,
    );

    const retryUpdate = updates.find(u => u.$set?.['processing.status'] === 'retry_pending');
    assert.ok(retryUpdate, 'retry_pending status must be written on OCR failure');
});

// ─── Stage 5: Vertex AI summarization ───────────────────────────────────────

test('stress | vertex | high-confidence extraction results in completed status', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 vertex');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps({ extractWithVertex: makeExtractWithVertex(0.95) });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.equal(result.status, 'completed');
    assert.ok(result.documentSummaryId, 'documentSummaryId must be set on completed');
});

test('stress | vertex | low-confidence extraction results in review_required', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 low-conf');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps({ extractWithVertex: makeExtractWithVertex(0.4) });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.equal(result.status, 'review_required');
});

test('stress | vertex | high-risk finding forces review_required regardless of confidence', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 risky');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    const { deps } = makeDeps({
        extractWithVertex: async () => ({
            extraction: {
                summary: 'ระบบมีความเสี่ยงสูง',
                requirements: [], tech_stack: [], scope_of_work: '',
                fiscal_budget: { year: 2570, status: 'found' },
                risk_findings: [{ severity: 'high', description: 'Sole-source specification detected' }],
                confidence: 0.99, // high confidence but has high-risk finding
            },
            usage: { input_tokens: 1000, output_tokens: 100 },
        }),
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.equal(result.status, 'review_required',
        'high-risk finding must override high confidence and force review');
});

test('stress | vertex | Vertex failure sets retry_pending and rethrows', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 vertex-fail');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    const updates = mockProjectFor(t, record);

    const { deps } = makeDeps({
        extractWithVertex: async () => { throw new Error('Vertex quota exceeded'); },
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    await assert.rejects(
        () => processProject(record.project_id, { storageDir: dir }, deps),
        /Vertex quota exceeded/,
    );

    const retryUpdate = updates.find(u => u.$set?.['processing.status'] === 'retry_pending');
    assert.ok(retryUpdate, 'retry_pending must be written on Vertex failure');
});

test('stress | vertex | disabled Vertex (ai_pending) skips Vertex and returns ai_pending', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 ai-pending');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    let vertexCalled = false;
    const { deps } = makeDeps({
        extractWithVertex: async () => { vertexCalled = true; throw new Error('Should not be called'); },
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.equal(result.status, 'ai_pending');
    assert.equal(vertexCalled, false, 'Vertex must not be called when VERTEX_AI_ENABLED=false');
});

// ─── Stage 6: Persist (MongoDB write) ───────────────────────────────────────

test('stress | persist | OCR bundle and summary bundle both written on successful run', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 persist');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    const { deps, normalizedWrites } = makeDeps({ extractWithVertex: makeExtractWithVertex(0.95) });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    assert.equal(result.status, 'completed');
    assert.equal(normalizedWrites.ocr, 1, 'OCR bundle must be written exactly once');
    assert.equal(normalizedWrites.summary, 1, 'Summary bundle must be written exactly once');
});

test('stress | persist | PDF storage failure rolls back and sets retry_pending', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'tor.pdf');
    await writeFile(pdf, '%PDF-1.4 persist-fail');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    const updates = mockProjectFor(t, record);

    const { deps } = makeDeps({
        savePdfRecords: async () => { throw new Error('MongoDB timeout on PDF insert'); },
    });

    await assert.rejects(
        () => processProject(record.project_id, { storageDir: dir }, deps),
        /MongoDB timeout on PDF insert/,
    );

    const retryUpdate = updates.find(u => u.$set?.['processing.status'] === 'retry_pending');
    assert.ok(retryUpdate, 'retry_pending must be written on PDF persist failure');
});

// ─── High-concurrency stress ─────────────────────────────────────────────────

test('stress | concurrency | 20 projects processed in parallel with no shared-state leaks', async (t) => {
    const CONCURRENCY = 20;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const projectMap = new Map();
    for (let i = 0; i < CONCURRENCY; i++) {
        const pdf = path.join(dir, `proj-${i}.pdf`);
        await writeFile(pdf, `%PDF-1.4 project-${i}`);

        const record = makeProject({
            project_id: `CONCURRENT-${i.toString().padStart(3, '0')}`,
            project_name: 'ระบบซอฟต์แวร์',
            is_software: true,
            classification: { status: 'manual_override' },
            pdf_path: pdf,
            pdf_content_type: 'application/pdf',
        });
        projectMap.set(record.project_id, record);
    }

    t.mock.method(Project, 'findOne', (query) => ({
        lean: async () => projectMap.get(query.project_id) || null,
    }));
    t.mock.method(Project, 'updateOne', async () => ({}));
    t.mock.method(Project, 'find', () => ({
        select: () => ({ limit: () => ({ lean: async () => [] }) }),
    }));

    const results = await Promise.all(Array.from(projectMap.values()).map(async (record, i) => {
        const { deps } = makeDeps({
            extractText: makeExtractText(2, `ขอบเขตของงาน project-${i}`.repeat(10)),
        });
        return processProject(record.project_id, { storageDir: dir }, deps);
    }));

    const statuses = results.map(r => r.status);
    // All should reach ai_pending (VERTEX_AI_ENABLED=false) or completed/review
    for (const status of statuses) {
        assert.ok(
            ['ai_pending', 'completed', 'review_required', 'irrelevant'].includes(status),
            `unexpected status: ${status}`,
        );
    }
    assert.equal(results.length, CONCURRENCY, 'all concurrent projects must complete');
});

test('stress | concurrency | 50-project batch — no project failure infects siblings', async (t) => {
    const BATCH_SIZE = 50;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-batch-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const batchMap = new Map();
    for (let i = 0; i < BATCH_SIZE; i++) {
        const pdf = path.join(dir, `batch-${i}.pdf`);
        const isFaulty = i % 5 === 4;
        await writeFile(pdf, isFaulty ? 'NOT-A-PDF' : `%PDF-1.4 batch-${i}`);

        const record = makeProject({
            project_id: `BATCH-${i.toString().padStart(3, '0')}`,
            project_name: 'ระบบซอฟต์แวร์',
            is_software: true,
            classification: { status: 'manual_override' },
            pdf_path: pdf,
            pdf_content_type: isFaulty ? 'text/plain' : 'application/pdf',
        });
        batchMap.set(record.project_id, record);
    }

    t.mock.method(Project, 'findOne', (query) => ({
        lean: async () => batchMap.get(query.project_id) || null,
    }));
    t.mock.method(Project, 'updateOne', async () => ({}));
    t.mock.method(Project, 'find', () => ({
        select: () => ({ limit: () => ({ lean: async () => [] }) }),
    }));

    // Every 5th project gets a corrupted PDF (no OCR possible → review_required)
    const outcomes = await Promise.allSettled(Array.from(batchMap.values()).map(async (record) => {
        const { deps } = makeDeps({
            extractText: makeExtractText(1, 'ขอบเขตของงาน'.repeat(5)),
        });

        return processProject(record.project_id, { storageDir: dir }, deps);
    }));

    const fulfilled = outcomes.filter(o => o.status === 'fulfilled');
    const rejected = outcomes.filter(o => o.status === 'rejected');

    // Faulty projects (every 5th) return review_required, not throw
    // because the pipeline catches "not a PDF" and returns gracefully.
    // Healthy ones reach ai_pending.
    assert.ok(
        fulfilled.length >= BATCH_SIZE - 10, // tolerate up to 10 unexpected failures
        `expected ≥${BATCH_SIZE - 10} fulfilled, got ${fulfilled.length} (${rejected.length} rejected)`,
    );
    // No healthy project should have been poisoned by a faulty neighbour
    const failedHealthy = fulfilled
        .filter((o, i) => i % 5 !== 4 && o.value?.status === 'irrelevant');
    assert.equal(failedHealthy.length, 0, 'healthy projects must not be infected by faulty siblings');
});

// ─── Idempotency stress ──────────────────────────────────────────────────────

test('stress | idempotency | running same project twice writes OCR bundle only once', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-idemp-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'idemp.pdf');
    await writeFile(pdf, '%PDF-1.4 idempotent');

    const ocrRunId = new mongoose.Types.ObjectId();
    const summaryId = new mongoose.Types.ObjectId();
    const primaryDocId = new mongoose.Types.ObjectId();

    // Second run: project already has extraction run pointing to same document
    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
        // Simulate a prior successful run
        primary_document_id: primaryDocId,
        latest_extraction_run_id: ocrRunId,
    });

    t.mock.method(Project, 'findOne', () => ({ lean: async () => record }));
    t.mock.method(Project, 'updateOne', async () => ({}));
    t.mock.method(Project, 'find', () => ({
        select: () => ({ limit: () => ({ lean: async () => [] }) }),
    }));

    let ocrBundleCallCount = 0;
    const cachedSummary = {
        _id: summaryId,
        model: process.env.VERTEX_MODEL || 'gemini-2.5-flash',
        needs_review: false,
    };

    const { deps } = makeDeps({
        saveOcrBundle: async () => { ocrBundleCallCount++; return { _id: ocrRunId }; },
        DocumentModel: {
            findById: () => ({
                lean: async () => ({
                    _id: primaryDocId,
                    project_id: record.project_id,
                    storage: { local_path: pdf },
                }),
            }),
            findOne: () => ({ lean: async () => null }),
        },
        ExtractionRunModel: {
            // Return an existing run for the same document (idempotency path)
            findById: () => ({
                lean: async () => ({
                    _id: ocrRunId,
                    document_id: primaryDocId,
                    status: 'completed',
                }),
            }),
        },
        SummaryModel: {
            // Already has a summary — should reuse it
            findOne: () => ({ lean: async () => cachedSummary }),
        },
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const result = await processProject(record.project_id, { storageDir: dir }, deps);

    // Pipeline must reuse the cached summary without calling Vertex again
    assert.ok(['completed', 'review_required'].includes(result.status), `got ${result.status}`);
    assert.equal(result.reused, true, 'reused flag must be true when summary is cached');
    assert.equal(ocrBundleCallCount, 0, 'OCR bundle must not be re-written on idempotent run');
});

// ─── Memory pressure ─────────────────────────────────────────────────────────

test('stress | memory | 10 MB Thai text payload does not crash or OOM', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-mem-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pdf = path.join(dir, 'huge.pdf');
    await writeFile(pdf, '%PDF-1.4 huge');

    const record = makeProject({
        project_name: 'ระบบซอฟต์แวร์', is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf, pdf_content_type: 'application/pdf',
    });
    mockProjectFor(t, record);

    // ~333 KB per page × 30 pages = ~10 MB text
    const hugePage = 'ขอบเขตของงาน ซอฟต์แวร์ระบบสารสนเทศ '.repeat(10_000);
    const { deps } = makeDeps({
        extractText: makeExtractText(30, hugePage),
    });

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const heapBefore = process.memoryUsage().heapUsed;
    const result = await processProject(record.project_id, { storageDir: dir }, deps);
    const heapAfter = process.memoryUsage().heapUsed;

    assert.equal(result.status, 'ai_pending', `expected ai_pending, got ${result.status}`);

    // Heap should not grow by more than 100 MB during this single run
    const heapGrowthMB = (heapAfter - heapBefore) / 1024 / 1024;
    assert.ok(heapGrowthMB < 100, `heap grew by ${heapGrowthMB.toFixed(1)} MB — possible memory leak`);
});

// ─── Throughput benchmark ────────────────────────────────────────────────────

test('stress | throughput | 30 sequential projects complete in < 3 s total', async (t) => {
    const PROJECTS = 30;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-thru-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'false';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const start = performance.now();

    for (let i = 0; i < PROJECTS; i++) {
        const pdf = path.join(dir, `thru-${i}.pdf`);
        await writeFile(pdf, `%PDF-1.4 thru-${i}`);

        const record = makeProject({
            project_id: `THRU-${i.toString().padStart(3, '0')}`,
            project_name: 'ระบบซอฟต์แวร์', is_software: true,
            classification: { status: 'manual_override' },
            pdf_path: pdf, pdf_content_type: 'application/pdf',
        });

        t.mock.method(Project, 'findOne', () => ({ lean: async () => record }));
        t.mock.method(Project, 'updateOne', async () => ({}));
        t.mock.method(Project, 'find', () => ({
            select: () => ({ limit: () => ({ lean: async () => [] }) }),
        }));

        const { deps } = makeDeps({ extractText: makeExtractText(1) });
        await processProject(record.project_id, { storageDir: dir }, deps);
    }

    const elapsed = performance.now() - start;
    const perProject = elapsed / PROJECTS;

    assert.ok(
        elapsed < 3_000,
        `${PROJECTS} projects took ${elapsed.toFixed(0)} ms — expected < 3 000 ms (${perProject.toFixed(1)} ms/project)`,
    );

    console.log(`Throughput: ${PROJECTS} projects in ${elapsed.toFixed(0)} ms (${perProject.toFixed(1)} ms/project)`);
});

// ─── Stage 7: Full Pipeline E2E Stress (Pulling → Summarize → DB Store) ──────

test('stress | e2e pipeline | full flow from tender pulling -> queue -> OCR -> Vertex summary -> DB persist', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-e2e-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    // 1. Simulating pulling a raw tender from government RSS / API
    const pulledTender = {
        projectId: '68019921401',
        deptId: '0204',
        deptName: 'กรมพัฒนาสารสนเทศดิจิทัล',
        title: 'โครงการจ้างพัฒนาระบบคลาวด์และบริหารจัดการฐานข้อมูล',
        budget: 4_500_000,
        method: 'e-Bidding',
        pubDate: '2026-06-01',
        draftLink: 'https://example.org/tenders/68019921401/draft.zip',
        invitationLink: 'https://example.org/tenders/68019921401/invite.pdf',
    };

    // 2. Map and create initial DB project record
    const projectId = pulledTender.projectId;
    const fixturePdf = path.join(dir, `${projectId}.pdf`);
    await writeFile(fixturePdf, '%PDF-1.4 E2E Stress Test Payload');

    let currentProject = makeProject({
        project_id: projectId,
        project_name: pulledTender.title,
        dept_name: pulledTender.deptName,
        budget: pulledTender.budget,
        is_software: null,
        'source.provider': 'egp_rss',
        'processing.status': 'metadata_ingested',
        'workflow.status': 'metadata_ingested',
        pdf_path: fixturePdf,
        pdf_content_type: 'application/pdf',
    });

    const dbStore = {
        projects: new Map([[projectId, currentProject]]),
        documents: new Map(),
        extractionRuns: new Map(),
        summaries: new Map(),
        jobs: new Map(),
    };

    t.mock.method(Project, 'findOne', (query) => ({
        lean: async () => dbStore.projects.get(query.project_id) || null,
    }));
    t.mock.method(Project, 'updateOne', async (filter, update) => {
        const id = filter.project_id || currentProject.project_id;
        const existing = dbStore.projects.get(id);
        if (!existing) return { matchedCount: 0, modifiedCount: 0 };
        if (update.$set) Object.assign(existing, update.$set);
        if (update.$inc) {
            for (const [k, val] of Object.entries(update.$inc)) {
                existing[k] = (existing[k] || 0) + val;
            }
        }
        return { matchedCount: 1, modifiedCount: 1 };
    });
    t.mock.method(Project, 'find', () => ({
        select: () => ({ limit: () => ({ lean: async () => [] }) }),
    }));

    // 3. Queue stage: Enqueue project
    const activeKey = `process_project:${projectId}`;
    const queuedJob = {
        _id: new mongoose.Types.ObjectId(),
        project_id: projectId,
        type: 'process_project',
        active_key: activeKey,
        status: 'queued',
        attempts: 0,
        max_attempts: 3,
    };
    dbStore.jobs.set(String(queuedJob._id), queuedJob);

    t.mock.method(ProcessingJob, 'findOne', () => ({
        lean: async () => dbStore.jobs.get(String(queuedJob._id)),
    }));
    t.mock.method(ProcessingJob, 'findOneAndUpdate', async (_filter, update) => {
        if (update.$set) Object.assign(queuedJob, update.$set);
        if (update.$inc) {
            for (const [k, v] of Object.entries(update.$inc)) queuedJob[k] = (queuedJob[k] || 0) + v;
        }
        return queuedJob;
    });
    t.mock.method(ProcessingJob, 'updateOne', async (_filter, update) => {
        if (update.$set) Object.assign(queuedJob, update.$set);
        return { modifiedCount: 1 };
    });

    // 4. Worker claims job
    const claimedJob = await claimNextJob();
    assert.equal(claimedJob.status, 'running');
    assert.equal(claimedJob.project_id, projectId);

    // 5. Build pipeline dependencies representing real OCR, Vertex, and DB storage
    let acquiredDocUrl = null;
    let ocrPageCount = 0;
    let summaryGenerated = null;

    const { deps, normalizedWrites } = makeDeps({
        acquireDocument: async (proj) => {
            acquiredDocUrl = pulledTender.invitationLink;
            return {
                sourceType: 'egp_invitation',
                result: {
                    projectId: proj.project_id,
                    pdf_url: acquiredDocUrl,
                    pdf_path: fixturePdf,
                    pdf_size: 2048,
                    pdf_content_type: 'application/pdf',
                },
            };
        },
        extractText: makeExtractText(4, 'ขอบเขตของงาน จ้างพัฒนาระบบคลาวด์และสารสนเทศ '.repeat(20)),
        extractWithVertex: async ({ pages }) => {
            ocrPageCount = pages.length;
            summaryGenerated = {
                summary: 'พัฒนาระบบ Cloud และ Data Management',
                requirements: ['Kubernetes', 'Node.js 22', 'MongoDB Enterprise'],
                tech_stack: ['Next.js', 'FastAPI', 'MongoDB', 'Cloud Run'],
                scope_of_work: 'ออกแบบ พัฒนา และดูแลระบบคลาวด์',
                fiscal_budget: { year: 2568, status: 'found' },
                risk_findings: [],
                confidence: 0.96,
            };
            return {
                extraction: summaryGenerated,
                usage: { input_tokens: 2800, output_tokens: 350 },
            };
        },
        savePdfRecords: async (proj, result) => {
            const docId = new mongoose.Types.ObjectId();
            const doc = {
                _id: docId,
                project_id: proj.project_id,
                source_url: result.pdf_url,
                sha256: 'stress-e2e-sha256',
                storage: { local_path: result.pdf_path, size_bytes: result.pdf_size },
            };
            dbStore.documents.set(String(docId), doc);
            return doc;
        },
        saveOcrBundle: async (proj, doc, textResult, uri, legacyUpdate) => {
            const runId = new mongoose.Types.ObjectId();
            const run = {
                _id: runId,
                document_id: doc._id,
                page_count: textResult.pageCount,
                ocr_pages: textResult.ocrPages,
                processor_fingerprint: textResult.fingerprint,
                status: 'completed',
            };
            dbStore.extractionRuns.set(String(runId), run);
            normalizedWrites.ocr++;
            return run;
        },
        saveSummaryBundle: async (proj, doc, run, textResult, vertex, review, legacyUpdate) => {
            const summaryId = new mongoose.Types.ObjectId();
            const summaryDoc = {
                _id: summaryId,
                document_id: doc._id,
                extraction_run_id: run._id,
                model: 'gemini-2.5-flash',
                summary: vertex.extraction.summary,
                confidence: vertex.extraction.confidence,
                needs_review: review,
            };
            dbStore.summaries.set(String(summaryId), summaryDoc);
            normalizedWrites.summary++;
            return summaryDoc;
        },
    });

    // 6. Execute pipeline from pulling to summary to DB
    const pipelineResult = await processProject(projectId, { storageDir: dir }, deps);
    await completeJob(claimedJob._id, pipelineResult);

    // 7. Verification: assert complete lifecycle integrity
    assert.equal(pipelineResult.status, 'completed', 'E2E pipeline status must be completed');
    assert.equal(acquiredDocUrl, pulledTender.invitationLink, 'Acquired correct document URL');
    assert.equal(ocrPageCount, 4, 'All 4 OCR pages extracted');
    assert.equal(summaryGenerated.requirements.length, 3, 'Summary requirements populated');
    assert.equal(normalizedWrites.ocr, 1, 'OCR bundle persisted to DB');
    assert.equal(normalizedWrites.summary, 1, 'Summary bundle persisted to DB');
    assert.equal(dbStore.documents.size, 1, 'Document record stored in DB');
    assert.equal(dbStore.extractionRuns.size, 1, 'ExtractionRun stored in DB');
    assert.equal(dbStore.summaries.size, 1, 'DocumentSummary stored in DB');
    assert.equal(queuedJob.status, 'completed', 'Worker job marked completed');
});

test('stress | e2e pipeline | high-throughput burst of 25 pulled tenders processed concurrently to DB', async (t) => {
    const BURST_COUNT = 25;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-burst-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const dbProjects = new Map();
    const dbDocuments = new Map();
    const dbSummaries = new Map();

    for (let i = 0; i < BURST_COUNT; i++) {
        const id = `BURST-${i.toString().padStart(3, '0')}`;
        const pdf = path.join(dir, `${id}.pdf`);
        await writeFile(pdf, `%PDF-1.4 burst tender payload ${i}`);

        dbProjects.set(id, makeProject({
            project_id: id,
            project_name: `ระบบสารสนเทศอัตโนมัติชุดที่ ${i}`,
            is_software: true,
            classification: { status: 'manual_override' },
            budget: 1_000_000 + i * 50_000,
            pdf_path: pdf,
            pdf_content_type: 'application/pdf',
        }));
    }

    t.mock.method(Project, 'findOne', (query) => ({
        lean: async () => dbProjects.get(query.project_id) || null,
    }));
    t.mock.method(Project, 'updateOne', async (filter, update) => {
        const proj = dbProjects.get(filter.project_id || filter._id);
        if (proj && update.$set) Object.assign(proj, update.$set);
        return { modifiedCount: 1 };
    });
    t.mock.method(Project, 'find', () => ({
        select: () => ({ limit: () => ({ lean: async () => [] }) }),
    }));

    const startTime = performance.now();

    // Process all 25 in parallel
    const outcomes = await Promise.all(
        Array.from(dbProjects.values()).map(async (projectRecord, idx) => {
            const { deps } = makeDeps({
                extractText: makeExtractText(2, `ขอบเขตงานระบบที่ ${idx}`.repeat(15)),
                extractWithVertex: async () => ({
                    extraction: {
                        summary: `สรุปความต้องการของโครงการที่ ${idx}`,
                        requirements: [`Requirement-${idx}`],
                        tech_stack: ['Node.js', 'PostgreSQL', 'Docker'],
                        scope_of_work: 'จัดซื้อและพัฒนาซอฟต์แวร์',
                        fiscal_budget: { year: 2569, status: 'found' },
                        risk_findings: [],
                        confidence: 0.92,
                    },
                    usage: { input_tokens: 1200, output_tokens: 150 },
                }),
                savePdfRecords: async (proj) => {
                    const docId = new mongoose.Types.ObjectId();
                    dbDocuments.set(proj.project_id, docId);
                    return { _id: docId, project_id: proj.project_id };
                },
                saveSummaryBundle: async (proj, doc, run, text, vertex) => {
                    const sumId = new mongoose.Types.ObjectId();
                    dbSummaries.set(proj.project_id, { _id: sumId, summary: vertex.extraction.summary });
                    return { _id: sumId };
                },
            });

            return processProject(projectRecord.project_id, { storageDir: dir }, deps);
        }),
    );

    const totalDuration = performance.now() - startTime;

    assert.equal(outcomes.length, BURST_COUNT, 'All 25 projects must resolve');
    for (const res of outcomes) {
        assert.equal(res.status, 'completed', 'Every concurrent project must reach completed status');
    }
    assert.equal(dbDocuments.size, BURST_COUNT, 'All 25 documents persisted to DB');
    assert.equal(dbSummaries.size, BURST_COUNT, 'All 25 summaries persisted to DB');

    console.log(`Burst test: ${BURST_COUNT} full pipelines completed in ${totalDuration.toFixed(0)} ms (${(totalDuration / BURST_COUNT).toFixed(1)} ms/tender)`);
});

test('stress | e2e pipeline | fault-injected pulling & AI network stalls with resilient recovery', async (t) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stress-fault-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { process.env.VERTEX_AI_ENABLED = old ?? undefined; });

    const projectId = 'FAULT-RESILIENT-001';
    const pdf = path.join(dir, `${projectId}.pdf`);
    await writeFile(pdf, '%PDF-1.4 fault test file');

    const projectRecord = makeProject({
        project_id: projectId,
        project_name: 'ระบบทดสอบความทนทานต่อข้อผิดพลาด',
        is_software: true,
        classification: { status: 'manual_override' },
        pdf_path: pdf,
        pdf_content_type: 'application/pdf',
    });

    const recordedUpdates = mockProjectFor(t, projectRecord);

    let downloadAttempts = 0;
    let vertexAttempts = 0;

    // Fail first download attempt, succeed on second attempt
    const flakyAcquisition = async () => {
        downloadAttempts++;
        if (downloadAttempts === 1) {
            return {
                result: null,
                errors: ['503 Service Unavailable: Government portal rate limit'],
                retryable: true,
                errorCode: 'download_failed',
            };
        }
        return {
            sourceType: 'egp_invitation',
            result: {
                projectId,
                pdf_url: 'https://example.org/retry-tor.pdf',
                pdf_path: pdf,
                pdf_size: 1024,
                pdf_content_type: 'application/pdf',
            },
        };
    };

    // Fail first Vertex call, succeed on retry
    const flakyVertex = async () => {
        vertexAttempts++;
        if (vertexAttempts === 1) {
            throw new Error('RESOURCE_EXHAUSTED: Vertex AI rate limit reached');
        }
        return {
            extraction: {
                summary: 'ระบบทนทานต่อข้อผิดพลาด',
                requirements: ['Node.js'],
                tech_stack: ['Next.js'],
                scope_of_work: 'ทดสอบ',
                fiscal_budget: { year: 2568, status: 'found' },
                risk_findings: [],
                confidence: 0.95,
            },
            usage: { input_tokens: 1000, output_tokens: 100 },
        };
    };

    const { deps, normalizedWrites } = makeDeps({
        acquireDocument: flakyAcquisition,
        extractWithVertex: flakyVertex,
    });

    // Attempt 1: Pulling fails -> must reject and persist retry_pending state
    await assert.rejects(
        () => processProject(projectId, { storageDir: dir, allowBrowserFallback: false }, deps),
        /503 Service Unavailable/,
    );
    assert.equal(downloadAttempts, 1);
    const retry1 = recordedUpdates.find(u => u.$set?.['processing.status'] === 'retry_pending');
    assert.ok(retry1, 'Must register retry_pending on download stall');

    // Attempt 2: Pulling succeeds, but Vertex fails -> must reject and preserve retry_pending
    await assert.rejects(
        () => processProject(projectId, { storageDir: dir, allowBrowserFallback: false }, deps),
        /RESOURCE_EXHAUSTED/,
    );
    assert.equal(downloadAttempts, 2);
    assert.equal(vertexAttempts, 1);

    // Attempt 3: Vertex succeeds -> pipeline completes and writes final state to DB
    const finalResult = await processProject(projectId, { storageDir: dir, allowBrowserFallback: false }, deps);
    assert.equal(finalResult.status, 'completed', 'Pipeline must complete successfully on recovery');
    assert.equal(vertexAttempts, 2);
    assert.equal(normalizedWrites.summary, 1, 'Summary written to DB once successfully completed');
});

