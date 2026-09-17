import Document from '../models/Document.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';

export function normalizedReadsEnabled() {
    return true;
}

function id(value) {
    return value ? String(value) : null;
}

function stripInternalPointers(project) {
    const output = { ...project };
    delete output.primary_document_id;
    delete output.latest_extraction_run_id;
    delete output.latest_summary_id;
    delete output.workflow;
    return output;
}

function mergeNormalized(project, document, extractionRun, summary) {
    const output = stripInternalPointers(project);
    output.classification_confidence = output.classification?.confidence ?? null;
    if (project.workflow?.status) {
        output.processing = {
            ...(output.processing || {}),
            status: project.workflow.status,
            error: project.workflow.error,
        };
    }
    if (document) {
        output.pdf_url = document.source_url || output.pdf_url;
        output.pdf_size = document.storage?.size_bytes ?? output.pdf_size;
        output.pdf_content_type = document.storage?.mime_type || output.pdf_content_type;
        if (document.storage?.local_path) output.pdf_path = document.storage.local_path;
        output.document = {
            ...(output.document || {}),
            record_id: document._id,
            source_url: document.source_url,
            source_type: document.source_type,
            official_detail_url: document.official_detail_url,
            filename: document.filename,
            mime_type: document.storage?.mime_type,
            size_bytes: document.storage?.size_bytes,
            local_path: document.storage?.local_path,
            gcs_uri: document.storage?.gcs_uri,
            archive_filename: document.archive?.filename,
            archive_mime_type: document.archive?.mime_type,
            archive_size_bytes: document.archive?.size_bytes,
            sha256: document.sha256,
            status: document.storage?.backend === 'remote' ? 'linked' : 'stored',
        };
    }
    if (extractionRun) {
        output.document = {
            ...(output.document || {}),
            text_storage: extractionRun.text_storage,
            text_uri: extractionRun.text_artifact_uri,
            text_sha256: extractionRun.text_sha256,
            page_count: extractionRun.page_count,
        };
        output.ocr = {
            ...(output.ocr || {}),
            status: extractionRun.status === 'failed' ? 'retry_pending' : 'completed',
            provider: extractionRun.provider,
            processor_version: extractionRun.processor_fingerprint,
            pages_processed: extractionRun.page_count,
            ocr_pages: extractionRun.ocr_pages,
            needs_review: extractionRun.needs_review,
            review_pages: extractionRun.review_pages,
            completed_at: extractionRun.completed_at,
            error: extractionRun.error,
        };
    }
    if (summary) {
        const extraction = summary.extraction || {};
        output.extracted_data = {
            summary: extraction.summary,
            qualifications: (extraction.qualifications || []).map(item => item.value),
            scope_of_work: (extraction.scope_of_work || []).map(item => item.value),
            tech_stack: (extraction.tech_stack || []).map(item => item.value),
            evidence: {
                qualifications: extraction.qualifications || [],
                scope_of_work: extraction.scope_of_work || [],
                tech_stack: extraction.tech_stack || [],
            },
        };
        output.anomalies = {
            ...(output.anomalies || {}),
            flagged_clauses: extraction.flagged_clauses || [],
        };
        output.processing = {
            ...(output.processing || {}),
            summary_source: 'pdf',
            model: summary.model,
            model_version: summary.model_version,
            prompt_version: summary.prompt_version,
            document_sha256: summary.document_sha256,
            text_sha256: summary.text_sha256,
            confidence: summary.confidence,
            input_tokens: summary.usage?.input_tokens,
            output_tokens: summary.usage?.output_tokens,
            summary_record_id: summary._id,
            processed_at: summary.processed_at,
        };
    }
    return output;
}

/** Build the legacy API view from normalized records, with legacy fallback. */
export async function hydrateProjectsCompatibility(projects, models = {}, options = {}) {
    const items = Array.isArray(projects) ? projects : [projects];
    if (!items.length) return [];
    const enabled = options.enabled ?? normalizedReadsEnabled();
    if (!enabled) return items.map(stripInternalPointers);

    const DocumentModel = models.DocumentModel || Document;
    const ExtractionRunModel = models.ExtractionRunModel || ExtractionRun;
    const SummaryModel = models.SummaryModel || DocumentSummary;
    const documentIds = items.map(item => item.primary_document_id).filter(Boolean);
    const extractionIds = items.map(item => item.latest_extraction_run_id).filter(Boolean);
    const summaryIds = items.map(item => item.latest_summary_id).filter(Boolean);
    const [documents, extractions, summaries] = await Promise.all([
        documentIds.length ? DocumentModel.find({ _id: { $in: documentIds } }).lean() : [],
        extractionIds.length ? ExtractionRunModel.find({ _id: { $in: extractionIds } }).lean() : [],
        summaryIds.length ? SummaryModel.find({ _id: { $in: summaryIds } }).lean() : [],
    ]);
    const documentMap = new Map(documents.map(item => [id(item._id), item]));
    const extractionMap = new Map(extractions.map(item => [id(item._id), item]));
    const summaryMap = new Map(summaries.map(item => [id(item._id), item]));
    return items.map(project => mergeNormalized(
        project,
        documentMap.get(id(project.primary_document_id)),
        extractionMap.get(id(project.latest_extraction_run_id)),
        summaryMap.get(id(project.latest_summary_id))
    ));
}

export async function hydrateProjectCompatibility(project, models = {}, options = {}) {
    if (!project) return project;
    return (await hydrateProjectsCompatibility([project], models, options))[0];
}
