import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import mongoose from 'mongoose';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import Project from '../models/Project.js';
import {
    inferDocumentType,
    persistOcrPages,
    persistPdfRecords,
    persistVertexSummary,
} from '../lib/mongo-artifacts.js';

test('artifact schemas validate linked PDF, OCR page and Vertex summary records', async () => {
    const documentId = new mongoose.Types.ObjectId();
    const document = new Document({
        _id: documentId,
        project_id: '67079116603',
        sha256: 'a'.repeat(64),
        filename: 'tor.pdf',
    });
    const page = new DocumentPage({
        project_id: '67079116603', document_id: documentId, page_number: 1,
        text: 'ข้อความ', text_sha256: 'b'.repeat(64), extraction_method: 'ocr',
        processor_fingerprint: 'tesseract-test',
    });
    const summary = new DocumentSummary({
        project_id: '67079116603', document_id: documentId,
        document_sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64),
        model: 'gemini-test', prompt_version: 'prompt-v1', extraction: { summary: 'สรุป' },
    });
    await assert.doesNotReject(() => document.validate());
    await assert.doesNotReject(() => page.validate());
    await assert.doesNotReject(() => summary.validate());
});

test('schemas enforce stable project and document source identities', () => {
    const projectIndexes = Project.schema.indexes();
    const documentIndexes = Document.schema.indexes();
    assert.ok(projectIndexes.some(([keys, options]) => (
        keys.project_id === 1 && options.unique === true
    )));
    assert.ok(projectIndexes.some(([keys, options]) => (
        keys.pdf_url === 1 && options.unique === true
        && options.partialFilterExpression?.pdf_url?.$type === 'string'
    )));
    assert.ok(documentIndexes.some(([keys, options]) => (
        keys.project_id === 1 && keys.source_url === 1 && keys.entry_name === 1
        && options.unique === true
    )));
});

test('document type inference recognizes common Thai procurement files', () => {
    assert.equal(inferDocumentType('ร่างเอกสารประกวดราคา-e-Bidding.pdf'), 'ebidding_terms');
    assert.equal(inferDocumentType('ขอบเขตของงาน TOR.pdf'), 'tor');
    assert.equal(inferDocumentType('ประกาศราคากลาง.pdf'), 'pricing');
});

test('all extracted PDFs are registered and the primary record is returned', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mongo-artifacts-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const primaryPath = path.join(directory, 'tor.pdf');
    const otherPath = path.join(directory, 'ประกาศ.pdf');
    await writeFile(primaryPath, '%PDF-primary');
    await writeFile(otherPath, '%PDF-other');
    const records = [];
    const DocumentModel = {
        async findOneAndUpdate(filter, update) {
            const record = { _id: `doc-${records.length + 1}`, project_id: filter.project_id,
                sha256: filter.sha256, ...update.$set };
            records.push(record);
            return record;
        },
    };
    const primary = await persistPdfRecords(
        { _id: new mongoose.Types.ObjectId(), project_id: '67079116603' },
        { pdf_path: primaryPath, pdf_size: 12, pdf_url: 'https://example.go.th/file.zip',
            extracted_pdfs: [
                { path: primaryPath, filename: 'tor.pdf', entryName: 'TOR.pdf', size: 12 },
                { path: otherPath, filename: 'ประกาศ.pdf', entryName: 'ประกาศ.pdf', size: 10 },
            ] },
        { sha256: 'p'.repeat(64), size: 12, backend: 'local', gcsUri: null },
        'egp_browser',
        { DocumentModel }
    );
    assert.equal(records.length, 2);
    assert.equal(primary.is_primary, true);
    assert.equal(records.find(record => !record.is_primary).document_type, 'announcement');
});

test('link-only PDF records omit local and GCS paths', async () => {
    const writes = [];
    const DocumentModel = {
        async findOneAndUpdate(filter, update) {
            writes.push(update.$set);
            return { _id: 'remote-doc', project_id: filter.project_id,
                sha256: filter.sha256, ...update.$set };
        },
    };
    await persistPdfRecords(
        { _id: new mongoose.Types.ObjectId(), project_id: '66089621472' },
        { pdf_path: '/tmp/tor.pdf', pdf_size: 10,
            pdf_url: 'https://process5.gprocurement.go.th/download.zip' },
        { sha256: 'r'.repeat(64), size: 10, backend: 'remote', gcsUri: null },
        'egp_browser',
        { DocumentModel }
    );
    assert.equal(writes[0].storage.backend, 'remote');
    assert.equal(writes[0].storage.local_path, undefined);
    assert.equal(writes[0].storage.gcs_uri, undefined);
    assert.equal(writes[0].source_url, 'https://process5.gprocurement.go.th/download.zip');
    assert.equal(writes[0].entry_name, 'tor.pdf');
});

test('OCR pages and Vertex output are persisted with document references', async () => {
    const writes = { pages: [], document: [], summaries: [] };
    const document = { _id: new mongoose.Types.ObjectId(), project_id: '67079116603', sha256: 'pdf-hash' };
    const DocumentModel = { updateOne: async (...args) => writes.document.push(args) };
    const PageModel = {
        bulkWrite: async operations => writes.pages.push(...operations),
        deleteMany: async () => {},
    };
    const textResult = {
        pages: [{ page_number: 1, text: 'ขอบเขตงาน', extraction_method: 'ocr', confidence: 0.88,
            psm: 3, warnings: [], needs_review: false }],
        textHash: 'text-hash', pageCount: 1, ocrPages: 1,
        fingerprint: 'ocr-v1', needsReview: false,
    };
    await persistOcrPages(document, textResult, '/text/document.json', { DocumentModel, PageModel });
    assert.equal(writes.pages[0].updateOne.update.$set.text, 'ขอบเขตงาน');
    assert.equal(writes.document[0][1].$set.processing_status, 'text_ready');

    const SummaryModel = {
        async findOneAndUpdate(filter, update) {
            writes.summaries.push({ filter, update });
            return { _id: 'summary-1' };
        },
    };
    const vertex = {
        model: 'gemini-test', modelVersion: 'gemini-test-001', promptVersion: 'prompt-v1',
        extraction: { summary: 'สรุป', confidence: 0.9 },
        usage: { inputTokens: 100, outputTokens: 20 },
    };
    const summary = await persistVertexSummary(document, textResult, vertex, false,
        { DocumentModel, SummaryModel });
    assert.equal(summary._id, 'summary-1');
    assert.equal(writes.summaries[0].update.$set.extraction.summary, 'สรุป');
    assert.equal(writes.document.at(-1)[1].$set.processing_status, 'summarized');
});
