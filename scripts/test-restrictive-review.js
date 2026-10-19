// Controlled text fixture: schema/orchestration test, not a real procurement accusation.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import ExtractionRun from '../models/ExtractionRun.js';
import DocumentSummary from '../models/DocumentSummary.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { persistOcrBundle } from '../lib/mongo-artifacts.js';
import { reanalyzeStoredProject } from '../lib/vertex/reanalyze-project.js';
import { extractTorWithVertex } from '../lib/vertex/tor-extractor.js';
import { hydrateProjectCompatibility } from '../lib/project-compat.js';
import { toTorDetail } from '../lib/api/tor-response.js';

const live = process.argv.includes('--live-vertex');
const stamp = Date.now().toString(36);
const dbName = `mtn_risk_review_${stamp}`;
const cert = 'ผู้เสนอราคาต้องเป็น AcmeERP Platinum Partner เท่านั้น และวิศวกรทุกคนต้องมีใบรับรอง AcmeERP เท่านั้น ห้ามใช้ใบรับรองเทียบเท่า';
const team = 'ต้องจัดวิศวกรอาวุโส 150 คนประจำหน้างานเต็มเวลาตลอด 30 วัน สำหรับเว็บค้นหาเอกสารและส่งออก CSV ที่มีผู้ใช้ 10 คน';
const pages = [
    { page_number: 1, text: 'ขอบเขตงาน: สร้างเว็บภายในสำหรับค้นหารายการเอกสารและส่งออก CSV ผู้ใช้ 10 คน ดำเนินการ 30 วัน ไม่เชื่อมต่อระบบเดิม' },
    { page_number: 2, text: cert }, { page_number: 3, text: team },
    { page_number: 4, text: '\uFFFD'.repeat(300) }, { page_number: 5, text: '' },
    { page_number: 6, text: '9. งบประมาณ\nใช้เงินปีงบประมาณ 2570 จำนวน 100,000 บาท' },
];
const modelFixture = { summary: 'โครงการเว็บค้นหาเอกสารและส่งออก CSV พร้อมข้อกำหนดที่ควรตรวจสอบ',
    qualifications: [], scope_of_work: [], tech_stack: [], flagged_clauses: [],
    fiscal_year_evidence: [{ year: 2570, page: 6, clause_text: 'ปีงบประมาณ 2570' }],
    risk_findings: [
        { category: 'vendor_lock_in', clause_text: cert, page: 2 },
        { category: 'excessive_team_capacity', clause_text: team, page: 3 },
    ].map(r => ({ ...r, severity: 'high', confidence: 0.95,
        explanation: 'เงื่อนไขอาจจำกัดการแข่งขันเกินความจำเป็นตามขอบเขตที่ระบุ', highlight_reason: 'ข้อกำหนดจำกัดทางเลือก' })),
    confidence: 0.95, document_language: 'th' };

async function fixture(id, sourcePages) {
    const project = await Project.create({ project_id: id, project_name: 'Controlled risk-review text fixture', dept_name: 'Isolated test', budget: 100000 });
    const hash = createHash('sha256').update(JSON.stringify(sourcePages)).digest('hex');
    const document = await Document.create({ project_id: id, project_ref: project._id, sha256: hash,
        filename: 'controlled-text-fixture.pdf', document_type: 'tor', is_primary: true, is_current_primary: true,
        storage: { backend: 'remote' } });
    await persistOcrBundle(project.toObject(), document, { pages: sourcePages, pageCount: sourcePages.length,
        fingerprint: 'controlled-text-fixture-v1', textHash: hash, needsReview: false }, null,
    { $set: { 'processing.status': 'text_extracted' } });
    return project;
}

try {
    process.env.MONGODB_DB_NAME = dbName;
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    await Promise.all([Project, Document, DocumentPage, ExtractionRun, DocumentSummary].map(m => m.init()));
    const project = await fixture(`risk-fixture-${stamp}`, pages);
    let aiCalls = 0;
    const result = await reanalyzeStoredProject(project.project_id, { extractWithVertex: async (input, deps) => {
        aiCalls++;
        return extractTorWithVertex(input, live ? deps : { ...deps, headers: async () => ({}),
            fetchImpl: async () => Response.json({ modelVersion: 'test-fixture', candidates: [{ finishReason: 'STOP',
                content: { parts: [{ text: JSON.stringify(modelFixture) }] } }] }) });
    } });
    const stored = await Project.findById(project._id).lean();
    const summary = await DocumentSummary.findById(stored.latest_summary_id).lean();
    assert.ok(stored.flagged_clauses.some(f => f.category === 'vendor_lock_in'));
    assert.ok(stored.flagged_clauses.some(f => f.category === 'excessive_team_capacity'));
    assert.ok(stored.flagged_clauses.every(f => f.reason?.length));
    assert.equal(stored.flagged_clauses_meta.summary_id.toString(), stored.latest_summary_id.toString());
    assert.equal(summary.extraction.analysis_coverage.status, 'partial');
    assert.deepEqual(summary.extraction.analysis_coverage.skipped_pages.map(p => p.page_number), [4, 5]);
    assert.equal(summary.extraction.fiscal_budget.year, 2570);
    assert.equal(result.status, 'review_required');
    const view = toTorDetail(await hydrateProjectCompatibility(stored));
    assert.ok(view.anomalies.some(f => f.category === 'excessive_team_capacity' && f.reason));
    // Repair a missing read cache from the cached canonical summary, without a new AI request.
    await Project.updateOne({ _id: project._id }, { $unset: { flagged_clauses: '', flagged_clauses_meta: '' } });
    const again = await reanalyzeStoredProject(project.project_id, { extractWithVertex: async () => assert.fail('must reuse summary') });
    assert.equal(again.reused, true);
    assert.equal(await DocumentSummary.countDocuments({ project_id: project.project_id }), 1);
    const repaired = await Project.findById(project._id).lean();
    assert.ok(repaired.flagged_clauses.length >= 2);
    const unreadable = await fixture(`unreadable-${stamp}`, [{ page_number: 1, text: '\uFFFD'.repeat(200) }]);
    const skipped = await reanalyzeStoredProject(unreadable.project_id, { extractWithVertex: async () => assert.fail('no readable input') });
    assert.equal(skipped.status, 'review_required');
    assert.equal(skipped.skipped, true);
    assert.equal(await DocumentSummary.countDocuments({ project_id: unreadable.project_id }), 0);
    console.log(JSON.stringify({ result: 'PASS', database: dbName, project_id: project.project_id,
        vertex: live ? 'live' : 'mocked HTTP response', aiCalls, flagged_clauses: repaired.flagged_clauses,
        flagged_clauses_meta: repaired.flagged_clauses_meta,
        cachedRetry: again.reused, unreadableResult: skipped.status,
        scope: 'Controlled text fixture; no real PDF OCR or live government acquisition' }, null, 2));
} catch (e) { console.error(`${e.name}: ${e.message}`); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
