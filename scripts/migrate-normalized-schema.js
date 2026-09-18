#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { extractionRunKey } from '../lib/mongo-artifacts.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';
import Project from '../models/Project.js';

const dryRun = process.argv.includes('--dry-run');
const finalizeIndexes = process.argv.includes('--finalize-indexes');
const batchArg = process.argv.find(value => value.startsWith('--batch-size='));
const batchSize = Math.max(1, Math.min(1000, Number(batchArg?.split('=')[1]) || 100));

function legacyTextResult(project, document, pageCount) {
    const fingerprint = project.ocr?.processor_version
        || document.text?.processor_fingerprint
        || 'legacy-unknown';
    const textHash = project.document?.text_sha256
        || project.processing?.text_sha256
        || document.text?.sha256;
    if (!textHash) return null;
    return {
        fingerprint,
        textHash,
        pageCount: project.document?.page_count || document.text?.page_count || pageCount,
    };
}

async function resolvePrimaryDocument(project, session, allowCreate = true) {
    let document = null;
    const knownId = project.primary_document_id || project.document?.record_id;
    if (knownId) document = await Document.findById(knownId).session(session);
    if (!document && project.document?.sha256) {
        document = await Document.findOne({
            project_id: project.project_id,
            sha256: project.document.sha256,
        }).session(session);
    }
    if (!document && allowCreate && project.document?.sha256 && project.pdf_url) {
        document = await Document.findOneAndUpdate({
            project_id: project.project_id,
            sha256: project.document.sha256,
        }, { $set: {
            project_ref: project._id,
            filename: project.document.filename || `${project.project_id}.pdf`,
            entry_name: project.document.filename || `${project.project_id}.pdf`,
            document_type: 'unknown',
            is_primary: true,
            source_url: project.pdf_url,
            source_type: project.document.source_type || 'legacy',
            official_detail_url: project.document.official_detail_url,
            storage: {
                backend: project.document.gcs_uri ? 'gcs'
                    : project.document.local_path ? 'local' : 'remote',
                local_path: project.document.local_path,
                gcs_uri: project.document.gcs_uri,
                mime_type: project.document.mime_type || project.pdf_content_type || 'application/pdf',
                size_bytes: project.document.size_bytes || project.pdf_size,
            },
            text: {
                storage: project.document.text_storage || 'mongodb',
                artifact_uri: project.document.text_uri,
                sha256: project.document.text_sha256,
                page_count: project.document.page_count,
                processor_fingerprint: project.ocr?.processor_version,
            },
            processing_status: project.processing?.status === 'completed'
                ? 'summarized'
                : project.processing?.status === 'review_required'
                    ? 'review_required' : 'text_ready',
        } }, { upsert: true, returnDocument: 'after', session });
    }
    return document;
}

async function migrateProject(project) {
    if (dryRun) {
        const document = await resolvePrimaryDocument(project, null, false);
        const canCreate = Boolean(project.document?.sha256 && project.pdf_url);
        return { migrated: Boolean(document || canCreate), wouldCreateDocument: !document && canCreate, dryRun: true };
    }
    return mongoose.connection.transaction(async session => {
        const document = await resolvePrimaryDocument(project, session);
        if (!document) return { migrated: false, reason: 'no document identity' };

        await Document.updateMany({
            project_id: project.project_id,
            _id: { $ne: document._id },
            is_current_primary: true,
        }, { $set: { is_current_primary: false } }, { session });
        await Document.updateOne({ _id: document._id }, { $set: {
            is_primary: true,
            is_current_primary: true,
            version: document.version || project.version_info?.version || 1,
            discovered_at: document.discovered_at || project.version_info?.detected_at || project.updated_at,
        } }, { session });

        const pageCount = await DocumentPage.countDocuments({ document_id: document._id }).session(session);
        const textResult = legacyTextResult(project, document, pageCount);
        let extractionRun = null;
        if (textResult) {
            extractionRun = await ExtractionRun.findOneAndUpdate({
                run_key: extractionRunKey(document, textResult),
            }, { $setOnInsert: {
                project_id: project.project_id,
                project_ref: project._id,
                document_id: document._id,
                processor_fingerprint: textResult.fingerprint,
                provider: project.ocr?.provider || 'poppler+tesseract',
                text_sha256: textResult.textHash,
                text_storage: project.document?.text_storage || 'mongodb',
                text_artifact_uri: project.document?.text_uri,
                page_count: textResult.pageCount || pageCount,
                ocr_pages: project.ocr?.ocr_pages || 0,
                needs_review: Boolean(project.ocr?.needs_review),
                review_pages: project.ocr?.review_pages || [],
                status: project.ocr?.needs_review ? 'review_required' : 'completed',
                completed_at: project.ocr?.completed_at || project.updated_at,
            } }, { upsert: true, returnDocument: 'after', session });
            await DocumentPage.updateMany({
                document_id: document._id,
                extraction_run_id: { $exists: false },
            }, { $set: { extraction_run_id: extractionRun._id } }, { session });
        }

        let summary = null;
        const summaryId = project.latest_summary_id || project.processing?.summary_record_id;
        if (summaryId) summary = await DocumentSummary.findById(summaryId).session(session);
        if (!summary) {
            summary = await DocumentSummary.findOne({ document_id: document._id })
                .sort({ processed_at: -1 })
                .session(session);
        }
        if (summary && extractionRun && !summary.extraction_run_id) {
            await DocumentSummary.updateOne({ _id: summary._id }, {
                $set: { extraction_run_id: extractionRun._id },
            }, { session });
        }

        await Project.updateOne({ _id: project._id }, { $set: {
            primary_document_id: document._id,
            ...(extractionRun ? { latest_extraction_run_id: extractionRun._id } : {}),
            ...(summary ? { latest_summary_id: summary._id } : {}),
            'workflow.status': project.processing?.status,
            'workflow.error': project.processing?.error || null,
            'workflow.updated_at': project.updated_at || new Date(),
        } }, { session });
        return { migrated: true, extractionRun: Boolean(extractionRun), summary: Boolean(summary) };
    });
}

async function finalizeHistoricalIndexes() {
    const [unlinkedProjects, unlinkedPages, unlinkedSummaries] = await Promise.all([
        Project.countDocuments({
            primary_document_id: { $exists: false },
            $or: [
                { 'document.record_id': { $exists: true } },
                { 'document.sha256': { $exists: true } },
                { pdf_url: { $type: 'string', $gt: '' } },
            ],
        }),
        DocumentPage.countDocuments({ extraction_run_id: { $exists: false } }),
        DocumentSummary.countDocuments({ extraction_run_id: { $exists: false } }),
    ]);
    if (unlinkedProjects || unlinkedPages || unlinkedSummaries) {
        throw new Error(
            'Cannot finalize indexes before reconciliation: '
            + `${unlinkedProjects} projects, ${unlinkedPages} pages, and `
            + `${unlinkedSummaries} summaries remain unlinked`
        );
    }
    const pageCollection = mongoose.connection.db.collection('documentpages');
    const summaryCollection = mongoose.connection.db.collection('documentsummaries');
    const dropIfPresent = async (collection, name) => {
        const indexes = await collection.indexes();
        if (indexes.some(index => index.name === name)) await collection.dropIndex(name);
    };
    await dropIfPresent(pageCollection, 'document_id_1_page_number_1');
    await dropIfPresent(summaryCollection, 'document_id_1_text_sha256_1_model_1_prompt_version_1');
    await Promise.all([
        DocumentPage.createIndexes(),
        DocumentSummary.createIndexes(),
    ]);
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    if (dryRun && finalizeIndexes) throw new Error('--dry-run cannot be combined with --finalize-indexes');
    if (dryRun) mongoose.set('autoIndex', false);
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const totals = { scanned: 0, migrated: 0, skipped: 0, failed: 0 };
    const cursor = Project.find({}).sort({ _id: 1 }).cursor({ batchSize });
    for await (const project of cursor) {
        totals.scanned++;
        try {
            const result = await migrateProject(project);
            if (result.migrated) totals.migrated++;
            else totals.skipped++;
        } catch (error) {
            totals.failed++;
            console.error(`${project.project_id}: ${error.message}`);
        }
    }
    if (finalizeIndexes && totals.failed === 0) await finalizeHistoricalIndexes();
    console.log(JSON.stringify({ dryRun, finalizeIndexes, ...totals }, null, 2));
    await mongoose.disconnect();
    if (totals.failed) process.exitCode = 1;
}

main().catch(async error => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
