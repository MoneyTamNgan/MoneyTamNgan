/**
 * Pipeline adapters for the TOR scraping benchmark.
 *
 * Every adapter downloads into `workDir/<projectId>` and reports only what it
 * did; whether the files are a usable TOR is judged later by `evaluate()` so
 * all pipelines are scored by the same rules.
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    classifyScrapeFailure,
    downloadAttachment,
    launchBrowser,
    scrapeProjectTOR,
} from '../lib/scraper.js';
import { parseSubmissionWindow } from '../lib/egp-announcement.js';

const exec = promisify(execFile);
const PYTHON = process.env.BENCH_PYTHON || 'python3';
const BENCH_DIR = path.dirname(new URL(import.meta.url).pathname);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PROJECT_DEADLINE_MS = Number(process.env.BENCH_PROJECT_DEADLINE_MS) || 240000;

/** Reuse one browser, relaunching it after a crash or a deadline kill. */
async function liveBrowser(ctx) {
    if (!ctx.browser?.connected) {
        await ctx.browser?.close().catch(() => {});
        ctx.browser = await launchBrowser();
    }
    return ctx.browser;
}

/**
 * Run the in-repo scraper with a hard per-project deadline. On timeout the
 * browser is closed so stuck pages and downloads cannot leak into the next
 * project.
 */
async function scrapeWithDeadline(projectId, ctx, projectDir) {
    const browser = await liveBrowser(ctx);
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
            `project exceeded ${PROJECT_DEADLINE_MS / 1000}s benchmark deadline (timeout)`
        )), PROJECT_DEADLINE_MS);
    });
    try {
        const result = await Promise.race([
            scrapeProjectTOR(projectId, browser, { storageDir: path.dirname(projectDir) }),
            deadline,
        ]);
        if (result.error) throw new Error(result.error);
    } catch (error) {
        if (/deadline/.test(error.message)) {
            await browser.close().catch(() => {});
            ctx.browser = null;
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function failure(error) {
    if (!error) return null;
    return { ...classifyScrapeFailure(error), message: String(error.message || error).slice(0, 300) };
}

async function timed(fn) {
    const started = performance.now();
    try {
        return { ...(await fn()), ms: Math.round(performance.now() - started) };
    } catch (error) {
        return { failure: failure(error), ms: Math.round(performance.now() - started) };
    }
}

/** Download a feed link straight to disk; ZIPs are extracted by downloadAttachment. */
async function downloadFeedLink(entry, link, type, projectDir) {
    await downloadAttachment(
        { name: `${entry.projectId}.${type}`, url: link, type },
        { projectId: entry.projectId, storageDir: path.dirname(projectDir) }
    );
    return {};
}

/** P1: Node scraper in lib/scraper.js (aggregator -> Puppeteer -> e-GP JSON APIs). */
export const P1 = {
    name: 'P1 node-scraper',
    usesBrowser: true,
    async teardown(ctx) { await ctx.browser?.close().catch(() => {}); },
    applies: () => true,
    run: (entry, ctx, projectDir) => timed(async () => {
        await scrapeWithDeadline(entry.projectId, ctx, projectDir);
        return {};
    }),
};

/** P2: team Playwright scraper, run once per batch through Python. */
export const P2 = {
    name: 'P2 python-playwright',
    usesBrowser: true,
    batch: true,
    applies: () => true,
    async runBatch(entries, ctx) {
        const batchDir = path.join(ctx.workDir, '_p2');
        await mkdir(batchDir, { recursive: true });
        const idsFile = path.join(batchDir, 'ids.json');
        const outFile = path.join(batchDir, 'out.json');
        await writeFile(idsFile, JSON.stringify(entries.map(e => e.projectId)));
        await exec(PYTHON, [
            path.join(BENCH_DIR, 'egp_scraper.py'),
            '--ids', idsFile, '--work-dir', batchDir, '--out', outFile,
            '--delay-ms', String(ctx.delayMs),
        ], { maxBuffer: 64 * 1024 * 1024, timeout: entries.length * 5 * 60 * 1000 });
        const rows = JSON.parse(await readFile(outFile, 'utf8'));
        return new Map(rows.map(row => [row.project_id, {
            ms: row.ms,
            failure: row.error ? failure(new Error(row.error)) : null,
            files: [...new Set([...(row.extracted_files || []), row.zip_package].filter(Boolean))]
                .map(file => path.resolve(file)),
            selfReported: { status: row.status, schedule: row.submission_schedule || null },
        }]));
    },
};

/** P3: RSS B0 link -> downloadFileTest ZIP over plain HTTP. */
export const P3 = {
    name: 'P3 rss-b0-zip',
    usesBrowser: false,
    applies: entry => Boolean(entry.b0Link),
    run: (entry, ctx, projectDir) => timed(() => downloadFeedLink(entry, entry.b0Link, 'zip', projectDir)),
};

/** P4: RSS D0 link -> invitation PDF (closing date source). */
export const P4 = {
    name: 'P4 rss-d0-announcement',
    usesBrowser: false,
    applies: entry => Boolean(entry.d0Link),
    run: (entry, ctx, projectDir) => timed(() => downloadFeedLink(entry, entry.d0Link, 'pdf', projectDir)),
};

const RETRY_DELAYS_MS = [15000, 60000];
const BREAKER_THRESHOLD = 5;
const BREAKER_PAUSE_MS = 120000;

/**
 * P5: hybrid. Feed links first (no browser), P1 as fallback, retryable
 * failures retried with backoff, and a circuit breaker that pauses the run
 * after consecutive transient failures instead of burning attempts.
 */
export const P5 = {
    name: 'P5 hybrid',
    usesBrowser: true,
    applies: () => true,
    async setup(ctx) { ctx.consecutiveTransient = 0; },
    async teardown(ctx) { await ctx.browser?.close().catch(() => {}); },
    run: (entry, ctx, projectDir) => timed(async () => {
        let lastError = null;
        // The invitation PDF only supplies the closing date; keep going on failure.
        if (entry.d0Link) {
            await downloadFeedLink(entry, entry.d0Link, 'pdf', projectDir)
                .catch(error => { lastError = error; });
        }
        if (entry.b0Link) {
            try {
                await downloadFeedLink(entry, entry.b0Link, 'zip', projectDir);
                return { route: 'feed' };
            } catch (error) {
                lastError = error;
            }
        }

        const fallback = () => scrapeWithDeadline(entry.projectId, ctx, projectDir);

        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
            if (ctx.consecutiveTransient >= BREAKER_THRESHOLD) {
                console.warn(`   ⏸️  circuit open; pausing ${BREAKER_PAUSE_MS / 1000}s`);
                await sleep(BREAKER_PAUSE_MS);
                ctx.consecutiveTransient = 0;
            }
            try {
                await fallback();
                ctx.consecutiveTransient = 0;
                return { route: 'fallback', attempts: attempt + 1 };
            } catch (error) {
                lastError = error;
                const { retryable } = classifyScrapeFailure(error);
                if (!retryable) break;
                ctx.consecutiveTransient += 1;
                if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
            }
        }
        throw lastError || new Error('no route produced a document');
    }),
};

export const PIPELINES = { P1, P2, P3, P4, P5 };

async function walkFiles(directory) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return [];
    }
    const nested = await Promise.all(entries.map(entry => {
        const full = path.join(directory, entry.name);
        return entry.isDirectory() ? walkFiles(full) : [full];
    }));
    return nested.flat();
}

async function pdfTexts(files) {
    if (!files.length) return {};
    const { stdout } = await exec(PYTHON, [path.join(BENCH_DIR, 'pdf_text.py'), ...files], {
        maxBuffer: 256 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
    });
    return JSON.parse(stdout);
}

const MIN_TOR_TEXT_CHARS = 500;
const TOR_NAME = /tor|ขอบเขต|terms?.of.reference/i;
const ANNOUNCEMENT_NAME = /annou|ประกาศ|เชิญชวน/i;

/**
 * Score one project's output with the shared rules:
 *  fetched      - at least one PDF on disk
 *  usefulTor    - a TOR-named PDF was obtained (scanned ones still count;
 *                 production sends them to OCR)
 *  torTextReady - a TOR-named PDF has >= MIN_TOR_TEXT_CHARS of embedded text
 *  closesAt     - submission window parsed from an announcement-like PDF
 */
export async function evaluate(projectDir, extraFiles = []) {
    const files = [...new Set([...(await walkFiles(projectDir)), ...extraFiles])]
        .filter(file => /\.pdf$/i.test(file) && !/\.part-/.test(file));
    const texts = await pdfTexts(files);
    const compactLength = file => (texts[file] || '').replace(/\s/g, '').length;

    const torFiles = files.filter(file => TOR_NAME.test(path.basename(file)));
    const usefulTor = torFiles.length > 0;
    const torTextReady = torFiles.some(file => compactLength(file) >= MIN_TOR_TEXT_CHARS);

    const ordered = [
        ...files.filter(file => ANNOUNCEMENT_NAME.test(path.basename(file))),
        ...files.filter(file => !ANNOUNCEMENT_NAME.test(path.basename(file))),
    ];
    let window = null;
    for (const file of ordered) {
        window = parseSubmissionWindow(texts[file] || '');
        if (window) break;
    }

    return {
        fetched: files.length > 0,
        pdfCount: files.length,
        usefulTor,
        torTextReady,
        closesAt: window?.closesAt || window?.date || null,
    };
}
