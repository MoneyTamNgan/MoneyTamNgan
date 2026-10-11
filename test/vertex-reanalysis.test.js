import assert from 'node:assert/strict';
import test from 'node:test';
import { reanalyzeStoredProject } from '../lib/vertex/reanalyze-project.js';
import { TOR_PROMPT_VERSION } from '../lib/vertex/response-schema.js';

const lean = value => ({ lean: async () => value });

test('stored OCR pages can be reanalyzed without scraping or OCR', async () => {
    const updates = [];
    let saved = null;
    const project = { _id: 'project-1', project_id: '67000000001',
        primary_document_id: 'document-1', latest_extraction_run_id: 'run-1' };
    const document = { _id: 'document-1', project_id: project.project_id, sha256: 'pdf-hash' };
    const run = { _id: 'run-1', document_id: 'document-1', text_sha256: 'text-hash', page_count: 2,
        ocr_pages: 1, needs_review: false };
    const extraction = { summary: 'สรุป', qualifications: [], scope_of_work: [], tech_stack: [],
        flagged_clauses: [], risk_findings: [{ category: 'vendor_lock_in', severity: 'high',
            clause_text: 'ต้องใช้ Brand X เท่านั้น', explanation: 'จำกัดการแข่งขัน',
            highlight_reason: 'ไม่มีผลิตภัณฑ์เทียบเท่า', page: 2, confidence: 0.96 }],
        confidence: 0.92, document_language: 'th' };
    const result = await reanalyzeStoredProject(project.project_id, {
        ProjectModel: {
            findOne: () => lean(project),
            updateOne: async (...args) => updates.push(args),
        },
        DocumentModel: { findById: () => lean(document) },
        ExtractionRunModel: { findById: () => lean(run) },
        SummaryModel: { findOne: () => lean(null) },
        PageModel: { find: () => ({ sort: () => lean([
            { page_number: 1, text: '' },
            { page_number: 2, text: 'ต้องใช้ Brand X เท่านั้น' },
        ]) }) },
        extractWithVertex: async ({ pages }) => {
            assert.deepEqual(pages, [{ page_number: 2, text: 'ต้องใช้ Brand X เท่านั้น' }]);
            return { extraction, model: 'gemini-2.5-flash', modelVersion: 'test',
                promptVersion: TOR_PROMPT_VERSION, usage: { inputTokens: 10, outputTokens: 5 } };
        },
        saveSummaryBundle: async (...args) => {
            saved = args;
            return { _id: 'summary-v3' };
        },
    });
    assert.equal(result.status, 'review_required');
    assert.equal(result.reused, false);
    assert.equal(result.documentSummaryId, 'summary-v3');
    assert.equal(saved[5], true);
    assert.equal(saved[3].textHash, 'text-hash');
    assert.equal(updates.length, 0);
});

test('stored v3 summary is reused idempotently', async () => {
    const updates = [];
    const result = await reanalyzeStoredProject('67000000001', {
        ProjectModel: {
            findOne: () => lean({ _id: 'project-1', project_id: '67000000001',
                primary_document_id: 'document-1', latest_extraction_run_id: 'run-1' }),
            updateOne: async (...args) => updates.push(args),
        },
        DocumentModel: { findById: () => lean({ _id: 'document-1' }) },
        ExtractionRunModel: { findById: () => lean({ _id: 'run-1', document_id: 'document-1' }) },
        SummaryModel: { findOne: () => lean({ _id: 'summary-v3', needs_review: false,
            extraction: { risk_findings: [] } }) },
    });
    assert.equal(result.reused, true);
    assert.equal(result.status, 'completed');
    assert.equal(updates[0][1].$set.latest_summary_id, 'summary-v3');
});
