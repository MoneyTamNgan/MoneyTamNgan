import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import puppeteer from 'puppeteer';
import yazl from 'yazl';
import { extractPdfsFromZip } from '@/lib/archive-extractor';
import { classifyScrapeFailure } from '@/lib/scrape-failure';
import {
    downloadAttachment,
    MIN_DELAY_MS,
    scrapeBatch,
    validateDocumentSignature,
} from '@/lib/scraper';
import { acquireTenderDocuments, createAcquisitionContext } from '@/lib/tender-acquisition';

function mockFetchResponse(body, url, contentType) {
    const response = new Response(body, {
        status: 200,
        headers: { 'Content-Type': contentType },
    });
    Object.defineProperty(response, 'url', { value: url });
    return response;
}

async function createZipBuffer(entries) {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'mtn-sig-zip-'));
    try {
        const zipPath = path.join(tmpDir, 'archive.zip');
        const zip = new yazl.ZipFile();
        for (const entry of entries) {
            zip.addBuffer(Buffer.from(entry.content), entry.name);
        }
        zip.end();
        await pipeline(zip.outputStream, createWriteStream(zipPath));
        return await readFile(zipPath);
    } finally {
        await rm(tmpDir, { recursive: true, force: true });
    }
}

describe('File magic-byte validation (ASVS V5.2.2)', () => {
    const tempDirs = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
    });

    it('accepts a valid PDF starting with %PDF-', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-sig-pdf-'));
        tempDirs.push(dir);
        const pdfPath = path.join(dir, 'tor.pdf');
        await writeFile(pdfPath, '%PDF-1.7\n% valid pdf content');

        const detected = await validateDocumentSignature(pdfPath, 'application/pdf', 'pdf', 'tor.pdf');
        expect(detected).toBe('application/pdf');

        const url = 'https://process5.gprocurement.go.th/tor.pdf';
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            mockFetchResponse('%PDF-1.7\n% remote pdf body', url, 'application/pdf')
        );
        const downloaded = await downloadAttachment(
            { name: 'TOR.pdf', url, type: 'pdf' },
            { projectId: '69000001001', storageDir: dir }
        );
        expect(downloaded.contentType).toBe('application/pdf');
        expect(downloaded.absolutePath.endsWith('.pdf')).toBe(true);
    });

    it('accepts a valid ZIP starting with PK signature and extracts its PDF', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-sig-zip-ok-'));
        tempDirs.push(dir);
        const zipBytes = await createZipBuffer([
            { name: 'TOR-eBidding.pdf', content: '%PDF-1.7\n% inside zip' },
        ]);
        const zipPath = path.join(dir, 'draft.zip');
        await writeFile(zipPath, zipBytes);

        const detected = await validateDocumentSignature(zipPath, 'application/zip', 'zip', 'draft.zip');
        expect(detected).toBe('application/zip');

        const url = 'https://process5.gprocurement.go.th/draft.zip';
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            mockFetchResponse(zipBytes, url, 'application/zip')
        );
        const downloaded = await downloadAttachment(
            { name: 'draft.zip', url, type: 'zip' },
            { projectId: '69000001002', storageDir: dir }
        );
        expect(downloaded.contentType).toBe('application/pdf');
        expect(downloaded.archiveContentType).toBe('application/zip');
        expect(downloaded.extractedPdfs).toHaveLength(1);
    });

    it('rejects a .pdf file that is actually HTML, logs it, and deletes temporary artifacts', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-sig-html-'));
        tempDirs.push(dir);
        const fakePdfPath = path.join(dir, 'fake-tor.pdf');
        const htmlPayload = '<!DOCTYPE html><html><body>Error 403 Forbidden</body></html>';
        await writeFile(fakePdfPath, htmlPayload);

        const warnSpy = vi.spyOn(console, 'warn');

        await expect(
            validateDocumentSignature(fakePdfPath, 'application/pdf', 'pdf', 'fake-tor.pdf')
        ).rejects.toThrow(/does not have a PDF signature/);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[scraper] Rejected downloaded file (Downloaded file does not have a PDF signature): fake-tor.pdf')
        );

        const url = 'https://process5.gprocurement.go.th/disguised.pdf';
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            mockFetchResponse(htmlPayload, url, 'application/octet-stream')
        );

        await expect(
            downloadAttachment(
                { name: 'disguised.pdf', url, type: 'pdf' },
                { projectId: '69000001003', storageDir: dir }
            )
        ).rejects.toThrow(/does not have a PDF signature/);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[scraper] Rejected downloaded file (Downloaded file does not have a PDF signature): disguised.pdf')
        );
        expect(await readdir(path.join(dir, '69000001003'))).toEqual([]);
        expect(classifyScrapeFailure(new Error('Downloaded file does not have a PDF signature'))).toEqual({
            outcome: 'unreadable_pdf',
            retryable: false,
        });
    });

    it('rejects an empty file before passing it to the parser or extractor', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-sig-empty-'));
        tempDirs.push(dir);
        const emptyPdfPath = path.join(dir, 'empty.pdf');
        await writeFile(emptyPdfPath, Buffer.alloc(0));

        const warnSpy = vi.spyOn(console, 'warn');

        await expect(
            validateDocumentSignature(emptyPdfPath, 'application/pdf', 'pdf', 'empty.pdf')
        ).rejects.toThrow(/Downloaded document is empty/);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[scraper] Rejected downloaded file (Downloaded document is empty): empty.pdf')
        );

        await expect(extractPdfsFromZip(emptyPdfPath, { outputDir: path.join(dir, 'out') })).rejects.toThrow(
            /does not have a ZIP signature/
        );
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[archive-extractor] Rejected archive without PK signature: empty.pdf')
        );

        const url = 'https://process5.gprocurement.go.th/empty-remote.pdf';
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            mockFetchResponse(Buffer.alloc(0), url, 'application/pdf')
        );
        await expect(
            downloadAttachment(
                { name: 'empty-remote.pdf', url, type: 'pdf' },
                { projectId: '69000001004', storageDir: dir }
            )
        ).rejects.toThrow(/Downloaded document is empty/);

        expect(await readdir(path.join(dir, '69000001004'))).toEqual([]);
        expect(classifyScrapeFailure(new Error('Downloaded document is empty'))).toEqual({
            outcome: 'unreadable_pdf',
            retryable: false,
        });
    });

    it('continues acquisition and batch runs when one file fails magic-byte validation', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-sig-batch-'));
        tempDirs.push(dir);
        const validZipBytes = await createZipBuffer([
            { name: 'TOR-eBidding.pdf', content: '%PDF-1.7\n% valid tor inside zip' },
        ]);

        const warnSpy = vi.spyOn(console, 'warn');
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
            const target = String(url);
            if (target.includes('bad-html.pdf')) {
                return mockFetchResponse('<html><body>Not a PDF</body></html>', target, 'application/pdf');
            }
            if (target.includes('valid-draft.zip')) {
                return mockFetchResponse(validZipBytes, target, 'application/zip');
            }
            return mockFetchResponse('%PDF-1.7\n% valid second project tor', target, 'application/pdf');
        });

        // Within one tender acquisition, a rejected announcement HTML-as-PDF does not block the draft ZIP
        const tenderOutcome = await acquireTenderDocuments(
            {
                projectId: '69000002000',
                invitationLink: 'https://process5.gprocurement.go.th/bad-html.pdf',
                draftLink: 'https://process5.gprocurement.go.th/valid-draft.zip',
            },
            createAcquisitionContext({ sleep: async () => {}, storageDir: dir, allowBrowser: false }),
            { download: downloadAttachment }
        );
        expect(tenderOutcome.announcement).toBeNull();
        expect(tenderOutcome.announcementError).toBeTruthy();
        expect(tenderOutcome.tor?.pdf_path).toContain('69000002000');

        // Across a batch run, one rejected project does not stop subsequent projects
        vi.spyOn(puppeteer, 'launch').mockRejectedValue(new Error('No browser in unit test'));
        const batch = await scrapeBatch(
            [
                { projectId: '69000002001', pdf_url: 'https://process5.gprocurement.go.th/bad-html.pdf' },
                { projectId: '69000002002', pdf_url: 'https://process5.gprocurement.go.th/good-tor.pdf' },
            ],
            { delayMs: MIN_DELAY_MS, storageDir: dir }
        );

        expect(batch.summary).toEqual({ total: 2, success: 1, failed: 1, skipped: 0 });
        expect(batch.results[0].pdf_path).toBeNull();
        expect(batch.results[1].outcome).toBe('completed');
        expect(batch.results[1].pdf_path).toBeTruthy();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[scraper] Rejected downloaded file (Downloaded file does not have a PDF signature): bad-html.pdf')
        );
    }, 10000);
});
