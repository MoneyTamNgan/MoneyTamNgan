import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { assessStoredFiscalSources, backfillProjectFiscalBudget, backfillFiscalBudgets,
    fiscalSourceSnapshot, FISCAL_BACKFILL_VERSION } from '../../lib/fiscal-backfill.js';
import { fiscalCacheIsCurrent } from '../../lib/fiscal-cache.js';
import { hydrateProjectCompatibility } from '../../lib/project-compat.js';
import FiscalBudgetAnalysis from '../../models/FiscalBudgetAnalysis.js';

const query = value => ({ sort() { return this; }, limit() { return this; }, lean: async () => value });
const project = fields => ({ _id: new mongoose.Types.ObjectId(), project_id: '69000000001', is_software: true,
    classification: { status: 'manual_override' }, primary_document_id: 'tor', latest_extraction_run_id: 'tor-run',
    announcement_document_id: 'announcement', announcement_extraction_run_id: 'announcement-run', ...fields });
const source = (role, text) => ({ role, document: { _id: role }, run: { _id: `${role}-run` }, pages: [{ page_number: 1, text }] });
function fixture(p = project(), texts = { tor: '9. ปีงบประมาณ ๒๕๗๐', announcement: 'ประกาศปีงบประมาณ 2570' }) {
    const analyses = [], writes = [], calls = { llm: 0, downloads: 0 };
    const documents = Object.keys(texts).map(role => ({ _id: role, project_id: p.project_id, sha256: role }));
    const dependencies = {
        ProjectModel: {
            updateOne: async (filter, update) => { writes.push({ filter, update }); Object.assign(p, update.$set); return { matchedCount: 1 }; },
            findOne: () => query(p), find: () => query([p]),
        },
        DocumentModel: { findById: id => query(documents.find(d => d._id === id)) },
        ExtractionRunModel: { findById: id => query({ _id: id, document_id: id.replace('-run', ''), status: 'completed', text_sha256: 'text' }),
            findOne: () => query(null) },
        PageModel: { find: filter => query([{ page_number: 1, text: texts[filter.extraction_run_id.replace('-run', '')] }]) },
        SummaryModel: { findOne: () => query(null) },
        AnalysisModel: { findOne: filter => query(analyses.find(a => a.input_key === filter.input_key) || null),
            findOneAndUpdate: async (filter, update) => {
                let existing = analyses.find(a => a.input_key === filter.input_key);
                if (!existing) { existing = { _id: new mongoose.Types.ObjectId(), ...update.$setOnInsert }; analyses.push(existing); }
                return existing;
            } },
        loadKeywords: async options => { assert.equal(options.seed, false); return {}; },
        transaction: work => work('test-session'), ensureIndexes: async () => {},
        extractWithVertex: async () => { calls.llm++; return { extraction: { fiscal_budget: { evidence: [] } } }; },
        verifyEligibility: async () => { calls.downloads++; return { status: 'closed' }; },
        processProject: async () => assert.fail('closed projects must not acquire documents'),
    };
    return { p, dependencies, analyses, writes, calls };
}

test('combines Thai-digit fiscal evidence across announcements/TOR, without inferring calendar years', () => {
    const result = assessStoredFiscalSources([source('announcement', 'ประกาศปีงบประมาณ ๒๕๗๐'), source('tor', '9. ปีงบประมาณ 2570')]);
    assert.equal(result.year, 2570);
    assert.equal(result.evidence.length, 2);
    assert.equal(result.evidence[0].source, 'announcement');
    assert.equal(assessStoredFiscalSources([source('tor', 'เสนอราคาวันที่ 23 ตุลาคม 2570')]).status, 'not_found');
});

test('different supported years remain ambiguous; no silent source overwrite', () => {
    const result = assessStoredFiscalSources([source('announcement', 'ปีงบประมาณ 2569'), source('tor', 'ปีงบประมาณ 2570')]);
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.year, null);
    assert.deepEqual(result.years, [2569, 2570]);
    assert.ok(result.needs_review);
});

test('unavailable sections are explicit, and unsupported cached LLM evidence is rejected', () => {
    const s = source('tor', 'รายละเอียดการจ้าง ไม่ได้ระบุปี');
    s.llmEvidence = [{ year: 2570, page: 1, clause_text: 'ปีงบประมาณ 2570' }];
    const result = assessStoredFiscalSources([s, { role: 'announcement', pages: [] }]);
    assert.equal(result.status, 'document_unavailable');
    assert.ok(result.warnings.includes('unsupported_fiscal_evidence_rejected'));
    assert.deepEqual(result.years, []);
});

test('dry-run neither writes nor calls Vertex, downloads or index creation', async () => {
    const { p, dependencies, writes, calls, analyses } = fixture();
    dependencies.ensureIndexes = async () => assert.fail('dry-run must not create indexes');
    const result = await backfillProjectFiscalBudget(p, { dryRun: true, allowLlm: true, downloadOpen: true }, dependencies);
    assert.equal(result.fiscalBudget.year, 2570);
    assert.equal(writes.length + analyses.length + calls.llm + calls.downloads, 0);
});

test('historical stored text is processed without downloading; repeat makes no new analysis or writes', async () => {
    const { p, dependencies, analyses, writes, calls } = fixture(project({ project_status: 'Closed' }));
    const first = await backfillProjectFiscalBudget(p, { dryRun: false }, dependencies);
    assert.equal(first.status, 'found');
    assert.equal(p.fiscal_budget.year, 2570);
    assert.equal(writes[0].filter.primary_document_id, 'tor');
    const repeat = await backfillProjectFiscalBudget(p, { dryRun: false }, dependencies);
    assert.equal(repeat.changed, false);
    assert.equal(analyses.length, 1);
    assert.equal(writes.length, 1);
    assert.deepEqual(calls, { llm: 0, downloads: 0 });
});

test('missing cache is restored from immutable analysis without duplicating records', async () => {
    const { p, dependencies, analyses } = fixture();
    await backfillProjectFiscalBudget(p, { dryRun: false }, dependencies);
    delete p.fiscal_budget;
    const restored = await backfillProjectFiscalBudget(p, { dryRun: false }, dependencies);
    assert.equal(restored.reused, true);
    assert.equal(p.fiscal_budget.year, 2570);
    assert.equal(analyses.length, 1);
});

test('LLM is used only after regex has no years, with a preflight per-batch budget', async t => {
    const old = process.env.VERTEX_AI_ENABLED;
    process.env.VERTEX_AI_ENABLED = 'true';
    t.after(() => { if (old === undefined) delete process.env.VERTEX_AI_ENABLED; else process.env.VERTEX_AI_ENABLED = old; });
    const found = fixture();
    await backfillProjectFiscalBudget(found.p, { dryRun: false, allowLlm: true }, found.dependencies);
    assert.equal(found.calls.llm, 0);
    const missing = fixture(project(), { tor: 'รายละเอียดงานพัฒนาระบบ', announcement: 'ประกาศเชิญชวน' });
    const deferred = await backfillProjectFiscalBudget(missing.p,
        { dryRun: false, allowLlm: true, budget: { llm: 1, downloads: 0 } }, missing.dependencies);
    assert.equal(deferred.status, 'deferred');
    assert.equal(missing.calls.llm, 0);
    assert.equal(missing.writes.length, 0);
});

test('closed bidding cannot download missing PDFs even with the acquisition opt-in', async () => {
    const { p, dependencies, calls } = fixture(project(), {});
    const result = await backfillProjectFiscalBudget(p, { dryRun: false, downloadOpen: true }, dependencies);
    assert.equal(result.status, 'document_unavailable');
    assert.ok(result.fiscalBudget.warnings.includes('new_download_skipped:closed'));
    assert.equal(calls.downloads, 1); // verification, not acquisition
});

test('project source changes fail the guarded transaction instead of linking stale evidence', async () => {
    const { p, dependencies } = fixture();
    dependencies.ProjectModel.updateOne = async () => ({ matchedCount: 0 });
    await assert.rejects(backfillProjectFiscalBudget(p, { dryRun: false }, dependencies), /sources changed/);
});

test('API uses the unified result only when all source pointers still match', async () => {
    const p = project({ primary_document_id: undefined, latest_extraction_run_id: undefined,
        announcement_document_id: undefined, announcement_extraction_run_id: undefined });
    p.fiscal_budget = { year: 2570, years: [2570], status: 'found' };
    p.fiscal_budget_meta = { parser_version: FISCAL_BACKFILL_VERSION, source_snapshot: fiscalSourceSnapshot(p) };
    assert.equal(fiscalCacheIsCurrent(p), true);
    assert.equal((await hydrateProjectCompatibility(p)).extracted_data.fiscal_budget.year, 2570);
    const stale = { ...p, announcement_document_id: 'new-announcement' };
    assert.equal(fiscalCacheIsCurrent(stale), false);
    assert.equal((await hydrateProjectCompatibility(stale, { DocumentModel: { find: () => query([]) } })).fiscal_budget, undefined);
});

test('batch validates bounds, preserves manual exclusions and isolates a project failure', async () => {
    await assert.rejects(backfillFiscalBudgets({ batchSize: 0 }), TypeError);
    const one = project(), two = project({ project_id: 'two' }), excluded = project({ is_software: false });
    const { dependencies } = fixture();
    dependencies.ProjectModel.find = () => query([one, two, excluded]);
    dependencies.backfillProject = async p => { if (p === one) throw new Error('unavailable'); return { status: 'found', changed: true }; };
    const result = await backfillFiscalBudgets({}, dependencies);
    assert.equal(result.errors.length, 1);
    assert.equal(result.changed, 1);
    assert.equal(result.skipped.not_software, 1);
});

test('analysis uniqueness and dry-run model configuration prevent accidental history duplication', () => {
    assert.ok(FiscalBudgetAnalysis.schema.indexes().some(([keys, options]) => keys.input_key === 1 && options.unique));
    assert.equal(FiscalBudgetAnalysis.schema.options.autoCreate, false);
    assert.equal(FiscalBudgetAnalysis.schema.options.autoIndex, false);
});
