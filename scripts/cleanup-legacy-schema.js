#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';
import Project from '../models/Project.js';

const apply = process.argv.includes('--apply');

const LEGACY_FIELDS = [
    'pdf_url',
    'pdf_path',
    'pdf_size',
    'pdf_content_type',
    'pdf_downloaded_at',
    'document',
    'ocr',
    'extracted_data',
    'classification_confidence',
    'version_info',
    'anomalies.flagged_clauses',
    'processing.summary_source',
    'processing.model',
    'processing.model_version',
    'processing.prompt_version',
    'processing.document_sha256',
    'processing.text_sha256',
    'processing.confidence',
    'processing.input_tokens',
    'processing.output_tokens',
    'processing.summary_record_id',
    'processing.processed_at',
];

async function assertNormalizedReferences() {
    const problems = [];
    for await (const project of Project.find({}).lean().cursor()) {
        if (project.primary_document_id
            && !await Document.exists({ _id: project.primary_document_id })) {
            problems.push(`${project.project_id}: primary document is missing`);
        }
        if (project.latest_extraction_run_id
            && !await ExtractionRun.exists({ _id: project.latest_extraction_run_id })) {
            problems.push(`${project.project_id}: latest extraction run is missing`);
        }
        if (project.latest_summary_id
            && !await DocumentSummary.exists({ _id: project.latest_summary_id })) {
            problems.push(`${project.project_id}: latest summary is missing`);
        }
        if (project.processing?.summary_source === 'pdf' && !project.latest_summary_id) {
            problems.push(`${project.project_id}: PDF summary has no normalized pointer`);
        }
        if (project.document?.text_sha256 && !project.latest_extraction_run_id) {
            problems.push(`${project.project_id}: OCR text has no normalized pointer`);
        }
        if ((project.document?.sha256 || project.pdf_url) && !project.primary_document_id) {
            problems.push(`${project.project_id}: document has no normalized pointer`);
        }
    }
    const [unlinkedPages, unlinkedSummaries] = await Promise.all([
        DocumentPage.countDocuments({ extraction_run_id: { $exists: false } }),
        DocumentSummary.countDocuments({ extraction_run_id: { $exists: false } }),
    ]);
    if (unlinkedPages) problems.push(`${unlinkedPages} document pages are not linked to an extraction run`);
    if (unlinkedSummaries) problems.push(`${unlinkedSummaries} summaries are not linked to an extraction run`);
    if (problems.length) {
        throw new Error(`Legacy cleanup refused:\n${problems.join('\n')}`);
    }
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    mongoose.set('autoIndex', false);
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    await assertNormalizedReferences();

    const collection = mongoose.connection.db.collection(Project.collection.collectionName);
    const before = Object.fromEntries(await Promise.all(LEGACY_FIELDS.map(async field => [
        field,
        await collection.countDocuments({ [field]: { $exists: true } }),
    ])));
    if (!apply) {
        console.log(JSON.stringify({ apply, safeToClean: true, legacyFields: before }, null, 2));
        await mongoose.disconnect();
        return;
    }

    const unset = Object.fromEntries(LEGACY_FIELDS.map(field => [field, '']));
    const result = await collection.updateMany({}, { $unset: unset });
    const indexes = await collection.indexes();
    if (indexes.some(index => index.name === 'uniq_project_pdf_url')) {
        await collection.dropIndex('uniq_project_pdf_url');
    }
    const after = Object.fromEntries(await Promise.all(LEGACY_FIELDS.map(async field => [
        field,
        await collection.countDocuments({ [field]: { $exists: true } }),
    ])));
    console.log(JSON.stringify({
        apply,
        safeToClean: true,
        matchedProjects: result.matchedCount,
        modifiedProjects: result.modifiedCount,
        before,
        after,
    }, null, 2));
    await mongoose.disconnect();
}

main().catch(async error => {
    console.error(error.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
