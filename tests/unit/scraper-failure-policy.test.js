import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScrapeFailure, safeScrapeMessage } from '../../lib/scrape-failure.js';
const fixtures = [
 ['Cloudflare CAPTCHA', 'anti_bot_blocked', true],
 ['Navigation timeout', 'temporary_timeout', true],
 ['fetch failed ECONNRESET', 'download_failed', true],
 ['Unsupported e-GP document layout', 'unsupported_layout', false],
 ['Aggregator returned no official e-GP detail link', 'resolver_failed', false],
 ['ZIP contained no valid PDF files', 'archive_invalid', false],
 ['Corrupt ZIP central directory', 'archive_invalid', false],
 ['Document is larger than the 250MB limit', 'file_too_large', false],
 ['ZIP exceeds the total PDF extraction limit', 'file_too_large', false],
 ['ZIP contains more than 200 entries', 'file_too_large', false],
 ['PDF is encrypted and unreadable', 'unreadable_pdf', false],
 ['OCR engine crashed', 'text_extraction_failed', true],
];
for (const [message, outcome, retryable] of fixtures) test(`reason policy: ${outcome}: ${message}`, () => {
    assert.deepEqual(classifyScrapeFailure(Error(message)), { outcome, retryable });
});
test('upstream URLs, tokens and personal data never appear in public diagnostics', () => {
    const message = safeScrapeMessage(Error('fetch failed https://host/?token=KEY person@example.com Bearer SECRET'));
    assert.doesNotMatch(message, /https|KEY|SECRET|person@/);
});
test('explicit non-retryable browser result remains terminal after message sanitization', () => {
    assert.deepEqual(classifyScrapeFailure({ outcome: 'resolver_failed', retryable: false, message: 'redacted' }), { outcome: 'resolver_failed', retryable: false });
});

// Exercise the actual bounded archive reader, not only the diagnostic mapper.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { extractPdfsFromZip } from '../../lib/archive-extractor.js';
for (const mode of ['corrupt', 'no_pdf', 'entry_limit', 'pdf_limit', 'total_limit']) test(`real archive rejects ${mode} without a usable TOR`, async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-failure-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const filename = path.join(dir, 'fixture.zip');
    if (mode === 'corrupt') await writeFile(filename, 'PK invalid zip');
    else {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(mode === 'no_pdf' ? 'notes' : '%PDF-1.4 fake content'), mode === 'no_pdf' ? 'notes.txt' : 'tor.pdf');
        zip.addBuffer(Buffer.from('%PDF-1.4 second content'), 'second.pdf');
        // no_pdf must really have no PDFs.
        if (mode === 'no_pdf') {
            const onlyText = new yazl.ZipFile(); onlyText.addBuffer(Buffer.from('notes'), 'notes.txt'); onlyText.end();
            await pipeline(onlyText.outputStream, createWriteStream(filename));
        } else { zip.end(); await pipeline(zip.outputStream, createWriteStream(filename)); }
    }
    const options = { outputDir: path.join(dir, 'out'), ...(mode === 'entry_limit' ? { maxEntries: 1 } : {}),
        ...(mode === 'pdf_limit' ? { maxPdfBytes: 2 } : {}), ...(mode === 'total_limit' ? { maxTotalBytes: 2 } : {}) };
    await assert.rejects(extractPdfsFromZip(filename, options), error => {
        assert.equal(classifyScrapeFailure(error).retryable, false); return true;
    });
});
import ProcessingJob from '../../models/ProcessingJob.js';
import { failJob } from '../../lib/job-queue.js';
test('permanent failure ends job immediately; transient jobs stop at max attempts and release active keys', async t => {
    const writes = []; t.mock.method(ProcessingJob, 'updateOne', async (_, update) => writes.push(update));
    const terminal = Object.assign(Error('https://host/?token=SECRET'), { retryable: false, outcome: 'archive_invalid' });
    assert.equal((await failJob({ _id: 'fixture', attempts: 1, max_attempts: 3 }, terminal)).finalFailure, true);
    assert.equal(writes[0].$set.status, 'failed'); assert.ok(writes[0].$unset.active_key !== undefined);
    assert.equal(writes[0].$set.error_code, 'archive_invalid'); assert.doesNotMatch(writes[0].$set.error, /SECRET/);
    await failJob({ _id: 'fixture', attempts: 1, max_attempts: 3 }, Error('network error'));
    assert.equal(writes[1].$set.status, 'queued'); assert.ok(!writes[1].$unset);
    await failJob({ _id: 'fixture', attempts: 3, max_attempts: 3 }, Error('network error'));
    assert.equal(writes[2].$set.status, 'failed');
});
import { downloadAttachment } from '../../lib/scraper.js';
test('actual download rejects advertised oversize before writing a document', async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response('fixture', { headers: { 'Content-Type': 'application/pdf', 'Content-Length': '1000000' } }));
    await assert.rejects(downloadAttachment({ url: 'https://process5.gprocurement.go.th/fixture.pdf', type: 'pdf' },
        { projectId: '69000000001', maxBytes: 10 }), error => classifyScrapeFailure(error).outcome === 'file_too_large');
});
import { safePipelineMessage } from '../../lib/scrape-failure.js';
test('cloud/storage diagnostics retain safe operator categories without leaking provider detail', () => {
    assert.match(safePipelineMessage(Error('RESOURCE_EXHAUSTED token=SECRET person@example.com')), /capacity/);
    assert.match(safePipelineMessage(Error('PERMISSION_DENIED billing')), /authorization or billing/);
    assert.doesNotMatch(safePipelineMessage(Error('RESOURCE_EXHAUSTED token=SECRET')), /SECRET/);
});
