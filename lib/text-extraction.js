import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hashFile } from './document-storage.js';
import { moneyWarnings, financialDisagreement, hasFinancialText } from './ocr-quality.js';

const exec = promisify(execFile);
export const TEXT_VERSION = 'thai-text-v2.1-quality';
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
        raw_text: [...lines.values()].map(words => words.join(' ')).join('\n'),
        // Tesseract TSV often emits Thai glyphs as separate words. Remove
        // synthetic spaces within Thai runs while preserving English spacing.
        text: [...lines.values()].map(words => words.join(' ')
            .replace(/([\u0E00-\u0E7F]) +(?=[\u0E00-\u0E7F])/g, '$1')).join('\n'),
        confidence: confidences.length
            ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0,
    };
}

function configuredInteger(name, fallback, min, max) {
    const value = Number(process.env[name] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return value;
}

/** Keep audit candidates and require source review for OCR financial figures. */
export function chooseOcrCandidate(primary, secondary, embeddedText = '') {
    const candidates = [primary, secondary].filter(Boolean);
    const score = c => moneyWarnings(c.text).length * 10 + (usableText(c.text) ? 0 : 10) - c.confidence;
    const selected = [...candidates].sort((a, b) => score(a) - score(b))[0];
    const warnings = candidates.flatMap(c => moneyWarnings(c.text).map(w => ({ ...w, psm: c.psm })));
    if (secondary && financialDisagreement(primary.text, secondary.text)) warnings.push({ code: 'ocr_amount_disagreement' });
    if (usableText(embeddedText) && financialDisagreement(selected.text, embeddedText)) warnings.push({ code: 'embedded_amount_disagreement' });
    if (candidates.some(c => hasFinancialText(c.text))) warnings.push({ code: 'financial_ocr_requires_review' });
    if (!usableText(selected.text)) warnings.push({ code: 'unreadable_text' });
    if (selected.confidence < 0.65) warnings.push({ code: 'low_confidence' });
    return { ...selected, candidates, warnings, needs_review: warnings.length > 0 };
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
    const config = { version: TEXT_VERSION, engine, tesseract: tesseractVersion.split('\n')[0], forceOcr,
        dpi: configuredInteger('OCR_DPI', 300, 200, 600),
        maxDimension: configuredInteger('OCR_MAX_DIMENSION', 5000, 3500, 10000),
        languages: 'tha+eng', primaryPsm: 3, verificationPsm: 6, retryConfidence: 0.85, reviewConfidence: 0.65,
        renderMode: 'bounded-dpi-v1' };
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
            const embeddedText = text.replace(/\f/g, '').trim();
            page = { page_number: number, text: embeddedText, extraction_method: 'embedded', confidence: null,
                warnings: moneyWarnings(embeddedText) };
            page.needs_review = page.warnings.length > 0;
            if (forceOcr || !usableText(text)) {
                const prefix = path.join(directory, `render-${number}-${randomUUID()}`);
                try {
                    // Poppler -scale-to forces a dimension even for smaller pages;
                    // calculate a bounded DPI instead so normal A4 stays at 300 DPI.
                    const pageInfo = await run('pdfinfo', ['-f', String(number), '-l', String(number), pdf.absolutePath]);
                    const geometry = pageInfo.match(/Page(?:\s+\d+)?\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/i);
                    if (!geometry || !Number(geometry[1]) || !Number(geometry[2])) throw new Error('Cannot determine PDF page dimensions for bounded OCR rendering');
                    const renderDpi = Math.min(config.dpi, config.maxDimension * 72 / Math.max(Number(geometry[1]), Number(geometry[2])));
                    await run('pdftoppm', ['-f', String(number), '-l', String(number), '-singlefile', '-r', String(renderDpi), '-png', pdf.absolutePath, prefix]);
                    const read = async psm => ({ ...parseTsv(await run('tesseract', [`${prefix}.png`, 'stdout', '-l', config.languages, '--psm', String(psm), 'tsv'])), psm });
                    const primary = await read(config.primaryPsm);
                    const secondary = hasFinancialText(primary.text) || primary.confidence < config.retryConfidence || !usableText(primary.text)
                        ? await read(config.verificationPsm) : null;
                    page = { page_number: number, ...chooseOcrCandidate(primary, secondary, embeddedText), extraction_method: 'ocr', render_dpi: renderDpi };
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
        reviewPages: pages.filter(p => p.needs_review || !usableText(p.text)).map(p => ({ page_number: p.page_number,
            codes: [...new Set([...(p.warnings || []).map(w => w.code), ...(!usableText(p.text) ? ['unreadable_text'] : [])])] })),
        needsReview: pages.some(p => p.needs_review || !usableText(p.text) || (p.confidence !== null && p.confidence < config.reviewConfidence)),
        artifactPath };
    await atomicJson(artifactPath, result);
    return result;
}
