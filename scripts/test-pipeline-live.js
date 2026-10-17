#!/usr/bin/env node
// Real OCR + real Vertex + real Mongo transactions. Government transport is
// reported separately; the archived PDF/eligibility adapter is explicitly a fixture.
import 'dotenv/config';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { mkdtemp, copyFile, appendFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { fetchFromEGP } from '../lib/egp-api.js';
import { processProject } from '../lib/processing-pipeline.js';
import { extractPdfText } from '../lib/text-extraction.js';
import { hydrateProjectCompatibility } from '../lib/project-compat.js';
import { toTorDetail } from '../lib/api/tor-response.js';
import { verifyDiscoveryCandidate } from '../lib/discovery-candidates.js';
import { enqueueProject, claimNextJob, completeJob } from '../lib/job-queue.js';
import { withMongoTransaction, persistPdfBundle } from '../lib/mongo-artifacts.js';
import { hashFile, removeTransientDocuments } from '../lib/document-storage.js';
import Project from '../models/Project.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';
import ProcessingJob from '../models/ProcessingJob.js';
import VertexChunk from '../models/VertexChunk.js';
import DiscoveryCandidate from '../models/DiscoveryCandidate.js';

async function main() {
    const pdfPath = process.argv[2];
    if (!pdfPath) throw new Error('Usage: node scripts/test-pipeline-live.js /path/to/small-thai.pdf');
    const dbName = process.env.PIPELINE_TEST_DB || `moneytamngan_e2e_${Date.now()}`;
    if (!/^moneytamngan_e2e_\w+$/.test(dbName)) throw new Error('Test DB must start with moneytamngan_e2e_');
    process.env.MONGODB_DB_NAME = dbName;
    process.env.VERTEX_AI_ENABLED = 'true';
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const models = [Project, Document, DocumentPage, ExtractionRun, DocumentSummary, ProcessingJob, VertexChunk, DiscoveryCandidate];
    for (const model of models) await model.createIndexes();
    console.log(`Isolated test database: ${dbName}`);
    try {
        const government = await fetchFromEGP({ year: '2569', limit: 5 });
        assert.ok(Array.isArray(government.records));
        console.log(`Live government API: ${government.records.length} records (contract metadata, not proof of open bidding)`);
    } catch (error) { console.log(`Live government API BLOCKED: ${error.message}`); }
    const projectId = '66089621472';
    await DiscoveryCandidate.updateOne({ project_id: projectId }, { $set: {
        payload: { project_id: projectId, project_name: 'E2E fixture: พัฒนาระบบสารสนเทศ ERP',
            dept_name: 'Isolated test fixture', project_money: '100000', project_status: 'Active' },
        status: 'pending',
    } }, { upsert: true });
    const eligibility = { status: 'open', reason: 'Controlled fixture, NOT live bidding proof',
        checked_at: new Date(), bid_deadline: new Date('2030-01-01T00:00:00Z') };
    await verifyDiscoveryCandidate(projectId, { verifyEligibility: async () => eligibility, loadKeywords: async () => ({}) });
    const queued = await enqueueProject(projectId);
    assert.equal(queued.reused, true);
    const job = await claimNextJob();
    assert.equal(job.project_id, projectId);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-live-e2e-'));
    const temporaryPdf = path.join(dir, 'fixture.pdf');
    await copyFile(pdfPath, temporaryPdf);
    let ocrCalls = 0;
    const result = await processProject(projectId, { allowBrowserFallback: false, onProgress: console.log }, {
        verifyEligibility: async () => eligibility,
        acquireDocument: async () => ({ sourceType: 'e2e_fixture', result: {
            pdf_url: 'https://example.org/e2e-archived-tor.pdf', pdf_path: temporaryPdf,
            pdf_size: (await stat(temporaryPdf)).size, pdf_content_type: 'application/pdf',
        } }),
        extractText: async (...args) => { ocrCalls++; return extractPdfText(...args); },
    });
    await completeJob(job._id, result);
    assert.ok(['completed', 'review_required'].includes(result.status));
    const project = await Project.findOne({ project_id: projectId }).lean();
    const detail = toTorDetail(await hydrateProjectCompatibility(project));
    assert.ok(detail.summary);
    assert.equal(detail.fiscalBudget?.year, 2565);
    const run = await ExtractionRun.findById(project.latest_extraction_run_id).lean();
    assert.equal(run.page_count, 1);
    assert.equal(run.ocr_pages, 1);
    assert.ok(Object.keys(run.configuration).length);
    assert.equal(await stat(temporaryPdf).then(() => true).catch(() => false), false);
    const counts = await Promise.all(models.map(model => model.countDocuments()));
    const resumed = await processProject(projectId, {}, {
        verifyEligibility: async () => eligibility,
        acquireDocument: async () => assert.fail('Repeat run must not download'),
        extractText: async () => assert.fail('Repeat run must not OCR'),
        extractWithVertex: async () => assert.fail('Repeat run must reuse summary'),
    });
    assert.equal(resumed.reused, true);
    assert.equal(resumed.resumedOcr, true);
    assert.deepEqual(await Promise.all(models.map(model => model.countDocuments())), counts);
    assert.equal(ocrCalls, 1);
    await assert.rejects(withMongoTransaction(async session => {
        await Project.updateOne({ _id: project._id }, { $set: { project_name: 'ROLLBACK_SENTINEL' } }, { session });
        throw new Error('intentional transaction failure');
    }), /intentional transaction failure/);
    assert.notEqual((await Project.findById(project._id).lean()).project_name, 'ROLLBACK_SENTINEL');
    const historyProject = await Project.create({ project_id: 'version-probe',
        project_name: 'Isolated PDF version test', dept_name: 'Isolated test fixture', budget: 1 });
    const historyPdf = path.join(dir, 'history.pdf');
    await copyFile(pdfPath, historyPdf);
    const historyResult = { pdf_path: historyPdf, pdf_url: 'https://example.org/same-versioned-url.pdf', pdf_content_type: 'application/pdf' };
    const firstVersion = await persistPdfBundle(historyProject, historyResult,
        { ...await hashFile(historyPdf), backend: 'remote' }, 'e2e_fixture');
    // A legal trailing newline changes the PDF byte hash while retaining a valid PDF.
    await appendFile(historyPdf, '\n');
    const secondVersion = await persistPdfBundle(await Project.findById(historyProject._id).lean(), historyResult,
        { ...await hashFile(historyPdf), backend: 'remote' }, 'e2e_fixture');
    assert.notEqual(String(firstVersion._id), String(secondVersion._id));
    assert.equal(String(secondVersion.previous_document_id), String(firstVersion._id));
    assert.equal(await Document.countDocuments({ project_id: 'version-probe' }), 2);
    assert.equal(await Document.countDocuments({ project_id: 'version-probe', is_current_primary: true }), 1);
    await removeTransientDocuments({ pdf_path: historyPdf });
    console.log(JSON.stringify({ status: 'PASS', dbName, projectId, summaryId: project.latest_summary_id,
        pipelineCollectionsBeforeVersionProbe: Object.fromEntries(models.map((model, index) => [model.collection.name, counts[index]])),
        versionProbe: { projectId: 'version-probe', documents: 2, currentPrimary: 1 },
        checks: ['candidate promotion', 'unique active job', 'real OCR', 'real Vertex', 'normalized API view',
            'fiscal year', 'temporary cleanup', 'idempotent resume', 'transaction rollback', 'changed PDF at same URL retains history'],
        detail,
    }, null, 2));
}
main().catch(error => { console.error(`E2E FAILED: ${error.message}`); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
