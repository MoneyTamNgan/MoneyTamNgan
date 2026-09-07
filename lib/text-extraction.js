import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hashFile } from './document-storage.js';

const exec = promisify(execFile);
export const TEXT_VERSION = 'thai-text-v1';
const digest = value => createHash('sha256').update(value).digest('hex');

export function usableText(text) {
    const compact = text.replace(/\s/g, '');
    const bad = (compact.match(/[\uFFFD\uE000-\uF8FF]/g) || []).length;
    return compact.length >= 40 && bad / compact.length < 0.02
        && (compact.match(/[\p{L}\p{N}]/gu) || []).length / compact.length > 0.5;
}

export function parseTsv(tsv) {
    const lines = new Map();
    const confidences = [];
    for (const line of tsv.split('\n').slice(1)) {
        const cells = line.split('\t');
        if (cells[0] !== '5' || !cells[11]?.trim()) continue;
        const key = cells.slice(1, 5).join(':');
        lines.set(key, [...(lines.get(key) || []), cells.slice(11).join('\t')]);
        const confidence = Number(cells[10]);
        if (confidence >= 0) confidences.push(confidence / 100);
    }
    return {
        // Tesseract TSV often emits Thai glyphs as separate words. Remove
        // synthetic spaces within Thai runs while preserving English spacing.
        text: [...lines.values()].map(words => words.join(' ')
            .replace(/([\u0E00-\u0E7F]) +(?=[\u0E00-\u0E7F])/g, '$1')).join('\n'),
        confidence: confidences.length
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0,
    };
}

async function atomicJson(filename, value) {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
        await rename(temporary, filename);
    } finally {
        await unlink(temporary).catch(() => {});
    }
}

async function command(binary, args) {
    try {
        const result = await exec(binary, args, {
            timeout: 180000, maxBuffer: 16 * 1024 * 1024,
            env: { ...process.env, OMP_THREAD_LIMIT: '1' },
        });
        return args.includes('-v') ? result.stderr || result.stdout : result.stdout;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Missing ${binary}. Install Poppler and Tesseract with tha+eng language data; see README.`);
        }
        throw new Error(`${binary} failed: ${String(error.stderr || error.message).slice(0, 500)}`);
    }
}

/** Disk checkpoints permit page-level OCR retries without repeating completed pages. */
export async function extractPdfText(localPath, { onProgress = async () => {}, forceOcr = false, run = command } = {}) {
    const pdf = await hashFile(localPath);
    const engine = (await run('pdftotext', ['-v'])).split('\n')[0];
    const tesseractVersion = await run('tesseract', ['--version']);
    const languages = await run('tesseract', ['--list-langs']);
    if (!/^tha$/m.test(languages) || !/^eng$/m.test(languages)) {
        throw new Error('Tesseract requires both tha and eng traineddata. See README OCR setup.');
    }
    const config = { version: TEXT_VERSION, engine, tesseract: tesseractVersion.split('\n')[0], forceOcr, dpi: 200, languages: 'tha+eng' };
    const fingerprint = digest(JSON.stringify(config));
    const directory = path.join(path.dirname(pdf.absolutePath), 'text', `${pdf.sha256}-${fingerprint.slice(0, 12)}`);
    await mkdir(directory, { recursive: true });
    const info = await run('pdfinfo', [pdf.absolutePath]);
    const count = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('PDF page count must be between 1 and 1000');
    const pages = [];
    for (let number = 1; number <= count; number++) {
        const checkpoint = path.join(directory, `page-${number}.json`);
        let page;
        try { page = JSON.parse(await readFile(checkpoint, 'utf8')); } catch { /* recreate invalid cache */ }
        if (!page || page.page_number !== number || typeof page.text !== 'string') {
            const text = await run('pdftotext', ['-f', String(number), '-l', String(number), '-layout', '-enc', 'UTF-8', pdf.absolutePath, '-']);
            page = { page_number: number, text: text.replace(/\f/g, '').trim(), extraction_method: 'embedded', confidence: null };
            if (forceOcr || !usableText(text)) {
                const prefix = path.join(directory, `render-${number}-${randomUUID()}`);
                try {
                    await run('pdftoppm', ['-f', String(number), '-l', String(number), '-singlefile', '-scale-to', '3500', '-r', '200', '-png', pdf.absolutePath, prefix]);
                    const ocr = parseTsv(await run('tesseract', [`${prefix}.png`, 'stdout', '-l', 'tha+eng', '--psm', '3', 'tsv']));
                    page = { page_number: number, ...ocr, extraction_method: 'ocr' };
                } finally { await unlink(`${prefix}.png`).catch(() => {}); }
            }
            await atomicJson(checkpoint, page);
        }
        pages.push(page);
        await onProgress({ pagesProcessed: number, pageCount: count, ocrPages: pages.filter(p => p.extraction_method === 'ocr').length });
    }
    const textHash = digest(JSON.stringify(pages));
    const artifactPath = path.join(directory, 'document.json');
    const result = { pages, pageCount: count, textHash, documentHash: pdf.sha256, fingerprint, config,
        ocrPages: pages.filter(p => p.extraction_method === 'ocr').length,
        needsReview: pages.some(p => !usableText(p.text) || (p.confidence !== null && p.confidence < 0.65)),
        artifactPath };
    await atomicJson(artifactPath, result);
    return result;
}
