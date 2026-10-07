#!/usr/bin/env node
import 'dotenv/config';
import mongoose from 'mongoose';
import { mkdtemp, readdir } from 'node:fs/promises';
import path from 'node:path';
import connectDB from '../lib/db.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import ExtractionRun from '../models/ExtractionRun.js';
import DocumentSummary from '../models/DocumentSummary.js';
import { downloadAttachment } from '../lib/scraper.js';
import { extractPdfsFromZip } from '../lib/archive-extractor.js';
import { extractPdfText } from '../lib/text-extraction.js';
import { hashFile, removeTransientDocuments } from '../lib/document-storage.js';
import { extractionRunKey, persistOcrPages, persistVertexSummary, withMongoTransaction } from '../lib/mongo-artifacts.js';
import { extractTorWithVertex } from '../lib/vertex/tor-extractor.js';
import { TOR_PROMPT_VERSION } from '../lib/vertex/response-schema.js';

// This operator command processes supplementary documents without changing the
// project's primary PDF or latest summary pointers. Source files are temporary.
async function main() {
    await connectDB();
    const processedIds = await DocumentPage.distinct('document_id');
    const summarizedIds = await DocumentSummary.distinct('document_id', {
        model: process.env.VERTEX_MODEL || 'gemini-2.5-flash', prompt_version: TOR_PROMPT_VERSION,
    });
    const pending = await Document.find({
        is_current_primary: false,
        $or: [{ _id: { $nin: processedIds } }, { _id: { $nin: summarizedIds } }],
    }).sort({ 'storage.size_bytes': 1 }).lean();
    const storageDir = process.argv[2] || await mkdtemp('/private/tmp/tor-secondary-');
    const groups = new Map();
    for (const document of pending) {
        if (!groups.has(document.source_url)) groups.set(document.source_url, []);
        groups.get(document.source_url).push(document);
    }
    console.log(JSON.stringify({ pending: pending.length, archives: groups.size, storageDir }));
    const results = [];
    await Promise.all([...groups].map(async ([url, documents]) => {
        let downloaded;
        try {
            const projectId = documents[0].project_id;
            const directory = path.join(storageDir, projectId);
            const cachedZip = await readdir(directory).then(names => names.find(name => name.endsWith('.zip'))).catch(() => null);
            const cachedPdfs = await readdir(path.join(directory, 'extracted')).catch(() => []);
            if (documents.every(document => cachedPdfs.includes(document.filename))) {
                downloaded = { extractedPdfs: documents.map(document => ({
                    entryName: document.entry_name,
                    path: path.join(directory, 'extracted', document.filename),
                })) };
            } else if (cachedZip) {
                const archivePath = path.join(directory, cachedZip);
                const extracted = await extractPdfsFromZip(archivePath);
                downloaded = { archivePath, extractedPdfs: extracted.pdfs.map(file => ({ ...file, path: file.absolutePath })) };
            } else {
                console.log(`Downloading archive for ${projectId}`);
                downloaded = await downloadAttachment({ url, name: 'procurement.zip', type: 'zip' }, { projectId, storageDir });
            }
            const files = downloaded.extractedPdfs || [];
            for (const document of documents) {
                let textResult;
                try {
                    const file = files.find(item => item.entryName === document.entry_name);
                    if (!file) throw new Error(`Archive entry not found: ${document.entry_name}`);
                    const hash = await hashFile(file.path);
                    if (hash.sha256 !== document.sha256) throw new Error('Downloaded PDF hash differs from registered document');
                    console.log(`Extracting ${document.project_id}: ${document.entry_name}`);
                    textResult = await extractPdfText(file.path, { onProgress: async progress => {
                        if (progress.pagesProcessed % 10 === 0 || progress.pagesProcessed === progress.pageCount)
                            console.log(`${document.entry_name}: ${progress.pagesProcessed}/${progress.pageCount} pages`);
                    } });
                    const run = await withMongoTransaction(async session => {
                        const record = await ExtractionRun.findOneAndUpdate({ run_key: extractionRunKey(document, textResult) }, { $setOnInsert: {
                            project_id: document.project_id, project_ref: document.project_ref,
                            document_id: document._id, processor_fingerprint: textResult.fingerprint,
                            provider: 'poppler+tesseract', configuration: textResult.config,
                            text_sha256: textResult.textHash, text_storage: 'mongodb',
                            page_count: textResult.pageCount, ocr_pages: textResult.ocrPages,
                            needs_review: textResult.needsReview, review_pages: textResult.reviewPages,
                            status: textResult.needsReview ? 'review_required' : 'completed', completed_at: new Date(),
                        } }, { upsert: true, returnDocument: 'after', session });
                        await persistOcrPages(document, textResult, null, {}, { session, extractionRun: record });
                        return record;
                    });
                    console.log(`Stored ${textResult.pageCount} pages for ${document.entry_name}`);
                    let summary = await DocumentSummary.findOne({ extraction_run_id: run._id,
                        model: process.env.VERTEX_MODEL || 'gemini-2.5-flash', prompt_version: TOR_PROMPT_VERSION });
                    if (!summary && process.env.VERTEX_AI_ENABLED === 'true') {
                        const vertex = await extractTorWithVertex({ pages: textResult.pages });
                        const review = textResult.needsReview || vertex.extraction.confidence < 0.8
                            || vertex.extraction.fiscal_budget?.status === 'ambiguous'
                            || Boolean(vertex.extraction.fiscal_budget?.warnings?.length)
                            || vertex.extraction.risk_findings.some(finding => finding.severity === 'high');
                        summary = await withMongoTransaction(session => persistVertexSummary(document, textResult, vertex, review, {}, { session, extractionRun: run }));
                    }
                    results.push({ document_id: String(document._id), project_id: document.project_id,
                        pages: textResult.pageCount, summary_id: summary ? String(summary._id) : null });
                } catch (error) {
                    results.push({ document_id: String(document._id), error: error.message });
                    console.error(`${document.entry_name}: ${error.message}`);
                } finally {
                    if (textResult) await removeTransientDocuments({}, textResult);
                }
            }
        } catch (error) {
            console.error(`Archive failed: ${error.message}`);
            results.push(...documents.map(document => ({ document_id: String(document._id), error: error.message })));
        } finally {
            if (downloaded) await removeTransientDocuments({ archive_path: downloaded.archivePath,
                extracted_pdfs: downloaded.extractedPdfs || [] });
        }
    }));
    console.log(JSON.stringify({ results }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
