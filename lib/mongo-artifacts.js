import { createHash } from 'node:crypto';
import path from 'node:path';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import { hashFile } from './document-storage.js';

const hashText = value => createHash('sha256').update(String(value)).digest('hex');

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

/** Register every extracted PDF and return the primary document record. */
export async function persistPdfRecords(project, result, persistedPrimary, sourceType, models = {}) {
    const DocumentModel = models.DocumentModel || Document;
    const retainFiles = persistedPrimary.backend !== 'remote';
    let primary = null;
    for (const candidate of extractedPdfCandidates(result)) {
        const hashed = candidate.isPrimary
            ? persistedPrimary
            : await hashFile(candidate.localPath);
        const record = await DocumentModel.findOneAndUpdate({
            project_id: project.project_id,
            sha256: hashed.sha256,
        }, { $set: {
            project_ref: project._id,
            filename: candidate.filename,
            // Direct PDFs have no archive entry. Use the filename so URL-based
            // duplicate prevention applies consistently to both ZIP and PDF sources.
            entry_name: candidate.entryName || candidate.filename,
            document_type: inferDocumentType(candidate.entryName || candidate.filename),
            is_primary: candidate.isPrimary,
            source_url: result.pdf_url,
            source_type: sourceType,
            official_detail_url: result.official_detail_url,
            storage: {
                backend: retainFiles
                    ? (candidate.isPrimary ? persistedPrimary.backend || 'local' : 'local')
                    : 'remote',
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
        });
        if (candidate.isPrimary) primary = record;
    }
    if (!primary) throw new Error('Primary PDF record was not persisted');
    return primary;
}

/** Save complete page text and OCR metadata using idempotent page upserts. */
export async function persistOcrPages(document, textResult, textArtifactUri, models = {}) {
    const DocumentModel = models.DocumentModel || Document;
    const PageModel = models.PageModel || DocumentPage;
    const operations = textResult.pages.map(page => ({
        updateOne: {
            filter: { document_id: document._id, page_number: page.page_number },
            update: { $set: {
                project_id: document.project_id,
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
    if (operations.length) await PageModel.bulkWrite(operations, { ordered: false });
    await PageModel.deleteMany({
        document_id: document._id,
        page_number: { $gt: textResult.pageCount },
    });
    await DocumentModel.updateOne({ _id: document._id }, { $set: {
        text: {
            storage: textArtifactUri?.startsWith('gs://')
                ? 'gcs'
                : textArtifactUri ? 'local' : 'mongodb',
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
    } });
}

export async function persistVertexSummary(document, textResult, vertex, needsReview, models = {}) {
    const DocumentModel = models.DocumentModel || Document;
    const SummaryModel = models.SummaryModel || DocumentSummary;
    const summary = await SummaryModel.findOneAndUpdate({
        document_id: document._id,
        text_sha256: textResult.textHash,
        model: vertex.model,
        prompt_version: vertex.promptVersion,
    }, { $set: {
        project_id: document.project_id,
        document_sha256: document.sha256,
        model_version: vertex.modelVersion,
        extraction: vertex.extraction,
        usage: {
            input_tokens: vertex.usage.inputTokens,
            output_tokens: vertex.usage.outputTokens,
        },
        confidence: vertex.extraction.confidence,
        needs_review: Boolean(needsReview),
        processed_at: new Date(),
    } }, {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
    });
    await DocumentModel.updateOne({ _id: document._id }, { $set: {
        processing_status: needsReview ? 'review_required' : 'summarized',
    } });
    return summary;
}
