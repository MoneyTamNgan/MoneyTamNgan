import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import ExtractionRun from '../models/ExtractionRun.js';
import DocumentSummary from '../models/DocumentSummary.js';
import FiscalBudgetAnalysis from '../models/FiscalBudgetAnalysis.js';
import { classifyProjectMetadata } from './classifier.js';
import { loadKeywordSets } from './keywords.js';
import { resolveFiscalBudget, validateFiscalYearEvidence } from './fiscal-budget.js';
import { prepareReadablePages } from './vertex/readable-pages.js';
import { extractTorWithVertex } from './vertex/tor-extractor.js';
import { TOR_PROMPT_VERSION } from './vertex/response-schema.js';
import { withMongoTransaction } from './mongo-artifacts.js';
import { FISCAL_BACKFILL_VERSION, FISCAL_SOURCE_POINTERS as pointers, fiscalSourceSnapshot, fiscalCacheIsCurrent } from './fiscal-cache.js';
export { FISCAL_BACKFILL_VERSION, fiscalSourceSnapshot, fiscalCacheIsCurrent } from './fiscal-cache.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function supportedLlmEvidence(items, pages, warnings) {
    const accepted = [];
    for (const item of Array.isArray(items) ? items : []) {
        try {
            if (!Number.isInteger(item.year) || item.year < 2500 || item.year > 2699
                || !Number.isInteger(item.page) || typeof item.clause_text !== 'string') throw new Error('invalid');
            validateFiscalYearEvidence([item], pages);
            accepted.push(item);
        } catch { warnings.push('unsupported_fiscal_evidence_rejected'); }
    }
    return accepted;
}

/** Assess all available documents together. Different supported years across
 * announcement/TOR sources are ambiguous rather than silently overwriting one. */
export function assessStoredFiscalSources(sources) {
    const evidence = [], warnings = [], coverage = [], selectedYears = [];
    let readable = 0, missing = false;
    for (const source of sources) {
        const prepared = prepareReadablePages(source.pages || []);
        readable += prepared.pages.length;
        if (!prepared.pages.length) missing = true;
        coverage.push({ source: source.role, document_id: source.document?._id || null,
            extraction_run_id: source.run?._id || null, status: prepared.pages.length ? prepared.coverage.status : 'document_unavailable',
            reason: source.reason || (!prepared.pages.length ? 'missing_or_unreadable_text' : null) });
        if (prepared.coverage.status === 'partial') warnings.push(`${source.role}:partial_text`);
        if (source.run?.needs_review) warnings.push(`${source.role}:ocr_requires_review`);
        const llm = supportedLlmEvidence(source.llmEvidence
            || source.summary?.extraction?.fiscal_budget?.evidence?.filter(item => item.method === 'llm'), prepared.pages, warnings);
        const fiscal = resolveFiscalBudget(prepared.pages, llm);
        selectedYears.push(...fiscal.years);
        warnings.push(...(fiscal.warnings || []).map(warning => `${source.role}:${warning}`));
        for (const item of fiscal.evidence) evidence.push({ ...item, source: source.role,
            document_id: source.document?._id, extraction_run_id: source.run?._id });
    }
    // Apply context selection within each source, preserving cross-source conflicts.
    const years = [...new Set(selectedYears)].sort((a, b) => a - b);
    const methods = new Set(evidence.filter(item => item.selected).map(item => item.method));
    const status = years.length > 1 ? 'ambiguous' : years.length ? 'found'
        : !readable || missing ? 'document_unavailable' : 'not_found';
    if (years.length > 1) warnings.push('conflicting_fiscal_years');
    if (missing) warnings.push('incomplete_document_coverage');
    return { year: years.length === 1 ? years[0] : null, years, status,
        method: methods.size > 1 ? 'regex+llm' : [...methods][0] || 'none',
        source: 'combined', evidence, coverage, warnings: [...new Set(warnings)],
        needs_review: status === 'ambiguous' || warnings.some(w => /ocr_requires_review|partial_text|unsupported|context_requires_review/.test(w)) };
}

async function readSources(project, dependencies) {
    const Documents = dependencies.DocumentModel || Document;
    const Runs = dependencies.ExtractionRunModel || ExtractionRun;
    const Pages = dependencies.PageModel || DocumentPage;
    const Summaries = dependencies.SummaryModel || DocumentSummary;
    const sources = [];
    for (const [role, documentKey, runKey] of [
        ['announcement', 'announcement_document_id', 'announcement_extraction_run_id'],
        ['tor', 'primary_document_id', 'latest_extraction_run_id'],
    ]) {
        const document = project[documentKey] ? await Documents.findById(project[documentKey]).lean() : null;
        const source = { role, document, run: null, pages: [] };
        sources.push(source);
        if (!document || document.project_id !== project.project_id) { source.reason = 'missing_document'; source.document = null; continue; }
        const run = project[runKey] ? await Runs.findById(project[runKey]).lean()
            : await Runs.findOne({ document_id: document._id, status: { $in: ['completed', 'review_required'] } })
                .sort({ created_at: -1, _id: -1 }).lean();
        if (!run || String(run.document_id) !== String(document._id)
            || !['completed', 'review_required'].includes(run.status)) { source.reason = 'missing_matching_extraction'; continue; }
        source.run = run;
        source.pages = await Pages.find({ extraction_run_id: run._id }).sort({ page_number: 1 }).lean();
        source.summary = await Summaries.findOne({ document_id: document._id, extraction_run_id: run._id })
            .sort({ processed_at: -1, _id: -1 }).lean();
    }
    return sources;
}

let indexesReady = null;
async function ensureIndexes() {
    indexesReady ||= (async () => { await FiscalBudgetAnalysis.createCollection(); await FiscalBudgetAnalysis.createIndexes(); })()
        .catch(error => { indexesReady = null; throw error; });
    await indexesReady;
}

export async function backfillProjectFiscalBudget(project, options = {}, dependencies = {}) {
    const { dryRun = true, allowLlm = false, downloadOpen = false, budget = { llm: 2, downloads: 1 } } = options;
    const Projects = dependencies.ProjectModel || Project;
    const Analyses = dependencies.AnalysisModel || FiscalBudgetAnalysis;
    const keywords = options.keywords || await (dependencies.loadKeywords || loadKeywordSets)({ seed: false });
    const software = project.classification?.status === 'manual_override' ? project.is_software
        : classifyProjectMetadata({ project_name: project.project_name }, keywords).isSoftware;
    if (software !== true) return { projectId: project.project_id, status: 'skipped', reason: 'software_not_confirmed' };
    let sources = await readSources(project, dependencies);
    let result = assessStoredFiscalSources(sources);
    // Use the main acquisition pipeline only with explicit opt-in and current
    // official open evidence. Historical records may use stored text, never download.
    if (!dryRun && downloadOpen && !result.years.length && sources.some(s => !s.pages.length)) {
        if (budget.downloads < 1) return { projectId: project.project_id, status: 'deferred', reason: 'download_budget_exhausted' };
        const verify = dependencies.verifyEligibility || (await import('./project-announcement.js')).verifyProcurementWithAnnouncement;
        const eligibility = await verify(project);
        if (eligibility.status === 'open') {
            budget.downloads--;
            await (dependencies.processProject || (await import('./processing-pipeline.js')).processProject)(project.project_id);
            project = await Projects.findOne({ project_id: project.project_id }).lean();
            sources = await readSources(project, dependencies);
            result = assessStoredFiscalSources(sources);
        } else result.warnings.push(`new_download_skipped:${eligibility.status}`);
    }
    const snapshot = fiscalSourceSnapshot(project);
    const inputKey = hash([project.project_id, FISCAL_BACKFILL_VERSION, snapshot,
        sources.map(s => [s.role, s.document?.sha256, s.run?._id, s.run?.text_sha256, s.summary?._id, hash(s.pages.map(p => [p.page_number, p.text]))]),
        allowLlm && process.env.VERTEX_AI_ENABLED === 'true' ? [process.env.VERTEX_MODEL || 'gemini-2.5-flash', TOR_PROMPT_VERSION] : 'regex-and-existing-evidence']);
    let analysis = await Analyses.findOne({ input_key: inputKey }).lean();
    let llmCalls = 0;
    if (analysis) result = analysis.result;
    else if (!dryRun && allowLlm && process.env.VERTEX_AI_ENABLED === 'true' && !result.years.length) {
        const pending = sources.filter(source => prepareReadablePages(source.pages).pages.length
            && !(source.summary?.prompt_version === TOR_PROMPT_VERSION && source.summary?.extraction?.fiscal_budget));
        // Preflight the whole project so a low budget cannot repeatedly pay for
        // its first source while never reaching the second source.
        if (budget.llm < pending.length) return { projectId: project.project_id, status: 'deferred', reason: 'llm_budget_exhausted', llmCalls: 0 };
        for (const source of sources) {
            const pages = prepareReadablePages(source.pages).pages;
            if (!pages.length || (source.summary?.prompt_version === TOR_PROMPT_VERSION
                && source.summary?.extraction?.fiscal_budget)) continue;
            if (budget.llm < 1) return { projectId: project.project_id, status: 'deferred', reason: 'llm_budget_exhausted', llmCalls };
            budget.llm--; llmCalls++;
            const vertex = await (dependencies.extractWithVertex || extractTorWithVertex)({ pages, extractionRunId: String(source.run._id) });
            source.llmEvidence = vertex.extraction.fiscal_budget?.evidence?.filter(i => i.method === 'llm') || [];
        }
        result = assessStoredFiscalSources(sources);
    }
    if (dryRun) return { projectId: project.project_id, status: result.status, fiscalBudget: result,
        reused: Boolean(analysis), wouldWrite: !analysis || project.fiscal_budget_meta?.input_key !== inputKey };
    if (dependencies.ensureIndexes) await dependencies.ensureIndexes();
    else if (Analyses === FiscalBudgetAnalysis) await ensureIndexes();
    if (analysis && project.fiscal_budget_meta?.input_key === inputKey && project.fiscal_budget
        && fiscalCacheIsCurrent(project)
        && String(project.latest_fiscal_analysis_id) === String(analysis._id)
        && hash(project.fiscal_budget) === hash(analysis.result)) {
        return { projectId: project.project_id, status: result.status, fiscalBudget: result, reused: true, changed: false, llmCalls };
    }
    const transaction = dependencies.transaction || withMongoTransaction;
    const guard = Object.fromEntries(pointers.map(key => [key, Object.hasOwn(project, key) ? project[key] : { $exists: false }]));
    const reused = Boolean(analysis);
    await transaction(async session => {
        analysis = await Analyses.findOneAndUpdate({ input_key: inputKey }, { $setOnInsert: {
            project_id: project.project_id, project_ref: project._id, input_key: inputKey,
            parser_version: FISCAL_BACKFILL_VERSION, source_snapshot: snapshot, result,
            sources: sources.map(s => ({ source: s.role, document_id: s.document?._id, extraction_run_id: s.run?._id,
                sha256: s.document?.sha256, text_sha256: s.run?.text_sha256 })),
        } }, { session, upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
        const linked = await Projects.updateOne({ _id: project._id, ...guard }, { $set: {
            latest_fiscal_analysis_id: analysis._id, fiscal_budget: analysis.result,
            fiscal_budget_meta: { parser_version: FISCAL_BACKFILL_VERSION, input_key: inputKey,
                source_snapshot: snapshot, analysis_id: analysis._id, updated_at: new Date() },
        } }, { session });
        if (linked.matchedCount === 0) throw new Error('Project sources changed during fiscal backfill; retry current records');
    });
    return { projectId: project.project_id, status: result.status, fiscalBudget: result, reused, changed: true,
        analysisId: String(analysis._id), llmCalls };
}

export async function backfillFiscalBudgets(options = {}, dependencies = {}) {
    const { batchSize = 5, scanLimit = 100, afterId = null, dryRun = true, allowLlm = false,
        downloadOpen = false, maxLlmCalls = 2, maxDownloads = 1, onlyStoredText = true } = options;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100
        || !Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 1000
        || (afterId !== null && !mongoose.isObjectIdOrHexString(afterId))
        || [dryRun, allowLlm, downloadOpen, onlyStoredText].some(v => typeof v !== 'boolean')
        || [maxLlmCalls, maxDownloads].some(v => !Number.isInteger(v) || v < 0 || v > 100)) throw new TypeError('Invalid fiscal backfill options');
    const Projects = dependencies.ProjectModel || Project;
    const filter = afterId ? { _id: { $lt: new mongoose.Types.ObjectId(afterId) } } : {};
    if (onlyStoredText) filter.$or = [{ latest_extraction_run_id: { $type: 'objectId' } },
        { announcement_extraction_run_id: { $type: 'objectId' } }];
    const projects = await Projects.find(filter)
        .sort({ _id: -1 }).limit(scanLimit).lean();
    const keywords = await (dependencies.loadKeywords || loadKeywordSets)({ seed: false });
    const report = { dryRun, scanned: 0, attempted: 0, changed: 0, statuses: {}, skipped: {}, errors: [], results: [],
        nextAfterId: null, exhausted: false, llmCalls: 0, downloads: 0 };
    const budget = { llm: maxLlmCalls, downloads: maxDownloads };
    for (const project of projects) {
        if (report.attempted >= batchSize) break;
        report.scanned++; report.nextAfterId = String(project._id);
        const software = project.classification?.status === 'manual_override' ? project.is_software
            : classifyProjectMetadata({ project_name: project.project_name }, keywords).isSoftware;
        if (software !== true) {
            const reason = software === false ? 'not_software' : 'uncertain_software';
            report.skipped[reason] = (report.skipped[reason] || 0) + 1; continue;
        }
        report.attempted++;
        try {
            const result = await (dependencies.backfillProject || backfillProjectFiscalBudget)(project,
                { dryRun, allowLlm, downloadOpen, budget, keywords }, dependencies);
            report.results.push(result);
            report.statuses[result.status] = (report.statuses[result.status] || 0) + 1;
            if (result.changed) report.changed++;
        } catch (error) { report.errors.push({ projectId: project.project_id, error: error.message }); }
    }
    report.llmCalls = maxLlmCalls - budget.llm;
    report.downloads = maxDownloads - budget.downloads;
    report.exhausted = report.scanned === projects.length && projects.length < scanLimit;
    return report;
}

/** Invoked after the ordinary worker pipeline, never initiating downloads or AI. */
export async function refreshProjectFiscalBudget(projectId, dependencies = {}) {
    const Projects = dependencies.ProjectModel || Project;
    const project = await Projects.findOne({ project_id: String(projectId) }).lean();
    if (!project) return { projectId, status: 'skipped', reason: 'project_missing' };
    return backfillProjectFiscalBudget(project, { dryRun: false }, dependencies);
}
