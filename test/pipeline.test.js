import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyProjectMetadata } from '../lib/classifier.js';
import { hashFile, persistDocument } from '../lib/document-storage.js';
import { validateRemoteDocumentUrl } from '../lib/document-resolver.js';
import { buildProjectUpsert, mapToProjectSchema, parseThaiDate } from '../lib/egp-api.js';
import { validateTorExtraction } from '../lib/vertex/response-schema.js';
import ProcessingJob from '../models/ProcessingJob.js';
import Project from '../models/Project.js';
import {
    configuredMongoDnsServers,
    isMongoSrvDnsError,
    mongoConnectionOptions,
} from '../lib/mongo-network.js';

const baseRecord = {
    project_id: '69069021440',
    project_name: 'จ้างพัฒนาระบบสารสนเทศ',
    dept_name: 'หน่วยงานทดสอบ',
    project_money: '1500000',
    announce_date: '21 มิ.ย. 69',
};

test('Thai dates are converted from Buddhist Era', () => {
    assert.equal(parseThaiDate('21 มิ.ย. 69').toISOString().slice(0, 10), '2026-06-21');
});

test('MongoDB connection fallback recognizes only SRV DNS failures', () => {
    assert.equal(isMongoSrvDnsError({ code: 'EBADRESP' }), true);
    assert.equal(isMongoSrvDnsError(new Error('authentication failed')), false);
    assert.equal(mongoConnectionOptions().dbName, process.env.MONGODB_DB_NAME || 'moneytamngan');
    assert.ok(configuredMongoDnsServers().length >= 1);
});

test('API mapping omits a missing PDF URL', () => {
    const mapped = mapToProjectSchema(baseRecord);
    assert.equal(mapped.project_id, baseRecord.project_id);
    assert.equal(mapped.budget, 1_500_000);
    assert.equal(Object.hasOwn(mapped, 'pdf_url'), false);
    assert.equal(Object.hasOwn(mapped, 'extracted_data'), false);
});

test('upsert refresh cannot overwrite enrichment fields', () => {
    const { update } = buildProjectUpsert(baseRecord);
    assert.equal(Object.hasOwn(update.$set, 'pdf_url'), false);
    assert.equal(Object.hasOwn(update.$set, 'extracted_data'), false);
    assert.equal(update.$setOnInsert['processing.status'], 'metadata_ingested');
    assert.equal(Object.hasOwn(update.$set, 'timeline.contract_start'), false);
});

test('project and processing-job state machines accept their initial records', async () => {
    const project = new Project({
        project_id: baseRecord.project_id,
        project_name: baseRecord.project_name,
        dept_name: baseRecord.dept_name,
        budget: 1_500_000,
        is_software: null,
    });
    const job = new ProcessingJob({ project_id: baseRecord.project_id });
    await assert.doesNotReject(() => project.validate());
    await assert.doesNotReject(() => job.validate());
    assert.equal(project.processing.status, 'metadata_ingested');
    assert.equal(job.status, 'queued');
});

test('metadata classifier recognizes software and preserves uncertainty', () => {
    const software = classifyProjectMetadata(baseRecord);
    assert.equal(software.status, 'software');
    assert.equal(software.isSoftware, true);

    const uncertain = classifyProjectMetadata({ project_name: 'โครงการประจำปี', dept_name: 'กรมทดสอบ' });
    assert.equal(uncertain.status, 'uncertain');
    assert.equal(uncertain.isSoftware, null);
});

test('document resolver rejects private and credential-bearing URLs', () => {
    assert.throws(() => validateRemoteDocumentUrl('http://127.0.0.1/private.pdf'));
    assert.throws(() => validateRemoteDocumentUrl('https://user:pass@example.com/a.pdf'));
    assert.equal(
        validateRemoteDocumentUrl('https://example.go.th/files/a.pdf'),
        'https://example.go.th/files/a.pdf'
    );
});

test('local storage produces a stable SHA-256 identity', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'money-tam-ngan-test-'));
    const file = path.join(directory, 'sample.pdf');
    await writeFile(file, Buffer.from('%PDF-1.7\nfixture'));
    const first = await hashFile(file);
    const persisted = await persistDocument({
        projectId: baseRecord.project_id,
        fiscalYear: '2569',
        localPath: file,
        mimeType: 'application/pdf',
    });
    assert.equal(persisted.backend, 'local');
    assert.equal(persisted.sha256, first.sha256);
    assert.equal(persisted.size, first.size);
});

test('Vertex extraction validation normalizes evidence and rejects invalid confidence', () => {
    const value = validateTorExtraction({
        summary: 'สรุป',
        qualifications: [{ value: ' มีประสบการณ์ ', page: 2 }],
        scope_of_work: [],
        tech_stack: [{ value: 'PostgreSQL' }],
        flagged_clauses: [],
        confidence: 0.9,
        document_language: 'th',
    });
    assert.equal(value.qualifications[0].value, 'มีประสบการณ์');
    assert.throws(() => validateTorExtraction({
        summary: '', qualifications: [], scope_of_work: [], tech_stack: [],
        flagged_clauses: [], confidence: 2, document_language: 'th',
    }));
});
