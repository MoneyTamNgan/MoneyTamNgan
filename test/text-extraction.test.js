import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { usableText, parseTsv, extractPdfText } from '../lib/text-extraction.js';
import { chunkPages, validatePageEvidence, extractTorWithVertex } from '../lib/vertex/tor-extractor.js';

test('Thai text passes quality checks while empty and broken font mappings require OCR', () => {
    assert.equal(usableText('ขอบเขตงานพัฒนาระบบสารสนเทศสำหรับหน่วยงานราชการ '.repeat(4)), true);
    assert.equal(usableText(''), false);
    assert.equal(usableText('\uFFFD'.repeat(80)), false);
    assert.equal(usableText('\uE001'.repeat(80)), false);
});

test('TSV extraction retains Thai line order and excludes non-word confidence', () => {
    const output = parseTsv('header\n1\t1\t0\t0\t0\t0\t0\t0\t0\t0\t-1\t\n'
        + '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t80\tขอบเขต\n'
        + '5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t90\tงาน\n'
        + '5\t1\t1\t1\t2\t1\t0\t0\t10\t10\t100\tระบบ');
    assert.equal(output.text, 'ขอบเขตงาน\nระบบ');
    assert.equal(output.confidence, 0.9);
});

test('long pages split without losing text or source page numbers', () => {
    const pages = [{ page_number: 1, text: 'ก'.repeat(53) }, { page_number: 2, text: 'ข'.repeat(14) }];
    const chunks = chunkPages(pages, 20);
    assert.ok(chunks.every(c => c.reduce((n, p) => n + p.text.length, 0) <= 20));
    for (const page of pages) assert.equal(chunks.flat().filter(p => p.page_number === page.page_number).map(p => p.text).join(''), page.text);
});

test('Vertex evidence cannot reference another chunk or omit a page', () => {
    const make = page => ({ qualifications: [{ value: 'test', page }], scope_of_work: [], tech_stack: [], flagged_clauses: [] });
    assert.throws(() => validatePageEvidence(make(4), [{ page_number: 3 }]), /invalid source page/);
    assert.throws(() => validatePageEvidence(make(undefined), [{ page_number: 3 }]), /invalid source page/);
    assert.doesNotThrow(() => validatePageEvidence(make(3), [{ page_number: 3 }]));
});

test('mixed PDF resumes an interrupted OCR page and invalidates cache when input changes', async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tor-ocr-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'test.pdf');
    await writeFile(file, '%PDF-fixture');
    let fail = true;
    const reads = [];
    const run = async (binary, args) => {
        if (args.includes('-v')) return 'poppler-test';
        if (args.includes('--version')) return 'tesseract-test';
        if (args.includes('--list-langs')) return 'tha\neng';
        if (binary === 'pdfinfo') return 'Pages: 2\nPage 2 size: 595 x 842 pts';
        if (binary === 'pdftotext') {
            reads.push(args[1]);
            return args[1] === '1' ? 'ข้อความภาษาไทยสำหรับทดสอบการอ่านเอกสาร '.repeat(5) : '';
        }
        if (binary === 'pdftoppm') return '';
        if (fail) throw new Error('OCR interrupted');
        return 'header\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t85\tข้อความภาษาไทยจากภาพสแกน';
    };
    await assert.rejects(extractPdfText(file, { run }), /OCR interrupted/);
    fail = false;
    const result = await extractPdfText(file, { run });
    assert.deepEqual(reads, ['1', '2', '2']);
    assert.equal(result.pages[0].extraction_method, 'embedded');
    assert.equal(result.pages[1].extraction_method, 'ocr');
    assert.equal(result.ocrPages, 1);
    const cached = await extractPdfText(file, { run });
    assert.equal(cached.textHash, result.textHash);
    assert.equal(reads.length, 3);
    await writeFile(file, '%PDF-changed-fixture');
    const changed = await extractPdfText(file, { run });
    assert.notEqual(changed.artifactPath, result.artifactPath);
    assert.equal(reads.length, 5);
});

test('Vertex receives text only and rejects truncated responses', async t => {
    const oldProject = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    t.after(() => { if (oldProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = oldProject; });
    const extraction = { summary: 'สรุป', qualifications: [{ value: 'ทดสอบ', page: 1 }],
        scope_of_work: [], tech_stack: [], flagged_clauses: [], confidence: 0.9, document_language: 'th' };
    let finishReason = 'STOP';
    const dependencies = {
        headers: async () => new Headers({ Authorization: 'Bearer test' }),
        fetchImpl: async (url, options) => {
            const body = JSON.parse(options.body);
            assert.ok(body.systemInstruction.parts[0].text.includes('untrusted'));
            assert.equal(options.headers.authorization, 'Bearer test');
            assert.equal(body.contents[0].parts[0].inlineData, undefined);
            assert.match(body.contents[0].parts[0].text, /page_number/);
            return { ok: true, json: async () => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(extraction) }] } }] }) };
        },
    };
    const result = await extractTorWithVertex({ pages: [{ page_number: 1, text: 'เอกสาร' }] }, dependencies);
    assert.equal(result.extraction.summary, 'สรุป');
    finishReason = 'MAX_TOKENS';
    await assert.rejects(extractTorWithVertex({ pages: [{ page_number: 1, text: 'เอกสาร' }] }, dependencies), /incomplete/);
});

test('Vertex merges multiple chunks, preserves evidence, and totals usage', async t => {
    const old = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
    t.after(() => { if (old === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = old; });
    let calls = 0;
    const result = await extractTorWithVertex({ pages: [{ page_number: 1, text: 'ก'.repeat(25000) }] }, {
        headers: async () => ({}),
        fetchImpl: async () => {
            calls++;
            const extraction = { summary: `chunk ${calls}`, qualifications: [{ value: 'shared', page: 1 }],
                scope_of_work: [{ value: `scope ${calls}`, page: 1 }], tech_stack: [], flagged_clauses: [],
                confidence: calls === 1 ? 0.9 : 0.7, document_language: 'th' };
            return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(extraction) }] } }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 } }) };
        },
    });
    assert.equal(calls, 2);
    assert.equal(result.extraction.summary, 'chunk 1\n\nchunk 2');
    assert.equal(result.extraction.qualifications.length, 1);
    assert.equal(result.extraction.scope_of_work.length, 2);
    assert.equal(result.extraction.confidence, 0.7);
    assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 40 });
});
