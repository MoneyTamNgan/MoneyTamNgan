import { createHash } from 'node:crypto';
import path from 'node:path';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';
import Project from '../models/Project.js';
import { hashFile } from './document-storage.js';

const hashText = value => createHash('sha256').update(String(value)).digest('hex');
const sessionOptions = session => session ? { session } : {};

export function normalizedDualWriteEnabled() {
    return String(process.env.NORMALIZED_SCHEMA_DUAL_WRITE || 'false').toLowerCase() === 'true';
}

export function extractionRunKey(document, textResult) {
    return hashText([document._id, document.sha256, textResult.fingerprint, textResult.textHash].join(':'));
}

export async function withMongoTransaction(work, options = {}) {
    if (options.transactionRunner) return options.transactionRunner(work);
    const connection = options.connection || mongoose.connection;
    return connection.transaction(session => work(session));
}

export function inferDocumentType(filename = '') {
    const name = filename.toLowerCase();
    if (/ร่างเอกสารประกวดราคา|e-?bidding|เอกสารประกวดราคา/.test(name)) return 'ebidding_terms';
    if (/ขอบเขตของงาน|terms? of reference|(?:^|[^a-z])tor(?:[^a-z]|$)/.test(name)) return 'tor';
    if (/รายละเอียดคุณลักษณะ|specification|คุณลักษณะเฉพาะ/.test(name)) return 'technical_specification';
    if (/ราคากลาง|ราคา/.test(name)) return 'pricing';
    if (/สัญญา|contract/.test(name)) return 'contract';
    if (/ประกาศ|announcement/.test(name)) return 'announcement';
    if (/ภาคผนวก|appendix/.test(name)) return 'appendix';
    return 'unknown';
}

function extractedPdfCandidates(result) {
    const primaryPath = path.resolve(result.pdf_path);
    const candidates = (result.extracted_pdfs || []).map(file => ({
        localPath: file.path,
        filename: file.filename || path.basename(file.path),
        entryName: file.entryName,
        size: file.size,
        isPrimary: path.resolve(file.path) === primaryPath,
    }));
    if (!candidates.some(file => file.isPrimary)) {
        candidates.unshift({
            localPath: result.pdf_path,
            filename: path.basename(result.pdf_path),
            size: result.pdf_size,
            isPrimary: true,
        });
    }
    return candidates;
}

/** Register every extracted PDF and return the current primary document. */
export async function persistPdfRecords(project, result, persistedPrimary, sourceType, models = {}, options = {}) {
    const DocumentModel = models.DocumentModel || Document;
    const retainFiles = persistedPrimary.backend !== 'remote';
    const session = options.session;
    let currentPrimary = null;
    let nextVersion = 1;
    if (DocumentModel.findOne) {
        currentPrimary = await DocumentModel.findOne({
            project_id: project.project_id,
            is_current_primary: true,
        }, null, sessionOptions(session)).lean();
        nextVersion = currentPrimary ? (currentPrimary.version || 1) + 1 : 1;
    }

    let primary = null;
    for (const candidate of extractedPdfCandidates(result)) {
        const hashed = candidate.isPrimary ? persistedPrimary : await hashFile(candidate.localPath);
        const isSameCurrent = candidate.isPrimary && currentPrimary?.sha256 === hashed.sha256;
        if (candidate.isPrimary && !isSameCurrent && DocumentModel.updateMany) {
            await DocumentModel.updateMany({
                project_id: project.project_id,
                is_current_primary: true,
            }, { $set: { is_current_primary: false } }, sessionOptions(session));
        }
        const record = await DocumentModel.findOneAndUpdate({
            project_id: project.project_id,
            sha256: hashed.sha256,
        }, { $set: {
            project_ref: project._id,
            filename: candidate.filename,
            entry_name: candidate.entryName || candidate.filename,
            document_type: inferDocumentType(candidate.entryName || candidate.filename),
            is_primary: candidate.isPrimary,
            is_current_primary: candidate.isPrimary,
            version: candidate.isPrimary ? (isSameCurrent ? currentPrimary.version || 1 : nextVersion) : 1,
            previous_document_id: candidate.isPrimary && !isSameCurrent ? currentPrimary?._id : undefined,
            discovered_at: new Date(),
            source_url: result.pdf_url,
            source_type: sourceType,
            official_detail_url: result.official_detail_url,
            storage: {
                backend: retainFiles ? (candidate.isPrimary ? persistedPrimary.backend || 'local' : 'local') : 'remote',
                local_path: retainFiles ? candidate.localPath : undefined,
                gcs_uri: retainFiles && candidate.isPrimary ? persistedPrimary.gcsUri : undefined,
                mime_type: 'application/pdf',
                size_bytes: hashed.size ?? candidate.size,
            },
            archive: {
                filename: result.archive_path ? path.basename(result.archive_path) : undefined,
                local_path: retainFiles ? result.archive_path : undefined,
                mime_type: result.archive_content_type,
                size_bytes: result.archive_size,
            },
            processing_status: candidate.isPrimary ? 'stored' : 'downloaded',
        } }, {
            upsert: true,
            returnDocument: 'after',
            setDefaultsOnInsert: true,
            ...sessionOptions(session),
        });
        if (candidate.isPrimary) primary = record;
    }
    if (!primary) throw new Error('Primary PDF record was not persisted');
    return primary;
}

/** Save page text using either the legacy document identity or an extraction run. */
export async function persistOcrPages(document, textResult, textArtifactUri, models = {}, options = {}) {
    const DocumentModel = models.DocumentModel || Document;
    const PageModel = models.PageModel || DocumentPage;
    const extractionRun = options.extractionRun;
    const session = options.session;
    const operations = textResult.pages.map(page => ({
        updateOne: {
            filter: extractionRun
                ? { extraction_run_id: extractionRun._id, page_number: page.page_number }
                : { document_id: document._id, page_number: page.page_number },
            update: { $set: {
                project_id: document.project_id,
                document_id: document._id,
                ...(extractionRun ? { extraction_run_id: extractionRun._id } : {}),
                text: page.text || '',
                text_sha256: hashText(page.text || ''),
                extraction_method: page.extraction_method,
                confidence: page.confidence ?? null,
                render_dpi: page.render_dpi,
                ocr_psm: page.psm,
                warnings: page.warnings || [],
                needs_review: Boolean(page.needs_review),
                processor_fingerprint: textResult.fingerprint,
            } },
            upsert: true,
        },
    }));
    if (operations.length) await PageModel.bulkWrite(operations, { ordered: false, ...sessionOptions(session) });
    await PageModel.deleteMany({
        ...(extractionRun ? { extraction_run_id: extractionRun._id } : { document_id: document._id }),
        page_number: { $gt: textResult.pageCount },
    }, sessionOptions(session));
    await DocumentModel.updateOne({ _id: document._id }, { $set: {
        text: {
            storage: textArtifactUri?.startsWith('gs://') ? 'gcs' : textArtifactUri ? 'local' : 'mongodb',
            artifact_uri: textArtifactUri,
            sha256: textResult.textHash,
            page_count: textResult.pageCount,
            processor_fingerprint: textResult.fingerprint,
        },
        ocr: {
            status: 'completed',
            provider: 'poppler+tesseract',
            pages_processed: textResult.pageCount,
            ocr_pages: textResult.ocrPages || 0,
            needs_review: Boolean(textResult.needsReview),
            completed_at: new Date(),
            error: null,
        },
        processing_status: textResult.needsReview ? 'review_required' : 'text_ready',
    } }, sessionOptions(session));
}

export async function persistVertexSummary(document, textResult, vertex, needsReview, models = {}, options = {}) {
    const DocumentModel = models.DocumentModel || Document;
    const SummaryModel = models.SummaryModel || DocumentSummary;
    const extractionRun = options.extractionRun;
    const session = options.session;
    const identity = extractionRun ? {
        extraction_run_id: extractionRun._id,
        model: vertex.model,
        model_version: vertex.modelVersion || 'unspecified',
        prompt_version: vertex.promptVersion,
    } : {
        document_id: document._id,
        text_sha256: textResult.textHash,
        model: vertex.model,
        prompt_version: vertex.promptVersion,
    };
    const summary = await SummaryModel.findOneAndUpdate(identity, { $set: {
        project_id: document.project_id,
        document_id: document._id,
        ...(extractionRun ? { extraction_run_id: extractionRun._id } : {}),
        document_sha256: document.sha256,
        text_sha256: textResult.textHash,
        model: vertex.model,
        model_version: vertex.modelVersion,
        prompt_version: vertex.promptVersion,
        extraction: vertex.extraction,
        usage: { input_tokens: vertex.usage.inputTokens, output_tokens: vertex.usage.outputTokens },
        confidence: vertex.extraction.confidence,
        needs_review: Boolean(needsReview),
        processed_at: new Date(),
    } }, {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
        ...sessionOptions(session),
    });
    await DocumentModel.updateOne({ _id: document._id }, { $set: {
        processing_status: needsReview ? 'review_required' : 'summarized',
    } }, sessionOptions(session));
    return summary;
}

/** Persist an extraction run, its pages, and the legacy project view atomically. */
export async function persistOcrBundle(project, document, textResult, textArtifactUri, legacyProjectUpdate, models = {}, options = {}) {
    const ExtractionRunModel = models.ExtractionRunModel || ExtractionRun;
    const PageModel = models.PageModel || DocumentPage;
    const ProjectModel = models.ProjectModel || Project;
    return withMongoTransaction(async session => {
        const extractionRun = await ExtractionRunModel.findOneAndUpdate({
            run_key: extractionRunKey(document, textResult),
        }, { $setOnInsert: {
            project_id: project.project_id,
            project_ref: project._id,
            document_id: document._id,
            processor_fingerprint: textResult.fingerprint,
            provider: 'poppler+tesseract',
            configuration: textResult.configuration || {},
            text_sha256: textResult.textHash,
            text_storage: textArtifactUri?.startsWith('gs://') ? 'gcs' : textArtifactUri ? 'local' : 'mongodb',
            text_artifact_uri: textArtifactUri,
            page_count: textResult.pageCount,
            ocr_pages: textResult.ocrPages || 0,
            needs_review: Boolean(textResult.needsReview),
            review_pages: textResult.reviewPages || [],
            status: textResult.needsReview ? 'review_required' : 'completed',
            completed_at: new Date(),
        } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, session });

        await PageModel.updateMany({
            document_id: document._id,
            extraction_run_id: { $exists: false },
        }, { $set: { extraction_run_id: extractionRun._id } }, { session });
        await persistOcrPages(document, textResult, textArtifactUri, models, { session, extractionRun });
        await ProjectModel.updateOne({ _id: project._id }, {
            ...legacyProjectUpdate,
            $set: {
                ...(legacyProjectUpdate.$set || {}),
                primary_document_id: document._id,
                latest_extraction_run_id: extractionRun._id,
                'workflow.status': legacyProjectUpdate.$set?.['processing.status'],
                'workflow.error': legacyProjectUpdate.$set?.['processing.error'] || null,
                'workflow.updated_at': new Date(),
            },
        }, { session });
        return extractionRun;
    }, options);
}

/** Persist a versioned Vertex result and compatibility fields atomically. */
export async function persistSummaryBundle(project, document, extractionRun, textResult, vertex, needsReview, legacyProjectUpdate, models = {}, options = {}) {
    const ProjectModel = models.ProjectModel || Project;
    return withMongoTransaction(async session => {
        const summary = await persistVertexSummary(document, textResult, vertex, needsReview, models, { session, extractionRun });
        await ProjectModel.updateOne({ _id: project._id }, {
            ...legacyProjectUpdate,
            $set: {
                ...(legacyProjectUpdate.$set || {}),
                primary_document_id: document._id,
                latest_extraction_run_id: extractionRun._id,
                latest_summary_id: summary._id,
                'processing.summary_record_id': summary._id,
                'workflow.status': legacyProjectUpdate.$set?.['processing.status'],
                'workflow.error': legacyProjectUpdate.$set?.['processing.error'] || null,
                'workflow.updated_at': new Date(),
            },
        }, { session });
        return summary;
    }, options);
}

/** Attach a compatible legacy summary to the current extraction run without calling Vertex again. */
export async function linkExistingSummaryBundle(
    project,
    document,
    extractionRun,
    textResult,
    processing,
    status,
    models = {},
    options = {}
) {
    const DocumentModel = models.DocumentModel || Document;
    const SummaryModel = models.SummaryModel || DocumentSummary;
    const ProjectModel = models.ProjectModel || Project;
    return withMongoTransaction(async session => {
        const modelVersion = processing.model_version || processing.model || 'unspecified';
        const normalizedIdentity = {
            extraction_run_id: extractionRun._id,
            model: processing.model,
            model_version: modelVersion,
            prompt_version: processing.prompt_version,
        };
        let summary = await SummaryModel.findOneAndUpdate(
            normalizedIdentity,
            { $set: normalizedIdentity },
            { returnDocument: 'after', ...sessionOptions(session) }
        );
        if (!summary) {
            summary = await SummaryModel.findOneAndUpdate({
                document_id: document._id,
                text_sha256: textResult.textHash,
                model: processing.model,
                prompt_version: processing.prompt_version,
            }, { $set: {
                extraction_run_id: extractionRun._id,
                model_version: modelVersion,
            } }, { returnDocument: 'after', ...sessionOptions(session) });
        }
        if (!summary) return null;

        await DocumentModel.updateOne({ _id: document._id }, { $set: {
            processing_status: status,
        } }, sessionOptions(session));
        await ProjectModel.updateOne({ _id: project._id }, { $set: {
            primary_document_id: document._id,
            latest_extraction_run_id: extractionRun._id,
            latest_summary_id: summary._id,
            'processing.summary_record_id': summary._id,
            'processing.status': status,
            'workflow.status': status,
            'workflow.error': null,
            'workflow.updated_at': new Date(),
        } }, sessionOptions(session));
        return summary;
    }, options);
}
