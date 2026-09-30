import { stat } from 'node:fs/promises';
import { extractPdfText, usableText } from './text-extraction.js';
import { classifyProjectMetadata } from './classifier.js';
import { loadKeywordSets } from './keywords.js';
import {
    hashFile,
    persistDocument,
    removeTransientDocuments,
} from './document-storage.js';
import {
    resolveKnownDocumentUrls,
    resolveWithBrowser,
    validateRemoteDocumentUrl,
} from './document-resolver.js';
import { downloadAttachment } from './scraper.js';
import { extractTorWithVertex } from './vertex/tor-extractor.js';
import { TOR_PROMPT_VERSION } from './vertex/response-schema.js';
import {
    normalizedDualWriteEnabled,
    persistOcrBundle,
    persistOcrPages,
    persistPdfRecords,
    persistSummaryBundle,
    persistVertexSummary,
} from './mongo-artifacts.js';
import Project from '../models/Project.js';
import Document from '../models/Document.js';
import DocumentSummary from '../models/DocumentSummary.js';

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

function sourceFileRetentionEnabled() {
    return String(process.env.TOR_RETAIN_SOURCE_FILES || 'false').toLowerCase() === 'true';
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
    hashSource = hashFile,
    cleanupSource = removeTransientDocuments,
    savePdfRecords = persistPdfRecords,
    saveOcrPages = persistOcrPages,
    saveVertexSummary = persistVertexSummary,
    saveOcrBundle = persistOcrBundle,
    saveSummaryBundle = persistSummaryBundle,
    DocumentModel = Document,
    SummaryModel = DocumentSummary,
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

    let normalizedDocument = null;
    if (project.primary_document_id) {
        normalizedDocument = await DocumentModel.findById(project.primary_document_id).lean();
    } else if (!project.document?.source_url && !project.pdf_url && !project.pdf_path) {
        normalizedDocument = await DocumentModel.findOne({
            project_id: project.project_id,
            is_current_primary: true,
        }).lean();
    }
    const projectWithDocument = normalizedDocument ? {
        ...project,
        document: {
            source_url: normalizedDocument.source_url,
            source_type: normalizedDocument.source_type,
        },
    } : project;
    const candidates = resolveKnownDocumentUrls(projectWithDocument);
    let acquisition;
    const savedPath = normalizedDocument?.storage?.local_path
        || project.document?.local_path
        || project.pdf_path;
    if (savedPath && await stat(savedPath).then(s => s.isFile() && s.size > 0).catch(() => false)) {
        acquisition = { sourceType: normalizedDocument?.source_type || project.document?.source_type || 'cached', result: {
            pdf_url: normalizedDocument?.source_url || project.pdf_url,
            pdf_path: savedPath,
            pdf_size: normalizedDocument?.storage?.size_bytes || project.pdf_size,
            pdf_content_type: normalizedDocument?.storage?.mime_type || project.pdf_content_type,
            archive_path: normalizedDocument?.archive?.local_path || project.document?.archive_path,
            archive_size: normalizedDocument?.archive?.size_bytes || project.document?.archive_size_bytes,
            archive_content_type: normalizedDocument?.archive?.mime_type || project.document?.archive_mime_type,
            extracted_pdfs: project.document?.extracted_files || [],
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
                'processing.status': retryable ? 'retry_pending' : 'metadata_only',
                'processing.error': error,
                'workflow.status': retryable ? 'retry_pending' : 'metadata_only',
                'workflow.error': error,
                'workflow.updated_at': new Date(),
            },
            $inc: { 'processing.attempts': 1 },
        });
        if (retryable) throw new Error(error);
        return { projectId: project.project_id, status: 'metadata_only', error };
    }

    const result = acquisition.result;
    const retainFiles = options.retainSourceFiles ?? sourceFileRetentionEnabled();
    const dualWrite = options.normalizedDualWrite ?? normalizedDualWriteEnabled();
    if (result.pdf_content_type !== 'application/pdf' && !result.pdf_path.toLowerCase().endsWith('.pdf')) {
        const error = `Text extraction requires a PDF; received ${result.pdf_content_type || 'another file type'}`;
        await Project.updateOne({ _id: project._id }, {
            $set: { 'processing.status': 'review_required', 'processing.error': error },
        });
        if (!retainFiles) await cleanupSource(result).catch(() => {});
        return { projectId: project.project_id, status: 'review_required', error };
    }
    await Project.updateOne({ _id: project._id }, { $set: {
        'processing.status': 'document_downloaded',
        'processing.error': null,
        'workflow.status': 'document_downloaded',
        'workflow.error': null,
        'workflow.updated_at': new Date(),
    } });

    let persisted;
    let primaryDocument;
    try {
        persisted = retainFiles
            ? await persist({
                projectId: project.project_id,
                fiscalYear: inferFiscalYear(project.project_id),
                localPath: result.pdf_path,
                mimeType: result.pdf_content_type,
            })
            : { ...await hashSource(result.pdf_path), backend: 'remote', gcsUri: null };
        primaryDocument = await savePdfRecords(
            project,
            result,
            persisted,
            acquisition.sourceType
        );
    } catch (error) {
        if (!retainFiles) await cleanupSource(result).catch(() => {});
        await Project.updateOne({ _id: project._id }, {
            $set: {
                'processing.status': 'retry_pending',
                'processing.error': error.message,
                'workflow.status': 'retry_pending',
                'workflow.error': error.message,
                'workflow.updated_at': new Date(),
            },
            $inc: { 'processing.attempts': 1 },
        });
        throw error;
    }

    const storageSet = compactSet({
        ...(dualWrite ? { primary_document_id: primaryDocument._id } : {}),
        'processing.status': 'text_extraction_pending',
        'workflow.status': 'text_extraction_pending',
        'workflow.updated_at': new Date(),
    });
    const storageUpdate = { $set: storageSet };
    await Project.updateOne({ _id: project._id }, storageUpdate);

    let textResult;
    let extractionRun = null;
    try {
        await Project.updateOne({ _id: project._id }, {
            $set: {
                'processing.status': 'text_extraction_pending',
                'workflow.status': 'text_extraction_pending',
                'workflow.error': null,
                'workflow.updated_at': new Date(),
            },
        });
        textResult = await extractText(result.pdf_path, {
            forceOcr: process.env.OCR_FORCE === 'true',
            onProgress: async () => {},
        });
        const textArtifact = retainFiles ? await persist({
            projectId: project.project_id, fiscalYear: inferFiscalYear(project.project_id),
            localPath: textResult.artifactPath, mimeType: 'application/json',
        }) : null;
        const textArtifactUri = textArtifact
            ? textArtifact.gcsUri || textResult.artifactPath
            : null;
        const textUpdate = { $set: {
            'processing.status': 'text_extracted',
            'workflow.status': 'text_extracted',
            'workflow.error': null,
            'workflow.updated_at': new Date(),
        } };
        if (dualWrite) {
            extractionRun = await saveOcrBundle(
                project,
                primaryDocument,
                textResult,
                textArtifactUri,
                textUpdate
            );
        } else {
            await saveOcrPages(primaryDocument, textResult, textArtifactUri);
            await Project.updateOne({ _id: project._id }, textUpdate);
        }
        if (!retainFiles) await cleanupSource(result, textResult);
        if (!manualClassification && classification.status === 'uncertain') {
            const textClassification = classifyProjectMetadata({
                ...project, extracted_data: { summary: textResult.pages.map(p => p.text).join('\n') },
            }, await loadKeywordSets());
            await Project.updateOne({ _id: project._id }, { $set: {
                is_software: textClassification.isSoftware,
                classification: { status: textClassification.status,
                    confidence: textClassification.confidence, method: 'ocr_keyword_classifier',
                    reason: textClassification.reason, classified_at: new Date() },
            } });
        }
    } catch (error) {
        if (!retainFiles) await cleanupSource(result, textResult).catch(() => {});
        await Project.updateOne({ _id: project._id }, { $set: {
            'processing.status': 'retry_pending', 'processing.error': error.message,
            'workflow.status': 'retry_pending', 'workflow.error': error.message,
            'workflow.updated_at': new Date(),
        } });
        throw error;
    }

    const targetModel = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
    const existingSummary = extractionRun
        ? await SummaryModel.findOne({
            extraction_run_id: extractionRun._id,
            model: targetModel,
            prompt_version: TOR_PROMPT_VERSION,
        }).lean()
        : null;
    if (existingSummary) {
        const reusedStatus = textResult.needsReview || existingSummary.needs_review
            ? 'review_required' : 'completed';
        await Project.updateOne({ _id: project._id }, { $set: {
            latest_summary_id: existingSummary._id,
            'processing.status': reusedStatus,
            'processing.error': null,
            'workflow.status': reusedStatus,
            'workflow.error': null,
            'workflow.updated_at': new Date(),
        } });
        return {
            projectId: project.project_id,
            status: reusedStatus,
            reused: true,
            documentSummaryId: String(existingSummary._id),
        };
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
            document: { sha256: persisted.sha256, sourceUrl: result.pdf_url },
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
        const summaryProjectUpdate = {
            $set: {
                'anomalies.high_budget_flag': anomaly.high_budget_flag,
                'anomalies.budget_deviation_multiplier': anomaly.budget_deviation_multiplier,
                'processing.status': status,
                'processing.error': null,
                'workflow.status': status,
                'workflow.error': null,
                'workflow.updated_at': new Date(),
            },
            $inc: { 'processing.attempts': 1 },
        };
        const documentSummary = dualWrite
            ? await saveSummaryBundle(
                project,
                primaryDocument,
                extractionRun,
                textResult,
                vertex,
                status === 'review_required',
                summaryProjectUpdate
            )
            : await saveVertexSummary(
                primaryDocument,
                textResult,
                vertex,
                status === 'review_required'
            );
        if (!dualWrite) {
            summaryProjectUpdate.$set['processing.summary_record_id'] = documentSummary._id;
            await Project.updateOne({ _id: project._id }, summaryProjectUpdate);
        }

        return {
            projectId: project.project_id,
            status,
            extraction,
            documentId: String(primaryDocument._id),
            documentSummaryId: String(documentSummary._id),
        };
    } catch (error) {
        await Project.updateOne({ _id: project._id }, {
            $set: { 'processing.status': 'retry_pending', 'processing.error': error.message },
            $inc: { 'processing.attempts': 1 },
        });
        throw error;
    }
}
