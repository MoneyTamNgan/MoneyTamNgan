import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import { prepareReadablePages } from '../lib/vertex/readable-pages.js';
import { extractTorWithVertex } from '../lib/vertex/tor-extractor.js';
import { projectFlaggedClauseFields, MAX_PROJECT_FLAGS } from '../lib/flagged-clauses.js';
import { persistSummaryBundle } from '../lib/mongo-artifacts.js';
import { reanalyzeStoredProject } from '../lib/vertex/reanalyze-project.js';

const cert = 'ผู้เสนอราคาต้องเป็น AcmeERP Platinum Partner เท่านั้น ไม่รับใบรับรองเทียบเท่า';
const team = 'ต้องมีวิศวกรอาวุโส 150 คนประจำเต็มเวลา สำหรับเว็บส่งออก CSV ผู้ใช้ 10 คน';
const risk = (category, clause_text, page) => ({ category, clause_text, page, severity: 'high', confidence: 0.95,
    explanation: 'อาจจำกัดการแข่งขันเกินความจำเป็นตามขอบเขตที่ระบุ', highlight_reason: 'ข้อกำหนดจำกัดทางเลือก' });
const extraction = () => ({ summary: 'สรุปจากส่วนที่อ่านได้', qualifications: [], scope_of_work: [], tech_stack: [],
    flagged_clauses: [], risk_findings: [risk('vendor_lock_in', cert, 2), risk('excessive_team_capacity', team, 5)],
    fiscal_year_evidence: [], confidence: 0.9, document_language: 'th' });
const lean = value => ({ lean: async () => value });

test('readable sections survive missing/garbled pages without renumbering or dropping table numbers', () => {
    const p = prepareReadablePages([{ page_number: 2, text: `${cert}\n${'\uFFFD'.repeat(50)}\n2569` },
        { page_number: 3, text: '' }, { page_number: 4, text: '\uE001'.repeat(40) },
        { page_number: 5, text: team }]);
    assert.deepEqual(p.pages.map(p => p.page_number), [2, 5]);
    assert.ok(p.pages[0].text.includes('2569'));
    assert.ok(!p.pages[0].text.includes('\uFFFD'));
    assert.equal(p.coverage.status, 'partial');
    assert.equal(p.coverage.skipped_pages.length, 3);
});

test('Vertex receives only readable sections and the new restrictive-condition instructions', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'unit-fixture';
    t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = old; });
    const result = await extractTorWithVertex({ pages: [
        { page_number: 2, text: cert }, { page_number: 3, text: '' },
        { page_number: 4, text: '\uFFFD'.repeat(200) }, { page_number: 5, text: team },
    ] }, { headers: async () => ({}), fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        const prompt = body.systemInstruction.parts[0].text;
        assert.match(prompt, /Proprietary certificate lock-in/);
        assert.match(prompt, /excessive_team_capacity/);
        assert.match(prompt, /Large numbers alone are not evidence/);
        const sent = JSON.parse(body.contents[0].parts[0].text).document_pages;
        assert.deepEqual(sent.map(p => p.page_number), [2, 5]);
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(extraction()) }] } }] });
    } });
    assert.equal(result.extraction.risk_findings.length, 2);
    assert.equal(result.extraction.analysis_coverage.status, 'partial');
    assert.deepEqual(result.extraction.analysis_coverage.skipped_pages.map(p => p.page_number), [3, 4]);
});

test('unsupported quoted risk is rejected and recorded for review, not stored as a source-backed flag', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'unit-fixture';
    t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = old; });
    const response = extraction();
    response.risk_findings = [risk('vendor_lock_in', 'invented proprietary restriction', 1)];
    const result = await extractTorWithVertex({ pages: [{ page_number: 1, text: 'ใช้มาตรฐานเปิดและยอมรับผลิตภัณฑ์เทียบเท่า' }] }, {
        headers: async () => ({}), fetchImpl: async () => Response.json({ candidates: [{ finishReason: 'STOP',
            content: { parts: [{ text: JSON.stringify(response) }] } }] }),
    });
    assert.equal(result.extraction.risk_findings.length, 0);
    assert.equal(result.extraction.analysis_warnings[0].code, 'unsupported_clause_evidence');
    assert.equal(result.extraction.analysis_coverage.status, 'partial');
});

test('all unreadable/missing input skips Vertex without throwing or pretending to assess risks', async () => {
    for (const pages of [undefined, [], [{ page_number: 1, text: '' }], [{ page_number: 2, text: '\uFFFD'.repeat(90) }]]) {
        const result = await extractTorWithVertex({ pages }, { headers: async () => assert.fail('no auth/AI request needed') });
        assert.equal(result.skipped, true);
        assert.equal(result.extraction.analysis_coverage.status, 'unreadable');
        assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
    }
});

test('authorization failures on readable text remain real failures, not silently skipped sections', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'unit-fixture';
    t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = old; });
    await assert.rejects(extractTorWithVertex({ pages: [{ page_number: 2, text: cert }] }, {
        headers: async () => ({}), fetchImpl: async () => Response.json({ error: { message: 'Forbidden' } }, { status: 403 }),
    }), /HTTP 403/);
});

test('project risk projection is bounded, deduplicated and tagged with summary provenance', async () => {
    const summaryId = new mongoose.Types.ObjectId(), docId = new mongoose.Types.ObjectId(), runId = new mongoose.Types.ObjectId();
    const e = extraction();
    e.flagged_clauses = [{ clause_text: cert, reason: 'generic duplicate', page: 2 }];
    const fields = projectFlaggedClauseFields({ _id: summaryId, model: 'test', prompt_version: 'v7', extraction: e }, { _id: docId }, { _id: runId });
    assert.equal(fields.flagged_clauses.length, 2);
    assert.equal(fields.flagged_clauses[0].reason, e.risk_findings[0].explanation);
    const p = new Project({ project_id: 'fixture', project_name: 'fixture', dept_name: 'test', budget: 1, ...fields });
    await p.validate();
    assert.equal(p.flagged_clauses_meta.summary_id.toString(), summaryId.toString());
    const many = { ...e, flagged_clauses: Array.from({ length: 150 }, (_, i) => ({ clause_text: `clause ${i}`, reason: 'reason', page: 1 })) };
    const bounded = projectFlaggedClauseFields({ extraction: many }, {}, {});
    assert.equal(bounded.flagged_clauses.length, MAX_PROJECT_FLAGS);
    assert.equal(bounded.flagged_clauses_meta.truncated, true);
});

test('summary transaction writes project flagged_clauses alongside latest_summary_id', async () => {
    let update;
    const vertex = { extraction: extraction(), model: 'test', modelVersion: '1', promptVersion: 'v7', usage: { inputTokens: 1, outputTokens: 1 } };
    await persistSummaryBundle({ _id: 'p' }, { _id: 'd', project_id: 'fixture', sha256: 'h' }, { _id: 'r' },
        { textHash: 'text' }, vertex, true, { $set: { 'processing.status': 'review_required' } }, {
            SummaryModel: { findOneAndUpdate: async () => ({ _id: 's' }) },
            DocumentModel: { updateOne: async () => {} },
            ProjectModel: { updateOne: async (_filter, u) => { update = u; return { matchedCount: 1 }; } },
        }, { transactionRunner: fn => fn('session') });
    assert.equal(update.$set.latest_summary_id, 's');
    assert.equal(update.$set.flagged_clauses.length, 2);
    assert.equal(update.$set.flagged_clauses_meta.summary_id, 's');
});

test('stored-text reanalysis with no readable sections finishes review instead of failing the worker', async () => {
    let update;
    const result = await reanalyzeStoredProject('fixture', {
        ProjectModel: { findOne: () => lean({ _id: 'p', primary_document_id: 'd', latest_extraction_run_id: 'r' }),
            updateOne: async (_f, u) => { update = u; return { matchedCount: 1 }; } },
        DocumentModel: { findById: () => lean({ _id: 'd' }) },
        ExtractionRunModel: { findById: () => lean({ _id: 'r', document_id: 'd' }) },
        SummaryModel: { findOne: () => lean(null) },
        PageModel: { find: () => ({ sort: () => lean([{ page_number: 4, text: '\uFFFD'.repeat(100) }]) }) },
        extractWithVertex: async () => assert.fail('unreadable input must not call Vertex'),
    });
    assert.equal(result.status, 'review_required');
    assert.equal(result.retryable, false);
    assert.equal(result.skipped, true);
    assert.equal(update.$set.flagged_clauses_meta.analysis_status, 'unreadable');
});
