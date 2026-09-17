#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';
import Project from '../models/Project.js';

const strict = process.argv.includes('--strict');

function compare(project, document, run, summary, pages) {
    const mismatches = [];
    const expectsDocument = Boolean(
        project.primary_document_id
        || project.document?.record_id
        || project.document?.sha256
        || project.pdf_url
    );
    if (!document) return expectsDocument ? ['missing primary document'] : [];
    if (project.pdf_url && document.source_url !== project.pdf_url) mismatches.push('source URL');
    if (project.document?.sha256 && document.sha256 !== project.document.sha256) mismatches.push('document hash');
    if (run) {
        if (project.document?.text_sha256 && run.text_sha256 !== project.document.text_sha256) mismatches.push('text hash');
        if (run.page_count !== pages) mismatches.push('page count');
    } else if (project.document?.text_sha256) mismatches.push('missing extraction run');
    if (summary) {
        if (project.extracted_data?.summary && summary.extraction?.summary !== project.extracted_data.summary) mismatches.push('summary text');
        if (project.processing?.confidence != null && summary.confidence !== project.processing.confidence) mismatches.push('summary confidence');
    } else if (project.processing?.summary_source === 'pdf') mismatches.push('missing summary');
    return mismatches;
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    mongoose.set('autoIndex', false);
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const report = { projects: 0, matched: 0, mismatched: 0, details: [] };
    for await (const project of Project.find({}).cursor()) {
        report.projects++;
        const [document, run, summary] = await Promise.all([
            project.primary_document_id ? Document.findById(project.primary_document_id).lean() : null,
            project.latest_extraction_run_id ? ExtractionRun.findById(project.latest_extraction_run_id).lean() : null,
            project.latest_summary_id ? DocumentSummary.findById(project.latest_summary_id).lean() : null,
        ]);
        const pages = run ? await DocumentPage.countDocuments({ extraction_run_id: run._id }) : 0;
        const mismatches = compare(project, document, run, summary, pages);
        if (mismatches.length) {
            report.mismatched++;
            report.details.push({ project_id: project.project_id, mismatches });
        } else report.matched++;
    }
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    if (strict && report.mismatched) process.exitCode = 1;
}

main().catch(async error => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
