/**
 * Dual-document acquisition for open tenders (benchmark pipeline P5).
 *
 * The invitation PDF (ประกาศเชิญชวน) from the RSS D0 feed supplies the
 * submission window, agency and reference price. The TOR comes from the RSS
 * B0 draft-document ZIP when one is published, otherwise from the browser
 * scraper. Browser failures are retried with backoff, and a circuit breaker
 * shared across the run pauses after consecutive transient failures so an
 * e-GP outage does not burn every remaining attempt.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
    classifyScrapeFailure,
    downloadAttachment,
    launchBrowser,
    scrapeProjectTOR,
} from './scraper.js';
import { absoluteLocalPath } from './document-storage.js';
import { parseInvitation } from './egp-announcement.js';

const exec = promisify(execFile);
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const RETRY_DELAYS_MS = [15000, 60000];
export const BREAKER_THRESHOLD = 5;
export const BREAKER_PAUSE_MS = 120000;
export const BROWSER_DEADLINE_MS = 240000;

/** Embedded text only; invitations are generated from templates, not scanned. */
export async function readPdfText(localPath) {
    const { stdout } = await exec('pdftotext', ['-enc', 'UTF-8', absoluteLocalPath(localPath), '-'], {
        maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
}

/** Shared per-run state: one browser and the circuit-breaker counter. */
export function createAcquisitionContext(overrides = {}) {
    return {
        browser: null,
        consecutiveTransient: 0,
        retryDelaysMs: RETRY_DELAYS_MS,
        breakerThreshold: BREAKER_THRESHOLD,
        breakerPauseMs: BREAKER_PAUSE_MS,
        browserDeadlineMs: BROWSER_DEADLINE_MS,
        sleep: defaultSleep,
        storageDir: undefined,
        allowBrowser: true,
        ...overrides,
    };
}

export async function closeAcquisitionContext(ctx) {
    await ctx.browser?.close().catch(() => {});
    ctx.browser = null;
}

/** Same shape as scrapeProjectTOR so persistPdfRecords handles both routes. */
function torResultFromDownload(projectId, url, downloaded) {
    return {
        projectId,
        pdf_url: url,
        pdf_path: downloaded.path,
        pdf_size: downloaded.size,
        pdf_content_type: downloaded.contentType,
        archive_path: downloaded.archivePath || null,
        archive_size: downloaded.archiveSize || null,
        archive_content_type: downloaded.archiveContentType || null,
        extracted_pdfs: downloaded.extractedPdfs || [],
        official_detail_url: null,
        resolver_source: 'egp_rss_b0',
        error: null,
    };
}

/** Run the browser scraper with a hard deadline, relaunching after a crash or kill. */
async function scrapeWithDeadline(projectId, ctx, scrape, launch) {
    if (!ctx.browser?.connected) {
        await ctx.browser?.close().catch(() => {});
        ctx.browser = await launch();
    }
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
            `project exceeded ${ctx.browserDeadlineMs / 1000}s scraping deadline (timeout)`
        )), ctx.browserDeadlineMs);
    });
    try {
        const result = await Promise.race([
            scrape(projectId, ctx.browser, { storageDir: ctx.storageDir }),
            deadline,
        ]);
        if (!result.pdf_path) {
            const error = new Error(result.error || 'Browser scraper found no TOR document');
            error.outcome = result.outcome;
            error.retryable = result.retryable;
            throw error;
        }
        return result;
    } catch (error) {
        if (/deadline/.test(error.message)) await closeAcquisitionContext(ctx);
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function browserFallback(projectId, ctx, scrape, launch) {
    let lastError = null;
    for (let attempt = 0; attempt <= ctx.retryDelaysMs.length; attempt++) {
        if (ctx.consecutiveTransient >= ctx.breakerThreshold) {
            await ctx.sleep(ctx.breakerPauseMs);
            ctx.consecutiveTransient = 0;
        }
        try {
            const result = await scrapeWithDeadline(projectId, ctx, scrape, launch);
            ctx.consecutiveTransient = 0;
            return { result, attempts: attempt + 1 };
        } catch (error) {
            lastError = error;
            const retryable = error.retryable ?? classifyScrapeFailure(error).retryable;
            if (!retryable || error.outcome === 'document_not_published') break;
            ctx.consecutiveTransient += 1;
            if (attempt < ctx.retryDelaysMs.length) await ctx.sleep(ctx.retryDelaysMs[attempt]);
        }
    }
    throw lastError;
}

/**
 * Fetch the TOR and the invitation for one open tender.
 *
 * @param {{projectId: string, draftLink?: string|null, invitationLink?: string|null}} tender
 * @returns {Promise<{
 *   tor: object|null, torRoute: 'feed'|'browser'|null, torAttempts: number, torError: string|null,
 *   announcement: {url: string, path: string, size: number, contentType: string,
 *     invitation: ReturnType<typeof parseInvitation>}|null,
 *   announcementError: string|null
 * }>}
 */
export async function acquireTenderDocuments(tender, ctx, {
    download = downloadAttachment,
    scrape = scrapeProjectTOR,
    launch = launchBrowser,
    readText = readPdfText,
} = {}) {
    const { projectId } = tender;
    const target = { projectId, storageDir: ctx.storageDir };
    const outcome = {
        tor: null, torRoute: null, torAttempts: 0, torError: null,
        announcement: null, announcementError: null,
    };

    if (tender.invitationLink) {
        try {
            const file = await download(
                { name: `announcement-${projectId}.pdf`, url: tender.invitationLink, type: 'pdf' },
                target
            );
            const invitation = parseInvitation(await readText(file.path).catch(() => ''));
            outcome.announcement = {
                url: tender.invitationLink,
                path: file.path,
                size: file.size,
                contentType: file.contentType,
                invitation,
            };
        } catch (error) {
            outcome.announcementError = error.message;
        }
    }

    if (tender.draftLink) {
        try {
            const downloaded = await download(
                { name: `draft-${projectId}.zip`, url: tender.draftLink, type: 'zip' },
                target
            );
            outcome.tor = torResultFromDownload(projectId, tender.draftLink, downloaded);
            outcome.torRoute = 'feed';
            outcome.torAttempts = 1;
            return outcome;
        } catch (error) {
            outcome.torError = error.message;
        }
    }

    if (!ctx.allowBrowser) {
        outcome.torError ||= 'No TOR in the feed and the browser fallback is disabled';
        return outcome;
    }
    try {
        const { result, attempts } = await browserFallback(projectId, ctx, scrape, launch);
        outcome.tor = result;
        outcome.torRoute = 'browser';
        outcome.torAttempts = attempts;
        outcome.torError = null;
    } catch (error) {
        outcome.torError = error.message;
    }
    return outcome;
}
