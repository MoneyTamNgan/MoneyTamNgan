import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import yazl from 'yazl';
import { extractPdfsFromZip } from '../lib/archive-extractor.js';
import { classifyProjectMetadata } from '../lib/classifier.js';
import { hashFile, persistDocument } from '../lib/document-storage.js';
import { validateRemoteDocumentUrl } from '../lib/document-resolver.js';
import { buildProjectUpsert, mapToProjectSchema, parseThaiDate } from '../lib/egp-api.js';
import { parseAggregatorHtml } from '../lib/egp-aggregator.js';
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

async function createZip(filePath, entries) {
    const zip = new yazl.ZipFile();
    for (const entry of entries) {
        zip.addBuffer(Buffer.from(entry.content), entry.name);
    }
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(filePath));
}

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

test('aggregator parser resolves only the encrypted official e-GP detail link', () => {
    const projectId = '68019088742';
    const encrypted = 'abc123_encrypted-token';
    const parsed = parseAggregatorHtml(`
        <html><head><link rel="canonical" href="https://egp-gprocurement.com/p/${projectId}/sample"></head>
        <body><h1>โครงการทดสอบ</h1>
        <a href="https://evil.example/files/a.pdf">untrusted file</a>
        <a href="https://process5.gprocurement.go.th/egp-agpc01-web/announcement/procurement/${encrypted}">
            ดูข้อมูลทางการ
        </a></body></html>
    `, projectId, `https://egp-gprocurement.com/p/${projectId}`);

    assert.equal(parsed.projectId, projectId);
    assert.equal(parsed.title, 'โครงการทดสอบ');
    assert.match(parsed.officialDetailUrl, /process5\.gprocurement\.go\.th/);
    assert.equal(parsed.officialLinks.length, 1);
});

test('aggregator parser rejects a page without an official detail link', () => {
    assert.throws(
        () => parseAggregatorHtml(
            '<link rel="canonical" href="https://egp-gprocurement.com/p/68019088742">',
            '68019088742',
            'https://egp-gprocurement.com/p/68019088742'
        ),
        /no official e-GP detail link/
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

test('ZIP extraction keeps the archive and selects the e-Bidding PDF', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'money-tam-ngan-zip-test-'));
    const archive = path.join(directory, 'ebidding.zip');
    await createZip(archive, [
        { name: 'เอกสาร/ประกาศ.pdf', content: '%PDF-1.7\nannouncement' },
        { name: 'เอกสาร/ร่างเอกสารประกวดราคา-e-Bidding.pdf', content: '%PDF-1.7\ntor body' },
        { name: 'เอกสาร/readme.txt', content: 'not a PDF' },
    ]);

    const result = await extractPdfsFromZip(archive);
    assert.equal(result.pdfs.length, 2);
    assert.match(result.primary.entryName, /e-Bidding/i);
    assert.equal(path.dirname(result.primary.absolutePath), path.join(directory, 'extracted'));
    assert.equal(result.archivePath, archive);
});

test('ZIP extraction rejects files that only pretend to be PDFs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'money-tam-ngan-bad-zip-test-'));
    const archive = path.join(directory, 'invalid.zip');
    await createZip(archive, [
        { name: 'TOR.pdf', content: '<html>not a PDF</html>' },
    ]);

    await assert.rejects(
        () => extractPdfsFromZip(archive),
        /no valid PDF files/
    );
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
