import 'dotenv/config';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import Document from '../models/Document.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { acquireTenderDocuments, createAcquisitionContext } from '../lib/tender-acquisition.js';
import { persistDocuments } from './ingest-open-tenders.js';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ExtractionRun from '../models/ExtractionRun.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import { persistOcrBundle, persistSummaryBundle } from '../lib/mongo-artifacts.js';
import { extractTorWithVertex } from '../lib/vertex/tor-extractor.js';

const file = process.argv.find(a => a.startsWith('--file='))?.slice(7);
const database = `mtn_schedule_test_${Date.now()}`;
try {
    if (!file || !process.env.MONGODB_URI) throw new Error('Requires --file=/path/announcement.pdf and MONGODB_URI');
    // Never target application data; retain test records for inspection.
    process.env.MONGODB_DB_NAME = database;
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    await Promise.all([Project.init(), Document.init(), ExtractionRun.init(), DocumentPage.init(), DocumentSummary.init()]);
    const tender = { projectId: '69099693138', invitationLink:
        'https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=6572bdad-5898-4bb8-9095-8378e36c9801' };
    const project = await Project.create({ project_id: tender.projectId, project_name: 'Announcement schedule integration fixture',
        source: { provider: 'egp_rss' }, is_software: false });
    const acquired = await acquireTenderDocuments(tender, createAcquisitionContext({ allowBrowser: false }), {
        download: async () => ({ path: file, size: (await stat(file)).size, contentType: 'application/pdf' }),
    });
    assert.equal(acquired.announcement.schedule.status, 'parsed');
    for (let i = 0; i < 2; i++) await persistDocuments(project.toObject(), tender, acquired, 'local');
    const stored = await Project.findById(project._id).lean();
    assert.equal(stored.bidding_date.date, '2026-10-08');
    assert.equal(stored.submission_schedule.start_time, '09:00');
    assert.equal(stored.submission_schedule.end_time, '12:00');
    assert.equal(stored.submission_schedule.ends_at.toISOString(), '2026-10-08T05:00:00.000Z');
    assert.equal(stored.tender.closes_at.getTime(), stored.submission_schedule.ends_at.getTime());
    assert.equal(stored.announcement_schedule.status, 'parsed');
    assert.equal(stored.announcement_schedule.document_id.toString(), stored.announcement_document_id.toString());
    assert.equal(stored.announcement_schedule.evidence[0].page, 1);
    assert.equal(await Document.countDocuments({ project_id: tender.projectId }), 1);
    assert.equal(await Project.countDocuments(), 1);
    let fiscalBudget = null;
    if (process.argv.includes('--combined')) {
        // Controlled TOR text tests integration, not OCR accuracy of a real TOR.
        const text = '9. งบประมาณ\nโครงการพัฒนาระบบสารสนเทศ ใช้เงินปีงบประมาณ ๒๕๗๐ จำนวน 1,000,000 บาท';
        const pages = [{ page_number: 1, text, extraction_method: 'embedded', confidence: null }];
        const hash = createHash('sha256').update(text).digest('hex');
        const tor = await Document.create({ project_id: tender.projectId, project_ref: project._id,
            filename: 'controlled-tor-text-fixture.pdf', document_type: 'tor', sha256: hash,
            is_primary: true, is_current_primary: true, storage: { backend: 'remote' } });
        const textResult = { pages, pageCount: 1, textHash: hash, fingerprint: 'controlled-text-fixture-v1', needsReview: false };
        const response = { summary: 'โครงการพัฒนาระบบสารสนเทศ ใช้งบประมาณปี 2570',
            qualifications: [], scope_of_work: [], tech_stack: [], flagged_clauses: [], risk_findings: [],
            fiscal_year_evidence: [{ year: 2570, page: 1, clause_text: 'ปีงบประมาณ ๒๕๗๐' }],
            confidence: 0.95, document_language: 'th' };
        for (let i = 0; i < 2; i++) {
            const current = await Project.findById(project._id).lean();
            const run = await persistOcrBundle(current, tor, textResult, null, { $set: { 'processing.status': 'text_extracted' } });
            const vertex = await extractTorWithVertex({ pages }, {
                headers: async () => ({}),
                fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP',
                    content: { parts: [{ text: JSON.stringify(response) }] } }], modelVersion: 'controlled-test',
                    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }), { status: 200 }),
            });
            const summary = await persistSummaryBundle(current, tor, run, textResult, vertex, false,
                { $set: { 'processing.status': 'completed' } });
            fiscalBudget = summary.extraction.fiscal_budget;
        }
        const combined = await Project.findById(project._id).lean();
        assert.equal(combined.submission_schedule.end_time, '12:00');
        assert.equal(combined.bidding_date.date, '2026-10-08');
        assert.ok(combined.latest_summary_id);
        assert.ok(combined.latest_extraction_run_id);
        assert.equal(fiscalBudget.year, 2570);
        assert.equal(fiscalBudget.method, 'regex+llm');
        assert.equal(await ExtractionRun.countDocuments(), 1);
        assert.equal(await DocumentPage.countDocuments(), 1);
        assert.equal(await DocumentSummary.countDocuments(), 1);
    }
    console.log(JSON.stringify({ result: 'PASS', path: `${database}.projects`, filter: { project_id: tender.projectId },
        bidding_date: stored.bidding_date, submission_schedule: stored.submission_schedule,
        announcement_schedule: stored.announcement_schedule, duplicate_documents: 0,
        fiscal_budget: fiscalBudget, vertex_mode: fiscalBudget ? 'mocked HTTP response; real validation and Atlas transactions' : 'not invoked' }, null, 2));
} catch (e) {
    console.error(`${e.name}: ${e.message}`);
    process.exitCode = 1;
} finally { await mongoose.disconnect(); }
