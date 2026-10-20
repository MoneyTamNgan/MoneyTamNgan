import Project from '../models/Project.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import ExtractionRun from '../models/ExtractionRun.js';
import DocumentSummary from '../models/DocumentSummary.js';
import { extractPdfText } from './text-extraction.js';
import { downloadAttachment } from './scraper.js';
import { removeTransientDocuments, hashFile } from './document-storage.js';
import { officialInvitationUrl, verifyProcurementWithAnnouncement } from './project-announcement.js';
import { persistOcrBundle, persistSummaryBundle } from './mongo-artifacts.js';
import { extractTorWithVertex } from './vertex/tor-extractor.js';
import { TOR_PROMPT_VERSION } from './vertex/response-schema.js';
import { prepareReadablePages } from './vertex/readable-pages.js';
import { resolveFiscalBudget } from './fiscal-budget.js';
import { classifyProjectMetadata } from './classifier.js';
import { loadKeywordSets } from './keywords.js';

/** Same OCR/Vertex and normalized history as TOR, with separate project pointers.
 * Only an officially verified open software tender may acquire a new announcement. */
export async function analyzeAnnouncement(project, options = {}, dependencies = {}) {
    const Projects = dependencies.ProjectModel || Project;
    const Documents = dependencies.DocumentModel || Document;
    const Runs = dependencies.ExtractionRunModel || ExtractionRun;
    const Pages = dependencies.PageModel || DocumentPage;
    const Summaries = dependencies.SummaryModel || DocumentSummary;
    const saveOcr = dependencies.saveOcr || persistOcrBundle;
    const saveSummary = dependencies.saveSummary || persistSummaryBundle;
    const id = project.project_id;
    const software = project.classification?.status === 'manual_override' ? project.is_software
        : classifyProjectMetadata({ project_name: project.project_name }, await (dependencies.loadKeywords || loadKeywordSets)()).isSoftware;
    if (software !== true) return { projectId: id, status: 'skipped', reason: 'software_not_confirmed' };
    if (!project.announcement_document_id) return { projectId: id, status: 'skipped', reason: 'announcement_missing' };
    const eligibility = options.verifiedEligibility
        || await (dependencies.verifyEligibility || verifyProcurementWithAnnouncement)(project);
    if (eligibility.status !== 'open') return { projectId: id, status: 'skipped', reason: 'bidding_not_verified_open', eligibility };
    const document = await Documents.findById(project.announcement_document_id).lean();
    if (!document || document.project_id !== id) throw new Error('Linked announcement document is missing or belongs to another project');
    let run = await Runs.findOne({ document_id: document._id, status: { $in: ['completed', 'review_required'] } })
        .sort({ created_at: -1, _id: -1 }).lean();
    let textResult, file;
    try {
        if (run) {
            const pages = await Pages.find({ extraction_run_id: run._id }).sort({ page_number: 1 }).lean();
            textResult = { pages, textHash: run.text_sha256, fingerprint: run.processor_fingerprint,
                pageCount: run.page_count, ocrPages: run.ocr_pages, needsReview: run.needs_review };
            const linked = await Projects.updateOne({ _id: project._id, announcement_document_id: document._id }, {
                $set: { announcement_extraction_run_id: run._id },
            });
            if (linked.matchedCount === 0) throw new Error('Announcement changed; retry current document');
        } else {
            const url = officialInvitationUrl(document.source_url);
            file = await (dependencies.download || downloadAttachment)({ name: `announcement-${id}.pdf`, type: 'pdf', url },
                { projectId: id, storageDir: options.storageDir });
            const hashed = await (dependencies.hash || hashFile)(file.path);
            if (hashed.sha256 !== document.sha256) throw new Error('Announcement PDF changed; refresh announcement discovery before analysis');
            textResult = await (dependencies.extractText || extractPdfText)(file.path);
            run = await saveOcr(project, document, textResult, null, { $set: {
                'announcement_analysis.status': 'text_extracted', 'announcement_analysis.error': null,
            } }, {}, { role: 'announcement' });
        }
        const models = { ProjectModel: Projects, DocumentModel: Documents, ExtractionRunModel: Runs,
            PageModel: Pages, SummaryModel: Summaries };
        const currentProject = { ...project, announcement_extraction_run_id: run._id };
        const existing = await Summaries.findOne({ extraction_run_id: run._id,
            model: process.env.VERTEX_MODEL || 'gemini-2.5-flash', prompt_version: TOR_PROMPT_VERSION }).lean();
        let vertex;
        if (existing) {
            vertex = { extraction: existing.extraction, model: existing.model, modelVersion: existing.model_version,
                promptVersion: existing.prompt_version,
                usage: { inputTokens: existing.usage?.input_tokens || 0, outputTokens: existing.usage?.output_tokens || 0 } };
        } else {
            const prepared = prepareReadablePages(textResult.pages);
            const fiscal = resolveFiscalBudget(prepared.pages);
            const enabled = process.env.VERTEX_AI_ENABLED === 'true';
            if (!prepared.pages.length || !enabled) {
                const status = prepared.pages.length ? 'ai_pending' : 'review_required';
                await Projects.updateOne({ _id: project._id, announcement_document_id: document._id,
                    announcement_extraction_run_id: run._id }, { $set: {
                    announcement_fiscal_budget: { ...fiscal, document_id: document._id, extraction_run_id: run._id },
                    announcement_analysis: { status, error: null, updated_at: new Date() },
                }, $unset: { announcement_summary_id: '' } });
                return { projectId: id, status, fiscalBudget: fiscal, eligibility, vertexCalled: false };
            }
            vertex = await (dependencies.extractWithVertex || extractTorWithVertex)({
                pages: textResult.pages, extractionRunId: String(run._id),
            });
        }
        const needsReview = Boolean(textResult.needsReview) || vertex.extraction.analysis_coverage?.status === 'partial'
            || vertex.extraction.fiscal_budget?.status === 'ambiguous'
            || Boolean(vertex.extraction.fiscal_budget?.warnings?.length)
            || vertex.extraction.confidence < Number(process.env.VERTEX_REVIEW_THRESHOLD || 0.8)
            || vertex.extraction.risk_findings?.some(f => f.severity === 'high');
        const status = needsReview ? 'review_required' : 'completed';
        let summary;
        if (existing) {
            const linked = await Projects.updateOne({ _id: project._id,
                announcement_document_id: document._id, announcement_extraction_run_id: run._id }, { $set: {
                announcement_summary_id: existing._id,
                announcement_fiscal_budget: { ...existing.extraction.fiscal_budget,
                    document_id: document._id, extraction_run_id: run._id, summary_id: existing._id },
                announcement_analysis: { status, error: null, updated_at: new Date() },
            } });
            if (linked.matchedCount === 0) throw new Error('Announcement changed; retry current document');
            summary = existing;
        } else {
            summary = await saveSummary(currentProject, document, run, textResult, vertex, needsReview,
                { $set: { announcement_analysis: { status, error: null, updated_at: new Date() } } },
                models, { role: 'announcement' });
        }
        return { projectId: id, status, reused: Boolean(existing), eligibility,
            documentId: String(document._id), extractionRunId: String(run._id), summaryId: String(summary._id),
            fiscalBudget: vertex.extraction.fiscal_budget };
    } catch (error) {
        await Projects.updateOne({ _id: project._id, announcement_document_id: document._id }, { $set: {
            announcement_analysis: { status: 'retry_pending', error: error.message.slice(0, 500), updated_at: new Date() },
        } });
        throw error;
    } finally { if (file) await (dependencies.cleanup || removeTransientDocuments)({ pdf_path: file.path }, textResult); }
}
