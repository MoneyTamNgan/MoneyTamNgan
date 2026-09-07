import path from 'node:path';
import { stat } from 'node:fs/promises';
import { extractPdfText, usableText } from './text-extraction.js';
import { classifyProjectMetadata } from './classifier.js';
import { loadKeywordSets } from './keywords.js';
import { persistDocument } from './document-storage.js';
import {
    resolveKnownDocumentUrls,
    resolveWithBrowser,
    validateRemoteDocumentUrl,
} from './document-resolver.js';
import { downloadAttachment } from './scraper.js';
import { extractTorWithVertex } from './vertex/tor-extractor.js';
import { TOR_PROMPT_VERSION } from './vertex/response-schema.js';
import Project from '../models/Project.js';

function inferFiscalYear(projectId) {
    const match = String(projectId).match(/^[A-Za-z]?(\d{2})/);
    return match ? String(2500 + Number(match[1])) : 'unknown';
}

function processingEnabled() {
    return String(process.env.VERTEX_AI_ENABLED || '').toLowerCase() === 'true';
}

function documentType(url) {
    const match = String(url).match(/\.(pdf|zip|rar|doc|docx|xlsx)(?:$|[?#])/i);
    return match?.[1]?.toLowerCase() || 'unknown';
}

function metadataSummary(project) {
    const budget = Number.isFinite(project.budget)
        ? ` วงเงิน ${new Intl.NumberFormat('th-TH').format(project.budget)} บาท`
        : '';
    const status = project.project_status ? ` สถานะ ${project.project_status}` : '';
    return `ข้อมูลเบื้องต้นจาก e-GP: ${project.project_name} โดย ${project.dept_name}${budget}${status}. `
        + 'ยังไม่พบเอกสาร TOR จึงยังไม่มีรายละเอียดขอบเขตงานหรือคุณสมบัติจากเอกสาร';
}

function documentUpdate(result, sourceType) {
    return {
        pdf_url: result.pdf_url,
        pdf_path: result.pdf_path,
        pdf_size: result.pdf_size,
        pdf_content_type: result.pdf_content_type,
        pdf_downloaded_at: new Date(),
        'document.source_url': result.pdf_url,
        'document.source_type': sourceType,
        'document.aggregator_url': result.aggregator_url,
        'document.official_detail_url': result.official_detail_url,
        'document.local_path': result.pdf_path,
        'document.filename': result.pdf_path ? path.basename(result.pdf_path) : undefined,
        'document.mime_type': result.pdf_content_type,
        'document.size_bytes': result.pdf_size,
        'document.archive_path': result.archive_path,
        'document.archive_filename': result.archive_path
            ? path.basename(result.archive_path)
            : undefined,
        'document.archive_mime_type': result.archive_content_type,
        'document.archive_size_bytes': result.archive_size,
        'document.extracted_files': result.extracted_pdfs,
        'document.status': 'downloaded',
        'document.downloaded_at': new Date(),
        'document.error': null,
        'processing.status': 'document_downloaded',
        'processing.error': null,
    };
}

function compactSet(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function downloadKnownCandidates(project, candidates, storageDir) {
    const errors = [];
    for (const candidate of candidates) {
        try {
            const url = validateRemoteDocumentUrl(candidate.url);
            const downloaded = await downloadAttachment({
                name: `TOR ${project.project_id}`,
                url,
                type: documentType(url),
            }, {
                projectId: project.project_id,
                storageDir,
            });
            return {
                result: {
                    projectId: project.project_id,
                    pdf_url: url,
                    pdf_path: downloaded.path,
                    pdf_size: downloaded.size,
                    pdf_content_type: downloaded.contentType,
                    archive_path: downloaded.archivePath || null,
                    archive_size: downloaded.archiveSize || null,
                    archive_content_type: downloaded.archiveContentType || null,
                    extracted_pdfs: downloaded.extractedPdfs || [],
                    attachments: [{ name: `TOR ${project.project_id}`, url, type: documentType(url) }],
                    error: null,
                },
                sourceType: candidate.source,
            };
        } catch (error) {
            errors.push(`${candidate.url}: ${error.message}`);
        }
    }
    return { result: null, errors };
}

async function calculateBudgetAnomaly(project) {
    if (!Number.isFinite(project.budget) || project.budget <= 0) {
        return { high_budget_flag: false, budget_deviation_multiplier: 1 };
    }

    const peers = await Project.find({
        project_id: { $ne: project.project_id },
        is_software: true,
        budget: { $gt: 0 },
    }).select('budget').limit(500).lean();
    if (peers.length < 5) {
        return { high_budget_flag: false, budget_deviation_multiplier: 1 };
    }

    const budgets = peers.map(item => item.budget).sort((a, b) => a - b);
    const midpoint = Math.floor(budgets.length / 2);
    const median = budgets.length % 2
        ? budgets[midpoint]
        : (budgets[midpoint - 1] + budgets[midpoint]) / 2;
    const multiplier = median > 0 ? project.budget / median : 1;
    return {
        high_budget_flag: multiplier >= 3,
        budget_deviation_multiplier: Number(multiplier.toFixed(2)),
    };
}

/** Execute one idempotent project-processing job. */
export async function processProject(projectId, options = {}, {
    extractText = extractPdfText, persist = persistDocument, extractWithVertex = extractTorWithVertex,
} = {}) {
    const project = await Project.findOne({ project_id: String(projectId) }).lean();
    if (!project) throw new Error(`Project ${projectId} was not found`);

    const manualClassification = project.classification?.status === 'manual_override';
    const classification = manualClassification
        ? {
            status: 'manual_override',
            isSoftware: project.is_software,
            confidence: project.classification?.confidence ?? 1,
            method: project.classification?.method || 'manual',
            reason: project.classification?.reason || 'Manual override',
        }
        : classifyProjectMetadata(project, await loadKeywordSets());

    await Project.updateOne({ _id: project._id }, {
        $set: {
            is_software: classification.isSoftware,
            classification_confidence: classification.confidence,
            classification: {
                status: classification.status,
                confidence: classification.confidence,
                method: classification.method,
                classified_at: new Date(),
                reason: classification.reason,
            },
            'processing.status': classification.isSoftware === false
                ? 'irrelevant'
                : 'document_pending',
            'processing.error': null,
        },
    });

    if (classification.isSoftware === false) {
        return { projectId: project.project_id, status: 'irrelevant', classification };
    }

    const candidates = resolveKnownDocumentUrls(project);
    let acquisition;
    const savedPath = project.document?.local_path || project.pdf_path;
    if (savedPath && await stat(savedPath).then(s => s.isFile() && s.size > 0).catch(() => false)) {
        acquisition = { sourceType: project.document?.source_type || 'cached', result: {
            pdf_url: project.pdf_url, pdf_path: savedPath,
            pdf_size: project.pdf_size, pdf_content_type: project.pdf_content_type,
            archive_path: project.document?.archive_path,
            archive_size: project.document?.archive_size_bytes,
            archive_content_type: project.document?.archive_mime_type,
            extracted_pdfs: project.document?.extracted_files,
        } };
    } else {
        await Project.updateOne({ _id: project._id }, { $inc: { 'processing.download_attempts': 1 } });
        acquisition = await downloadKnownCandidates(project, candidates, options.storageDir);
    }

    const allowBrowserFallback = options.allowBrowserFallback
        ?? String(process.env.ENABLE_BROWSER_FALLBACK || 'true').toLowerCase() === 'true';
    if (!acquisition.result && allowBrowserFallback) {
        const browserResult = await resolveWithBrowser(project.project_id, {
            storageDir: options.storageDir,
        });
        if (browserResult.pdf_path) {
            acquisition = {
                result: browserResult,
                sourceType: browserResult.resolver_source || 'egp_browser',
            };
        } else {
            acquisition.errors = [
                ...(acquisition.errors || []),
                browserResult.error || 'Browser fallback found no document',
            ];
            acquisition.retryable = Boolean(browserResult.error);
        }
    }

    if (!acquisition.result) {
        const error = acquisition.errors?.join('; ') || 'No TOR document URL was available';
        const retryable = acquisition.retryable || candidates.length > 0;
        await Project.updateOne({ _id: project._id }, {
            $set: {
                'document.status': retryable ? 'retry_pending' : 'unavailable',
                'document.error': error,
                'processing.status': retryable ? 'retry_pending' : 'metadata_only',
                ...(retryable ? {} : {
                    'processing.summary_source': 'metadata',
                    'extracted_data.summary': metadataSummary(project),
                }),
                'processing.error': error,
            },
            $inc: { 'processing.attempts': 1 },
        });
        if (retryable) throw new Error(error);
        return { projectId: project.project_id, status: 'metadata_only', error };
    }

    const result = acquisition.result;
    if (result.pdf_content_type !== 'application/pdf' && !result.pdf_path.toLowerCase().endsWith('.pdf')) {
        const error = `Text extraction requires a PDF; received ${result.pdf_content_type || 'another file type'}`;
        await Project.updateOne({ _id: project._id }, {
            $set: { 'processing.status': 'review_required', 'processing.error': error },
        });
        return { projectId: project.project_id, status: 'review_required', error };
    }
    await Project.updateOne({ _id: project._id }, {
        $set: compactSet(documentUpdate(result, acquisition.sourceType)),
    });

    let persisted;
    try {
        persisted = await persist({
            projectId: project.project_id,
            fiscalYear: inferFiscalYear(project.project_id),
            localPath: result.pdf_path,
            mimeType: result.pdf_content_type,
        });
    } catch (error) {
        await Project.updateOne({ _id: project._id }, {
            $set: {
                'document.status': 'retry_pending',
                'document.error': error.message,
                'processing.status': 'retry_pending',
                'processing.error': error.message,
            },
            $inc: { 'processing.attempts': 1 },
        });
        throw error;
    }

    const documentChanged = Boolean(
        project.document?.sha256 && project.document.sha256 !== persisted.sha256
    );
    const storageSet = compactSet({
        'document.sha256': persisted.sha256,
        'document.size_bytes': persisted.size,
        'document.gcs_uri': persisted.gcsUri,
        'document.status': 'stored',
        'processing.status': 'text_extraction_pending',
        ...(documentChanged ? {
            'version_info.previous_document_hash': project.document.sha256,
            'version_info.detected_at': new Date(),
        } : {}),
    });
    const storageUpdate = { $set: storageSet };
    if (documentChanged) storageUpdate.$inc = { 'version_info.version': 1 };
    await Project.updateOne({ _id: project._id }, storageUpdate);

    let textResult;
    try {
        await Project.updateOne({ _id: project._id }, {
            $set: { 'ocr.status': 'running', 'ocr.error': null, 'ocr.pages_processed': 0 },
            $inc: { 'ocr.attempts': 1 },
        });
        textResult = await extractText(result.pdf_path, {
            forceOcr: process.env.OCR_FORCE === 'true',
            onProgress: async progress => Project.updateOne({ _id: project._id }, { $set: {
                'ocr.pages_processed': progress.pagesProcessed,
                'ocr.ocr_pages': progress.ocrPages,
                'document.page_count': progress.pageCount,
            } }),
        });
        const textArtifact = await persist({
            projectId: project.project_id, fiscalYear: inferFiscalYear(project.project_id),
            localPath: textResult.artifactPath, mimeType: 'application/json',
        });
        await Project.updateOne({ _id: project._id }, { $set: {
            'document.text_uri': textArtifact.gcsUri || textResult.artifactPath,
            'document.text_sha256': textResult.textHash,
            'document.page_count': textResult.pageCount,
            'ocr.status': 'completed', 'ocr.provider': 'poppler+tesseract',
            'ocr.processor_version': textResult.fingerprint,
            'ocr.completed_at': new Date(), 'ocr.error': null,
            'ocr.needs_review': textResult.needsReview,
            'processing.status': 'text_extracted',
        } });
        if (!manualClassification && classification.status === 'uncertain') {
            const textClassification = classifyProjectMetadata({
                ...project, extracted_data: { summary: textResult.pages.map(p => p.text).join('\n') },
            }, await loadKeywordSets());
            await Project.updateOne({ _id: project._id }, { $set: {
                is_software: textClassification.isSoftware,
                classification_confidence: textClassification.confidence,
                classification: { status: textClassification.status,
                    confidence: textClassification.confidence, method: 'ocr_keyword_classifier',
                    reason: textClassification.reason, classified_at: new Date() },
            } });
        }
    } catch (error) {
        await Project.updateOne({ _id: project._id }, { $set: {
            'ocr.status': 'retry_pending', 'ocr.error': error.message,
            'processing.status': 'retry_pending', 'processing.error': error.message,
        } });
        throw error;
    }

    const alreadyProcessed = ['completed', 'review_required'].includes(project.processing?.status)
        && project.processing?.document_sha256 === persisted.sha256
        && project.processing?.text_sha256 === textResult.textHash
        && project.processing?.model === (process.env.VERTEX_MODEL || 'gemini-2.5-flash')
        && project.processing?.prompt_version === TOR_PROMPT_VERSION;
    if (alreadyProcessed) {
        await Project.updateOne({ _id: project._id }, { $set: { 'processing.status': project.processing.status } });
        return { projectId: project.project_id, status: project.processing.status, reused: true };
    }

    if (!textResult.pages.some(page => usableText(page.text))) {
        const error = 'No usable text was extracted; manual document review is required';
        await Project.updateOne({ _id: project._id }, { $set: {
            'processing.status': 'review_required', 'processing.error': error,
        } });
        return { projectId: project.project_id, status: 'review_required', error };
    }

    if (!processingEnabled()) {
        await Project.updateOne({ _id: project._id }, { $set: { 'processing.status': 'ai_pending' } });
        return {
            projectId: project.project_id,
            status: 'ai_pending',
            document: { sha256: persisted.sha256, gcsUri: persisted.gcsUri, path: result.pdf_path },
        };
    }

    try {
        await Project.updateOne({ _id: project._id }, {
            $set: { 'processing.status': 'ai_pending' }, $inc: { 'processing.ai_attempts': 1 },
        });
        const vertex = await extractWithVertex({
            pages: textResult.pages,
        });
        const extraction = vertex.extraction;
        const anomaly = await calculateBudgetAnomaly(project);
        const status = !textResult.needsReview && extraction.confidence >= Number(process.env.VERTEX_REVIEW_THRESHOLD || 0.8)
            ? 'completed'
            : 'review_required';

        await Project.updateOne({ _id: project._id }, {
            $set: {
                'extracted_data.summary': extraction.summary,
                'extracted_data.qualifications': extraction.qualifications.map(item => item.value),
                'extracted_data.scope_of_work': extraction.scope_of_work.map(item => item.value),
                'extracted_data.tech_stack': extraction.tech_stack.map(item => item.value),
                'extracted_data.evidence.qualifications': extraction.qualifications,
                'extracted_data.evidence.scope_of_work': extraction.scope_of_work,
                'extracted_data.evidence.tech_stack': extraction.tech_stack,
                'anomalies.high_budget_flag': anomaly.high_budget_flag,
                'anomalies.budget_deviation_multiplier': anomaly.budget_deviation_multiplier,
                'anomalies.flagged_clauses': extraction.flagged_clauses,
                'processing.status': status,
                'processing.summary_source': 'pdf',
                'processing.model': vertex.model,
                'processing.model_version': vertex.modelVersion,
                'processing.prompt_version': vertex.promptVersion,
                'processing.document_sha256': persisted.sha256,
                'processing.text_sha256': textResult.textHash,
                'processing.confidence': extraction.confidence,
                'processing.input_tokens': vertex.usage.inputTokens,
                'processing.output_tokens': vertex.usage.outputTokens,
                'processing.processed_at': new Date(),
                'processing.error': null,
            },
            $inc: { 'processing.attempts': 1 },
        });

        return { projectId: project.project_id, status, extraction };
    } catch (error) {
        await Project.updateOne({ _id: project._id }, {
            $set: { 'processing.status': 'retry_pending', 'processing.error': error.message },
            $inc: { 'processing.attempts': 1 },
        });
        throw error;
    }
}
