import Document from '../../models/Document.js';
import DocumentPage from '../../models/DocumentPage.js';
import DocumentSummary from '../../models/DocumentSummary.js';
import ExtractionRun from '../../models/ExtractionRun.js';
import Project from '../../models/Project.js';
import { persistSummaryBundle } from '../mongo-artifacts.js';
import { extractTorWithVertex } from './tor-extractor.js';
import { TOR_PROMPT_VERSION } from './response-schema.js';

/** Run only Vertex analysis against immutable OCR pages already stored in MongoDB. */
export async function reanalyzeStoredProject(projectId, dependencies = {}) {
    const ProjectModel = dependencies.ProjectModel || Project;
    const DocumentModel = dependencies.DocumentModel || Document;
    const PageModel = dependencies.PageModel || DocumentPage;
    const SummaryModel = dependencies.SummaryModel || DocumentSummary;
    const ExtractionRunModel = dependencies.ExtractionRunModel || ExtractionRun;
    const extractWithVertex = dependencies.extractWithVertex || extractTorWithVertex;
    const saveSummaryBundle = dependencies.saveSummaryBundle || persistSummaryBundle;
    const normalizedId = String(projectId || '').trim();
    if (!normalizedId) throw new TypeError('projectId is required');

    const project = await ProjectModel.findOne({ project_id: normalizedId }).lean();
    if (!project) throw new Error(`Project ${normalizedId} was not found`);
    if (!project.primary_document_id || !project.latest_extraction_run_id) {
        throw new Error(`Project ${normalizedId} has no completed normalized OCR run`);
    }

    const [document, extractionRun] = await Promise.all([
        DocumentModel.findById(project.primary_document_id).lean(),
        ExtractionRunModel.findById(project.latest_extraction_run_id).lean(),
    ]);
    if (!document) throw new Error(`Primary document for ${normalizedId} was not found`);
    if (!extractionRun) throw new Error(`Extraction run for ${normalizedId} was not found`);
    if (String(extractionRun.document_id) !== String(document._id)) throw new Error('OCR run does not belong to the current document');

    const targetModel = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
    const existing = await SummaryModel.findOne({
        extraction_run_id: extractionRun._id,
        model: targetModel,
        prompt_version: TOR_PROMPT_VERSION,
    }).lean();
    if (existing) {
        const requiresReview = existing.needs_review || extractionRun.needs_review;
        const linked = await ProjectModel.updateOne({ _id: project._id,
            primary_document_id: document._id, latest_extraction_run_id: extractionRun._id,
        }, { $set: {
            latest_summary_id: existing._id,
            'processing.status': requiresReview ? 'review_required' : 'completed',
            'processing.error': null,
            'workflow.status': requiresReview ? 'review_required' : 'completed',
            'workflow.error': null,
            'workflow.updated_at': new Date(),
        } });
        if (linked?.matchedCount === 0) throw new Error('Current document changed while restoring the cached summary');
        return { projectId: normalizedId, status: requiresReview ? 'review_required' : 'completed',
            reused: true, documentSummaryId: String(existing._id), extraction: existing.extraction };
    }

    const storedPages = await PageModel.find({ extraction_run_id: extractionRun._id })
        .sort({ page_number: 1 })
        .lean();
    const pages = storedPages
        .filter(page => typeof page.text === 'string' && page.text.trim())
        .map(page => ({ page_number: page.page_number, text: page.text }));
    if (!pages.length) throw new Error(`Extraction run for ${normalizedId} has no readable stored pages`);

    const vertex = await extractWithVertex({ pages, extractionRunId: String(extractionRun._id) }, {
        onProgress: dependencies.onProgress,
    });
    const hasHighRiskFinding = (vertex.extraction.risk_findings || [])
        .some(finding => finding.severity === 'high');
    const needsReview = Boolean(extractionRun.needs_review)
        || hasHighRiskFinding
        || vertex.extraction.fiscal_budget?.status === 'ambiguous'
        || Boolean(vertex.extraction.fiscal_budget?.warnings?.length)
        || vertex.extraction.confidence < Number(process.env.VERTEX_REVIEW_THRESHOLD || 0.8);
    const status = needsReview ? 'review_required' : 'completed';
    const textResult = {
        textHash: extractionRun.text_sha256,
        pageCount: extractionRun.page_count,
        ocrPages: extractionRun.ocr_pages,
        needsReview: extractionRun.needs_review,
        pages,
    };
    const projectUpdate = { $set: {
        'processing.status': status,
        'processing.error': null,
        'workflow.status': status,
        'workflow.error': null,
        'workflow.updated_at': new Date(),
    }, $inc: { 'processing.ai_attempts': 1, 'processing.attempts': 1 } };
    const summary = await saveSummaryBundle(
        project,
        document,
        extractionRun,
        textResult,
        vertex,
        needsReview,
        projectUpdate
    );
    return { projectId: normalizedId, status, reused: false,
        documentSummaryId: String(summary._id), extraction: vertex.extraction };
}
