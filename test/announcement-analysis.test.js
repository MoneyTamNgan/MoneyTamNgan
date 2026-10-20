import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAnnouncement } from '../lib/announcement-analysis.js';
import { persistOcrBundle, persistSummaryBundle } from '../lib/mongo-artifacts.js';
import { hydrateProjectCompatibility } from '../lib/project-compat.js';

const query = value => ({ sort() { return this; }, lean: async () => value });
const project = { _id: 'project', project_id: '69099617982', is_software: true,
    classification: { status: 'manual_override' }, announcement_document_id: 'announcement',
    primary_document_id: 'tor', latest_extraction_run_id: 'tor-run', latest_summary_id: 'tor-summary' };
const document = { _id: 'announcement', project_id: project.project_id, sha256: 'pdfhash',
    source_url: 'https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=fixture' };
const run = { _id: 'announcement-run', document_id: 'announcement', text_sha256: 'texthash', page_count: 1, processor_fingerprint: 'test' };
const text = { pages: [{ page_number: 1, text: '9. งบประมาณ ปีงบประมาณ ๒๕๗๐' }],
    textHash: 'texthash', fingerprint: 'test', pageCount: 1, needsReview: false };
const vertex = { extraction: { summary: 'ประกาศเชิญชวน', fiscal_budget: {
    year: 2570, years: [2570], status: 'found', method: 'regex', evidence: [] }, confidence: 0.95 },
    model: 'gemini-2.5-flash', modelVersion: 'test', promptVersion: 'test', usage: { inputTokens: 10, outputTokens: 5 } };
function deps() {
    const updates = [], saves = [];
    return { updates, saves, dependencies: {
        ProjectModel: { updateOne: async (...args) => { updates.push(args); return { matchedCount: 1 }; } },
        DocumentModel: { findById: () => query(document) },
        ExtractionRunModel: { findOne: () => query(run) },
        PageModel: { find: () => query(text.pages) },
        SummaryModel: { findOne: () => query(null) },
        verifyEligibility: async () => ({ status: 'open' }),
        extractWithVertex: async () => vertex,
        saveSummary: async (...args) => { saves.push(args); return { _id: 'announcement-summary' }; },
        download: async () => assert.fail('durable OCR must not download again'),
    } };
}
function enableVertex(t, value = 'true') {
    const previous = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = value;
    t.after(() => { if (previous === undefined) delete process.env.VERTEX_AI_ENABLED; else process.env.VERTEX_AI_ENABLED = previous; });
}

test('announcement reuses durable OCR and the same Vertex extractor without changing TOR pointers', async t => {
    enableVertex(t);
    const { dependencies, saves } = deps();
    const result = await analyzeAnnouncement(project, {}, dependencies);
    assert.equal(result.fiscalBudget.year, 2570);
    assert.equal(result.summaryId, 'announcement-summary');
    assert.equal(saves[0][8].role, 'announcement');
    assert.equal(saves[0][6].$set.announcement_analysis.status, 'completed');
    assert.equal(saves[0][6].$set.latest_summary_id, undefined);
});

test('cached announcement summary makes no new Vertex request', async t => {
    enableVertex(t);
    const { dependencies } = deps();
    dependencies.SummaryModel.findOne = () => query({ _id: 'existing-summary', extraction: vertex.extraction, model: vertex.model });
    dependencies.extractWithVertex = async () => assert.fail('must reuse summary');
    dependencies.saveSummary = async () => assert.fail('immutable cached summary must not be rewritten');
    const result = await analyzeAnnouncement(project, {}, dependencies);
    assert.equal(result.reused, true);
    assert.equal(result.summaryId, 'existing-summary');
});

test('closed or unverified bidding never acquires or analyzes a new announcement', async () => {
    for (const status of ['closed', 'unknown', 'not_yet_open']) {
        const { dependencies } = deps();
        dependencies.verifyEligibility = async () => ({ status });
        dependencies.DocumentModel.findById = () => assert.fail('must stop at eligibility');
        assert.equal((await analyzeAnnouncement(project, {}, dependencies)).reason, 'bidding_not_verified_open');
    }
});

test('unreadable announcements preserve an explicit result without Vertex or breaking processing', async t => {
    enableVertex(t);
    const { dependencies, updates } = deps();
    dependencies.PageModel.find = () => query([{ page_number: 1, text: '' }]);
    dependencies.extractWithVertex = async () => assert.fail('must skip unreadable text');
    const result = await analyzeAnnouncement(project, {}, dependencies);
    assert.equal(result.status, 'review_required');
    assert.equal(result.fiscalBudget.status, 'not_found');
    assert.equal(updates.at(-1)[1].$unset.announcement_summary_id, '');
});

test('announcement OCR/summary transactions guard announcement pointers, never the primary TOR pointers', async () => {
    const writes = [];
    const models = {
        ProjectModel: { updateOne: async (...args) => { writes.push(args); return { matchedCount: 1 }; } },
        DocumentModel: { updateOne: async () => {} },
        ExtractionRunModel: { findOneAndUpdate: async () => run },
        PageModel: { updateMany: async () => {}, bulkWrite: async () => {}, deleteMany: async () => {} },
        SummaryModel: { findOneAndUpdate: async () => ({ _id: 'announcement-summary' }) },
    };
    const options = { role: 'announcement', transactionRunner: work => work('session') };
    await persistOcrBundle(project, document, text, null, {}, models, options);
    assert.equal(writes[0][1].$set.announcement_extraction_run_id, run._id);
    assert.equal(writes[0][1].$set.primary_document_id, undefined);
    assert.equal(writes[0][1].$unset.latest_summary_id, undefined);
    await persistSummaryBundle(project, document, run, text, vertex, false, {}, models, options);
    const [filter, update] = writes[1];
    assert.equal(filter.announcement_document_id, document._id);
    assert.equal(update.$set.announcement_summary_id, 'announcement-summary');
    assert.equal(update.$set.announcement_fiscal_budget.year, 2570);
    assert.equal(update.$set.latest_summary_id, undefined);
    assert.equal(update.$set['workflow.status'], undefined);
});

test('API fiscal-year fallback is provenance-checked and does not invent a TOR summary', async () => {
    const p = { project_id: project.project_id, announcement_document_id: 'announcement',
        announcement_extraction_run_id: 'announcement-run', announcement_summary_id: 'announcement-summary',
        announcement_fiscal_budget: { ...vertex.extraction.fiscal_budget, document_id: 'announcement',
            extraction_run_id: 'announcement-run', summary_id: 'announcement-summary' } };
    const result = await hydrateProjectCompatibility(p);
    assert.equal(result.extracted_data.fiscal_budget.year, 2570);
    assert.equal(result.extracted_data.fiscal_budget.source, 'announcement');
    assert.equal(result.extracted_data.summary, undefined);
    const stale = await hydrateProjectCompatibility({ ...p, announcement_document_id: 'revised' });
    assert.equal(stale.extracted_data, undefined);
});
