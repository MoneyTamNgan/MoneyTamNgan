/**
 * TOR PDF Scraper Service
 *
 * Uses an aggregator permalink to resolve an e-GP project ID to the
 * encrypted official detail page, then downloads the official e-Bidding ZIP.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import puppeteer from 'puppeteer';
import { extractPdfsFromZip } from './archive-extractor.js';
import { resolveProjectFromAggregator } from './egp-aggregator.js';
import { validateRemoteDocumentUrl } from './url-safety.js';

/** Current public e-GP announcement search page. */
const EGP_SEARCH_URL = 'https://process5.gprocurement.go.th/egp-agpc01-web/announcement';

/** Rate-limit bounds for batch scraping requests (ms). */
export const MIN_DELAY_MS = 3000;
export const MAX_DELAY_MS = 60000;

/** Default delay can be configured for API and CLI runs through the environment. */
const configuredDelayMs = Number.parseInt(process.env.SCRAPER_DELAY_MS || '', 10);
export const DEFAULT_DELAY_MS = Number.isInteger(configuredDelayMs)
    && configuredDelayMs >= MIN_DELAY_MS
    && configuredDelayMs <= MAX_DELAY_MS
    ? configuredDelayMs
    : 4000;

/** Page navigation timeout (ms) */
const NAV_TIMEOUT = 30000;

/** The legacy host can serve an empty F5 landing document on first load. */
const EMPTY_PAGE_RELOAD_ATTEMPTS = 2;
const DEFAULT_DETAIL_RETRY_ATTEMPTS = 5;

/** Extensions and patterns that indicate downloadable documents */
const DOC_PATTERNS = ['.pdf', '.zip', '.rar', '.doc', '.docx', '.xlsx'];
const DOC_LINK_REGEX = /\.(pdf|zip|rar|doc|docx|xlsx)(?:$|[?#])|\/(?:downloads?|storage|files?)(?:\/|$|[?#])|wp-content\/uploads/i;
const DOC_TEXT_REGEX = /download|attachment|เอกสาร|ดาวน์โหลด|แนบ|tor|ร่าง|ประกวด|จ้าง/i;
const DEFAULT_STORAGE_DIR = path.join(process.cwd(), 'storage', 'tor');
const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const MIME_EXTENSIONS = new Map([
    ['application/pdf', '.pdf'],
    ['application/zip', '.zip'],
    ['application/x-zip-compressed', '.zip'],
    ['application/vnd.rar', '.rar'],
    ['application/x-rar-compressed', '.rar'],
    ['application/msword', '.doc'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
]);

/**
 * Launch a Puppeteer browser instance with server-compatible settings.
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchBrowser() {
    return puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--lang=th-TH',
        ],
    });
}

/**
 * Configure a page with a normal Chrome user agent and Thai language preference.
 * @param {import('puppeteer').Page} page
 */
async function configurePage(page) {
    const browserUserAgent = await page.browser().userAgent();
    await page.setUserAgent(browserUserAgent.replace('HeadlessChrome', 'Chrome'));
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'th,en-US;q=0.9,en;q=0.8',
    });
    await page.emulateTimezone('Asia/Bangkok');
}

/**
 * Sleep for a specified number of milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for actual e-GP content. The first F5 response can be an otherwise
 * empty document that sets a browser-performance cookie; reloading with that
 * cookie lets the application render normally.
 *
 * @param {import('puppeteer').Page} page
 */
async function ensureRenderedPage(page) {
    for (let attempt = 0; attempt <= EMPTY_PAGE_RELOAD_ATTEMPTS; attempt++) {
        await sleep(attempt === 0 ? 3000 : 1500);

        const hasPageContent = await page.evaluate(() => {
            const textLength = document.body?.innerText?.trim().length || 0;
            const interactiveElements = document.querySelectorAll('a, button, form, input').length;
            return textLength >= 50 || interactiveElements > 0;
        });

        if (hasPageContent) return;
        if (attempt === EMPTY_PAGE_RELOAD_ATTEMPTS) break;

        console.log(`   🔄 Reloading empty e-GP page (${attempt + 1}/${EMPTY_PAGE_RELOAD_ATTEMPTS})...`);
        await page.reload({
            waitUntil: 'networkidle2',
            timeout: NAV_TIMEOUT,
        });
    }

    throw new Error('e-GP returned an empty page after the render retries');
}

/**
 * Project IDs begin with the two-digit Buddhist fiscal year (for example,
 * 67 -> 2567). Some plan IDs have a leading letter.
 */
function inferBudgetYear(projectId) {
    const match = projectId.match(/^[A-Za-z]?(\d{2})/);
    return match ? String(2500 + Number(match[1])) : null;
}

/**
 * Submit the public announcement search form and open the matching project.
 * Returns false when the search genuinely has no result.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
async function openProjectDetail(page, projectId) {
    await page.waitForSelector('input[name="keywordSearch"]', { timeout: NAV_TIMEOUT });

    const budgetYear = inferBudgetYear(projectId);
    const currentFiscalYear = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return text.match(/\b25\d{2}\b/)?.[0] || null;
    });

    let keywordSelector = 'input[name="keywordSearch"]';

    // Older projects need the advanced form because the simple form fixes the
    // budget year to the current fiscal year.
    if (budgetYear && currentFiscalYear && budgetYear !== currentFiscalYear) {
        const advancedOpened = await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll('button')).find(element =>
                element.innerText?.includes('ค้นหาขั้นสูง')
            );
            if (!button) return false;
            button.click();
            return true;
        });

        if (advancedOpened) {
            keywordSelector = 'input[name="keywordSearchModel"]';
            await page.waitForFunction(
                selector => {
                    const element = document.querySelector(selector);
                    return element && element.offsetParent !== null;
                },
                { timeout: NAV_TIMEOUT },
                keywordSelector
            );

            const yearSelector = 'ng-select[name="budgetYear"] input';
            await page.click(yearSelector);
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.type(budgetYear);
            await page.keyboard.press('Enter');
        }
    }

    await page.click(keywordSelector, { clickCount: 3 });
    await page.keyboard.type(projectId);

    const responsePromise = page.waitForResponse(
        response => response.request().method() === 'GET'
            && response.url().includes('/pb/a-egp-allt-project/announcement?'),
        { timeout: NAV_TIMEOUT }
    );

    const searchSubmitted = await page.evaluate(selector => {
        const input = document.querySelector(selector);
        if (!input) return false;

        const scope = input.closest('.collapse.show')
            || input.closest('form')
            || input.parentElement?.parentElement?.parentElement
            || document;
        const buttons = Array.from(scope.querySelectorAll('button'));
        const searchButton = buttons.find(element =>
            element.offsetParent !== null && element.innerText?.trim() === 'ค้นหา'
        );
        if (!searchButton) return false;
        searchButton.click();
        return true;
    }, keywordSelector);

    if (!searchSubmitted) {
        throw new Error('Could not find the e-GP search button');
    }

    let searchResponse;
    try {
        searchResponse = await responsePromise;
    } catch {
        throw new Error(
            'e-GP search returned no response; its anti-bot challenge may have blocked this browser session'
        );
    }
    const searchResponseText = await searchResponse.text().catch(() => '');
    let searchPayload = null;
    try {
        searchPayload = JSON.parse(searchResponseText);
    } catch {
        // The rendered page check below also detects HTML anti-bot responses.
    }

    if (searchPayload?.validateCfTurnTile === false) {
        throw new Error(
            'e-GP Cloudflare verification rejected the browser session; retry later or use an interactive browser environment'
        );
    }

    await sleep(2000);

    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    if (/Cloudflare\s*:\s*ไม่ผ่าน|captcha|access denied/i.test(bodyText)) {
        throw new Error(
            'e-GP anti-bot verification rejected the browser session; retry later or use an interactive browser environment'
        );
    }

    const resultCount = Number(
        bodyText.match(/จำนวนโครงการที่พบ\s*:\s*([\d,]+)/)?.[1]?.replaceAll(',', '') || 0
    );
    if (resultCount === 0) return false;

    const detailTagged = await page.evaluate(expectedProjectId => {
        const rows = Array.from(document.querySelectorAll('tbody tr'));
        const row = rows.find(item => item.innerText?.includes(expectedProjectId))
            || rows.find(item => item.innerText?.trim());
        if (!row) return false;

        const controls = Array.from(row.querySelectorAll('a, button'))
            .filter(element => element.offsetParent !== null);
        const detailControl = controls.at(-1);
        if (!detailControl) return false;

        detailControl.setAttribute('data-scraper-project-detail', 'true');
        return true;
    }, projectId);

    if (!detailTagged) {
        throw new Error('e-GP returned a project but no detail control was found');
    }

    await page.click('[data-scraper-project-detail="true"]');
    await page.waitForFunction(
        () => window.location.pathname.includes('/announcement/procurement/'),
        { timeout: NAV_TIMEOUT }
    );
    await sleep(2000);
    return true;
}

function configuredDetailRetryAttempts() {
    const value = Number(process.env.EGP_DETAIL_RETRY_ATTEMPTS || DEFAULT_DETAIL_RETRY_ATTEMPTS);
    return Number.isInteger(value) && value >= 1 && value <= 10
        ? value
        : DEFAULT_DETAIL_RETRY_ATTEMPTS;
}

function legacySearchEnabled() {
    return String(process.env.ENABLE_LEGACY_EGP_SEARCH_FALLBACK || 'false').toLowerCase() === 'true';
}

async function openAggregatorProjectDetail(page, projectId) {
    const aggregator = await resolveProjectFromAggregator(projectId);
    await page.goto(aggregator.officialDetailUrl, {
        waitUntil: 'networkidle2',
        timeout: 70000,
        referer: aggregator.pageUrl,
    });
    await ensureRenderedPage(page);
    await page.waitForFunction(
        expectedProjectId => (document.body?.innerText || '').includes(expectedProjectId),
        { timeout: NAV_TIMEOUT },
        projectId
    );
    return aggregator;
}

async function findEbindingRowIndex(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('tbody tr'))
        .findIndex(row => /ร่างเอกสารประกวดราคา\s*\(e-?bidding\)/i.test(row.innerText || '')));
}

async function downloadEbindingZip(page, projectId, storageDir) {
    const attempts = configuredDetailRetryAttempts();
    for (let attempt = 1; attempt <= attempts; attempt++) {
        const rowIndex = await findEbindingRowIndex(page);
        if (rowIndex >= 0) {
            const zipListResponse = page.waitForResponse(
                response => response.ok() && response.url().includes('/getTorZipList?'),
                { timeout: NAV_TIMEOUT }
            );
            const clicked = await page.evaluate(index => {
                const row = document.querySelectorAll('tbody tr')[index];
                const control = row?.querySelector('a.btn, button');
                if (!control) return false;
                control.click();
                return true;
            }, rowIndex);
            if (!clicked) throw new Error('e-GP e-Bidding row had no detail control');
            await zipListResponse.catch(() => null);

            await page.waitForFunction(
                () => Array.from(document.querySelectorAll('.modal-content'))
                    .some(modal => modal.offsetParent !== null && /\.zip\b/i.test(modal.innerText || '')),
                { timeout: NAV_TIMEOUT }
            );
            const archiveName = await page.evaluate(() => {
                const modal = Array.from(document.querySelectorAll('.modal-content'))
                    .find(element => element.offsetParent !== null && /\.zip\b/i.test(element.innerText || ''));
                return modal?.innerText?.match(/([^\s]+\.zip)\b/i)?.[1] || 'e-bidding.zip';
            });

            const downloadResponsePromise = page.waitForResponse(
                response => response.ok()
                    && response.url().includes('/downloadFileTest?fileId=')
                    && (response.headers()['content-type'] || '').toLowerCase().includes('zip'),
                { timeout: 60000 }
            );
            const downloadClicked = await page.evaluate(() => {
                const modal = Array.from(document.querySelectorAll('.modal-content'))
                    .find(element => element.offsetParent !== null && /\.zip\b/i.test(element.innerText || ''));
                const control = modal?.querySelector('tbody tr a.btn, tbody tr button');
                if (!control) return false;
                control.click();
                return true;
            });
            if (!downloadClicked) throw new Error('e-GP ZIP modal had no download control');
            const downloadResponse = await downloadResponsePromise;
            const attachment = {
                name: archiveName,
                url: downloadResponse.url(),
                type: 'zip',
            };
            const downloaded = await downloadAttachment(attachment, {
                page,
                projectId,
                storageDir,
            });
            return { attachment, downloaded };
        }

        if (attempt < attempts) {
            console.log(`   🔄 Retrying intermittent e-GP document list (${attempt}/${attempts})...`);
            await sleep(2000);
            await page.reload({ waitUntil: 'networkidle2', timeout: 70000 });
            await ensureRenderedPage(page);
        }
    }
    return null;
}

function applyDownloadedFile(result, attachment, downloadedFile) {
    result.pdf_url = attachment.url;
    result.pdf_path = downloadedFile.path;
    result.pdf_size = downloadedFile.size;
    result.pdf_content_type = downloadedFile.contentType;
    result.archive_path = downloadedFile.archivePath || null;
    result.archive_size = downloadedFile.archiveSize || null;
    result.archive_content_type = downloadedFile.archiveContentType || null;
    result.extracted_pdfs = downloadedFile.extractedPdfs || [];
    attachment.local_path = downloadedFile.path;
}

/**
 * Validate a caller-supplied delay without allowing the scraper rate limit to
 * be accidentally disabled.
 *
 * @param {unknown} delayMs
 * @returns {number}
 */
export function normalizeDelayMs(delayMs = DEFAULT_DELAY_MS) {
    const value = typeof delayMs === 'string' && delayMs.trim() !== ''
        ? Number(delayMs)
        : delayMs;

    if (!Number.isInteger(value) || value < MIN_DELAY_MS || value > MAX_DELAY_MS) {
        throw new RangeError(
            `delayMs must be an integer between ${MIN_DELAY_MS} and ${MAX_DELAY_MS}`
        );
    }

    return value;
}

function sanitizePathPart(value, fallback) {
    const sanitized = String(value || '')
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_')
        .replace(/^\.+/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return sanitized || fallback;
}

function filenameFromContentDisposition(headerValue) {
    if (!headerValue) return null;

    const encodedMatch = headerValue.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (encodedMatch) {
        try {
            return decodeURIComponent(encodedMatch[1].replace(/^"|"$/g, ''));
        } catch {
            return encodedMatch[1];
        }
    }

    return headerValue.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
        || headerValue.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()
        || null;
}

function storagePathForDatabase(absolutePath) {
    const relativePath = path.relative(process.cwd(), absolutePath);
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return relativePath.split(path.sep).join('/');
    }
    return absolutePath;
}

function configuredMaxDownloadBytes() {
    const configuredMb = Number(process.env.TOR_MAX_FILE_SIZE_MB || 100);
    return Number.isFinite(configuredMb) && configuredMb > 0
        ? configuredMb * 1024 * 1024
        : DEFAULT_MAX_DOWNLOAD_BYTES;
}

async function materializeDownloadedFile({
    finalPath,
    size,
    contentType,
    sourceUrl,
    reused,
    attachmentType,
}) {
    const archiveIsZip = ['application/zip', 'application/x-zip-compressed'].includes(contentType)
        || attachmentType === 'zip';
    if (!archiveIsZip) {
        return {
            path: storagePathForDatabase(finalPath),
            absolutePath: finalPath,
            size,
            contentType,
            sourceUrl,
            reused,
        };
    }

    const extraction = await extractPdfsFromZip(finalPath, {
        outputDir: path.join(path.dirname(finalPath), 'extracted'),
    });
    return {
        path: storagePathForDatabase(extraction.primary.absolutePath),
        absolutePath: extraction.primary.absolutePath,
        size: extraction.primary.size,
        contentType: 'application/pdf',
        sourceUrl,
        reused: reused && extraction.primary.reused,
        archivePath: storagePathForDatabase(finalPath),
        archiveAbsolutePath: finalPath,
        archiveSize: size,
        archiveContentType: contentType,
        extractedPdfs: extraction.pdfs.map(pdf => ({
            entryName: pdf.entryName,
            filename: pdf.filename,
            path: storagePathForDatabase(pdf.absolutePath),
            size: pdf.size,
        })),
        rejectedArchiveEntries: extraction.rejected,
    };
}

async function fetchDocument(url, headers, signal, redirectsLeft = 5) {
    const safeUrl = validateRemoteDocumentUrl(url);
    const response = await fetch(safeUrl, { headers, redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirectsLeft <= 0) throw new Error('Document download exceeded the redirect limit');

    const location = response.headers.get('location');
    if (!location) throw new Error('Document redirect did not include a location');
    const nextUrl = validateRemoteDocumentUrl(new URL(location, safeUrl).href);
    const nextHeaders = { ...headers };
    if (new URL(nextUrl).origin !== new URL(safeUrl).origin) {
        delete nextHeaders.Cookie;
        delete nextHeaders.Authorization;
        delete nextHeaders.Referer;
    }
    return fetchDocument(nextUrl, nextHeaders, signal, redirectsLeft - 1);
}

async function validateDocumentSignature(filePath, declaredType, hintedType) {
    const handle = await open(filePath, 'r');
    const header = Buffer.alloc(8);
    try {
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (bytesRead === 0) throw new Error('Downloaded document is empty');
    } finally {
        await handle.close();
    }

    const isPdf = header.subarray(0, 5).toString() === '%PDF-';
    const isZip = header[0] === 0x50 && header[1] === 0x4b
        && [[0x03, 0x04], [0x05, 0x06], [0x07, 0x08]]
            .some(([a, b]) => header[2] === a && header[3] === b);
    const isRar = header.subarray(0, 7).toString('hex') === '526172211a0700'
        || header.subarray(0, 8).toString('hex') === '526172211a070100';
    const isOle = header.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1';
    const expected = String(declaredType || hintedType || '').toLowerCase();

    if (expected === 'application/pdf' || hintedType === 'pdf') {
        if (!isPdf) throw new Error('Downloaded file does not have a PDF signature');
        return 'application/pdf';
    }
    if (expected.includes('zip') || ['zip', 'docx', 'xlsx'].includes(hintedType)) {
        if (!isZip) throw new Error('Downloaded file does not have a ZIP signature');
        return expected || 'application/zip';
    }
    if (expected.includes('rar') || hintedType === 'rar') {
        if (!isRar) throw new Error('Downloaded file does not have a RAR signature');
        return expected || 'application/vnd.rar';
    }
    if (expected === 'application/msword' || hintedType === 'doc') {
        if (!isOle) throw new Error('Downloaded file does not have a DOC signature');
        return 'application/msword';
    }
    if (isPdf) return 'application/pdf';
    if (isZip) return 'application/zip';
    if (isRar) return 'application/vnd.rar';
    if (isOle) return 'application/msword';
    throw new Error('Downloaded file has an unsupported signature');
}

/**
 * Download one attachment to durable local storage. Browser cookies and the
 * detail-page referrer are forwarded for session-protected document links.
 *
 * @param {{name?: string, url: string, type?: string}} attachment
 * @param {Object} options
 * @param {string} options.projectId
 * @param {import('puppeteer').Page|null} [options.page]
 * @param {string} [options.storageDir]
 * @param {number} [options.maxBytes]
 */
export async function downloadAttachment(attachment, options) {
    const {
        projectId,
        page = null,
        storageDir = process.env.TOR_STORAGE_DIR || DEFAULT_STORAGE_DIR,
        maxBytes = configuredMaxDownloadBytes(),
    } = options;

    if (!projectId) throw new TypeError('projectId is required for downloads');
    if (!attachment?.url) throw new TypeError('attachment.url is required');
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
        throw new RangeError('maxBytes must be a positive number');
    }

    const requestedUrl = new URL(validateRemoteDocumentUrl(attachment.url));

    const headers = {
        Accept: 'application/pdf, application/zip, application/octet-stream;q=0.9, */*;q=0.5',
        'Accept-Language': 'th,en-US;q=0.9,en;q=0.8',
    };

    if (page) {
        const cookies = await page.cookies(attachment.url);
        if (cookies.length > 0) {
            headers.Cookie = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
        }
        headers.Referer = page.url();
        headers['User-Agent'] = await page.evaluate(() => navigator.userAgent);
    }

    const response = await fetchDocument(
        requestedUrl.href,
        headers,
        AbortSignal.timeout(60000)
    );

    if (!response.ok || !response.body) {
        throw new Error(`Document download returned HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) {
        throw new Error(`Document is larger than the ${Math.floor(maxBytes / 1024 / 1024)}MB limit`);
    }

    let contentType = (response.headers.get('content-type') || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
    if (contentType === 'text/html' || contentType === 'application/json') {
        throw new Error(`Document URL returned ${contentType} instead of a file`);
    }
    const isGenericDownload = [
        '',
        'application/octet-stream',
        'binary/octet-stream',
        'application/download',
        'application/x-download',
        'application/force-download',
    ].includes(contentType);
    if (!MIME_EXTENSIONS.has(contentType) && !isGenericDownload) {
        throw new Error(`Unsupported document content type: ${contentType}`);
    }

    const responseUrl = new URL(response.url);
    const dispositionName = filenameFromContentDisposition(
        response.headers.get('content-disposition')
    );
    let urlName = path.basename(responseUrl.pathname);
    try {
        urlName = decodeURIComponent(urlName);
    } catch {
        // Keep the encoded URL basename when it contains malformed escapes.
    }
    let filename = sanitizePathPart(
        dispositionName || urlName || attachment.name,
        `tor-${projectId}`
    );

    if (!path.extname(filename)) {
        filename += MIME_EXTENSIONS.get(contentType)
            || (attachment.type && attachment.type !== 'unknown' ? `.${attachment.type}` : '.bin');
    }

    const projectDirectory = path.resolve(
        storageDir,
        sanitizePathPart(projectId, 'unknown-project')
    );
    await mkdir(projectDirectory, { recursive: true });

    const finalPath = path.join(/* turbopackIgnore: true */ projectDirectory, filename);
    try {
        const existingFile = await stat(finalPath);
        if (existingFile.isFile() && existingFile.size > 0) {
            contentType = await validateDocumentSignature(finalPath, contentType, attachment.type);
            return materializeDownloadedFile({
                finalPath,
                size: existingFile.size,
                contentType,
                sourceUrl: attachment.url,
                reused: true,
                attachmentType: attachment.type,
            });
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const temporaryPath = `${finalPath}.part-${process.pid}-${randomUUID()}`;
    let downloadedBytes = 0;
    const sizeLimiter = new Transform({
        transform(chunk, encoding, callback) {
            downloadedBytes += chunk.length;
            if (downloadedBytes > maxBytes) {
                callback(new Error(
                    `Document exceeded the ${Math.floor(maxBytes / 1024 / 1024)}MB limit while downloading`
                ));
                return;
            }
            callback(null, chunk);
        },
    });

    try {
        await pipeline(
            Readable.fromWeb(response.body),
            sizeLimiter,
            createWriteStream(temporaryPath, { flags: 'wx' })
        );
        contentType = await validateDocumentSignature(temporaryPath, contentType, attachment.type);
        await rename(temporaryPath, finalPath);
    } catch (error) {
        await unlink(temporaryPath).catch(() => {});
        throw error;
    }

    return materializeDownloadedFile({
        finalPath,
        size: downloadedBytes,
        contentType,
        sourceUrl: attachment.url,
        reused: false,
        attachmentType: attachment.type,
    });
}

/**
 * Extract all document links (PDF, ZIP, etc.) from the current page.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array<{ name: string, url: string, type: string }>>}
 */
async function extractDocumentLinks(page) {
    return page.evaluate((docPatterns, docLinkRegexStr, docTextRegexStr) => {
        const docLinkRegex = new RegExp(docLinkRegexStr, 'i');
        const docTextRegex = new RegExp(docTextRegexStr, 'i');

        const links = Array.from(document.querySelectorAll('a[href]'));
        const results = [];

        for (const a of links) {
            const rawHref = a.getAttribute('href') || '';
            const text = a.innerText?.trim() || '';
            const title = a.title?.trim() || '';
            const label = text || title || 'Document';

            let href;
            try {
                const parsed = new URL(rawHref, document.baseURI);
                if (!['http:', 'https:'].includes(parsed.protocol)) continue;
                href = parsed.href;
            } catch {
                continue;
            }

            const hrefMatch = docLinkRegex.test(href);
            const textMatch = docTextRegex.test(text) || docTextRegex.test(title);

            if (hrefMatch || (textMatch && href.length > 10)) {
                // Determine file type from URL
                let type = 'unknown';
                for (const ext of docPatterns) {
                    if (href.toLowerCase().includes(ext)) {
                        type = ext.replace('.', '');
                        break;
                    }
                }

                results.push({
                    name: label.substring(0, 200),
                    url: href,
                    type,
                });
            }
        }

        // Deduplicate by URL
        const seen = new Set();
        return results.filter(r => {
            if (seen.has(r.url)) return false;
            seen.add(r.url);
            return true;
        });
    }, DOC_PATTERNS, DOC_LINK_REGEX.source, DOC_TEXT_REGEX.source);
}

/**
 * Scrape the e-GP website for TOR PDF/ZIP links for a single project.
 *
 * Strategy:
 * 1. Resolve the project ID through the aggregator permalink
 * 2. Open the encrypted official e-GP project detail page directly
 * 3. Download the official draft e-Bidding ZIP and extract its PDFs
 * 4. Fall back to visible official document links when no ZIP row exists
 * 5. Optionally use the legacy e-GP search UI when explicitly enabled
 *
 * @param {string} projectId - The e-GP project ID
 * @param {import('puppeteer').Browser} [existingBrowser] - Optional shared browser instance
 * @param {Object} [options]
 * @param {string} [options.storageDir] - Local TOR storage root
 * @param {string} [options.knownPdfUrl] - Existing URL to download before scraping again
 * @returns {Promise<{ projectId: string, pdf_url: string|null, pdf_path: string|null, source_url: string, attachments: Array, error?: string }>}
 */
export async function scrapeProjectTOR(projectId, existingBrowser = null, options = {}) {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
        throw new TypeError('projectId is required');
    }

    const ownBrowser = !existingBrowser;
    let browser = existingBrowser;
    let page = null;

    const result = {
        projectId: normalizedProjectId,
        pdf_url: null,
        pdf_path: null,
        pdf_size: null,
        pdf_content_type: null,
        archive_path: null,
        archive_size: null,
        archive_content_type: null,
        extracted_pdfs: [],
        aggregator_url: null,
        official_detail_url: null,
        resolver_source: 'egp_aggregator',
        source_url: '',
        attachments: [],
        error: null,
    };

    try {
        if (options.knownPdfUrl) {
            result.pdf_url = options.knownPdfUrl;
            const knownAttachment = {
                name: `TOR ${normalizedProjectId}`,
                url: options.knownPdfUrl,
                type: DOC_LINK_REGEX.exec(options.knownPdfUrl)?.[1]?.toLowerCase() || 'unknown',
            };

            try {
                const downloadedFile = await downloadAttachment(knownAttachment, {
                    projectId: normalizedProjectId,
                    storageDir: options.storageDir,
                });
                result.pdf_url = options.knownPdfUrl;
                result.pdf_path = downloadedFile.path;
                result.pdf_size = downloadedFile.size;
                result.pdf_content_type = downloadedFile.contentType;
                result.archive_path = downloadedFile.archivePath || null;
                result.archive_size = downloadedFile.archiveSize || null;
                result.archive_content_type = downloadedFile.archiveContentType || null;
                result.extracted_pdfs = downloadedFile.extractedPdfs || [];
                result.source_url = options.knownPdfUrl;
                result.resolver_source = 'known_url';
                knownAttachment.local_path = downloadedFile.path;
                result.attachments = [knownAttachment];
                console.log(`   ✅ Stored existing TOR URL at ${downloadedFile.path}`);
                return result;
            } catch (error) {
                knownAttachment.download_error = error.message;
                console.warn(`   ⚠️  Existing TOR URL failed; searching again: ${error.message}`);
            }
        }

        if (ownBrowser) {
            browser = await launchBrowser();
        }

        page = await browser.newPage();
        await configurePage(page);

        console.log(`   🔍 Resolving project ${normalizedProjectId} through the aggregator...`);

        try {
            const aggregator = await openAggregatorProjectDetail(page, normalizedProjectId);
            result.aggregator_url = aggregator.permalink;
            result.official_detail_url = aggregator.officialDetailUrl;
            result.source_url = aggregator.officialDetailUrl;
        } catch (aggregatorError) {
            if (!legacySearchEnabled()) throw aggregatorError;

            console.warn(`   ⚠️  Aggregator resolution failed; trying legacy search: ${aggregatorError.message}`);
            result.resolver_source = 'egp_browser_legacy';
            result.source_url = EGP_SEARCH_URL;
            await page.goto(EGP_SEARCH_URL, {
                waitUntil: 'networkidle2',
                timeout: 70000,
                referer: 'https://www.gprocurement.go.th/',
            });
            await ensureRenderedPage(page);
            const foundProject = await openProjectDetail(page, normalizedProjectId);
            if (!foundProject) {
                console.log(`   ⚠️  Project ${normalizedProjectId} was not found in e-GP`);
                result.source_url = page.url();
                return result;
            }
            result.official_detail_url = page.url();
        }

        console.log(`   📄 Navigated to detail page for ${normalizedProjectId}`);

        // The related-document endpoint is intermittently unavailable. This
        // helper reloads the official detail page before giving up.
        const ebiddingZip = await downloadEbindingZip(
            page,
            normalizedProjectId,
            options.storageDir
        );
        if (ebiddingZip) {
            result.attachments = [ebiddingZip.attachment];
            applyDownloadedFile(result, ebiddingZip.attachment, ebiddingZip.downloaded);
            console.log(`   ✅ Stored official e-Bidding ZIP and selected PDF at ${result.pdf_path}`);
            return result;
        }

        // Extract all document links from the current page
        const attachments = await extractDocumentLinks(page);
        result.attachments = attachments;

        // Pick and download the best document (prefer PDF, then ZIP). False
        // positive links are skipped when their response is not a document.
        if (attachments.length > 0) {
            const candidates = [...attachments].sort((a, b) => {
                const priority = { pdf: 0, zip: 1, unknown: 2 };
                return (priority[a.type] ?? 3) - (priority[b.type] ?? 3);
            });
            // Preserve the best discovered link even if every file download
            // later fails. This lets a future retry download it directly.
            result.pdf_url = candidates[0].url;

            let primaryAttachment = null;
            let downloadedFile = null;
            const downloadErrors = [];
            for (const candidate of candidates) {
                try {
                    downloadedFile = await downloadAttachment(candidate, {
                        page,
                        projectId: normalizedProjectId,
                        storageDir: options.storageDir,
                    });
                    primaryAttachment = candidate;
                    break;
                } catch (error) {
                    candidate.download_error = error.message;
                    downloadErrors.push(`${candidate.url}: ${error.message}`);
                }
            }

            if (!downloadedFile || !primaryAttachment) {
                throw new Error(`No document link could be downloaded: ${downloadErrors.join('; ')}`);
            }

            applyDownloadedFile(result, primaryAttachment, downloadedFile);
            console.log(`   ✅ Stored TOR file at ${downloadedFile.path}`);
        } else {
            console.log(`   ⚠️  No documents found for ${normalizedProjectId}`);
        }

        // Update source_url to the final page URL (might have changed after navigation)
        result.source_url = page.url();

    } catch (error) {
        result.error = error.message;
        console.error(`   ❌ Error scraping ${normalizedProjectId}: ${error.message}`);
    } finally {
        if (page) await page.close().catch(() => {});
        if (ownBrowser && browser) await browser.close().catch(() => {});
    }

    return result;
}

/**
 * Scrape TOR documents for a batch of projects with rate limiting.
 *
 * @param {Array<string|{projectId: string, pdf_url?: string}>} projects - Projects to download/scrape
 * @param {Object} [options]
 * @param {number} [options.delayMs=4000] - Delay between requests in ms
 * @param {Function} [options.onProgress] - Callback(index, total, result)
 * @param {string} [options.storageDir] - Local TOR storage root
 * @returns {Promise<{ results: Array, summary: { total: number, success: number, failed: number, skipped: number } }>}
 */
export async function scrapeBatch(projects, options = {}) {
    const { delayMs = DEFAULT_DELAY_MS, onProgress, storageDir } = options;
    const rateLimitDelayMs = normalizeDelayMs(delayMs);
    const results = [];
    let success = 0;
    let failed = 0;
    let skipped = 0;

    // Launch Chromium lazily. URL-only migration records can often be
    // downloaded directly without opening a browser at all.
    let browser = null;

    try {
        for (let i = 0; i < projects.length; i++) {
            const project = projects[i];
            const projectId = typeof project === 'string' ? project : project.projectId;
            const knownPdfUrl = typeof project === 'string' ? null : project.pdf_url;

            let result;
            if (knownPdfUrl) {
                result = await scrapeProjectTOR(projectId, null, {
                    storageDir,
                    knownPdfUrl,
                });
            } else {
                browser ||= await launchBrowser();
                result = await scrapeProjectTOR(projectId, browser, { storageDir });
            }
            results.push(result);

            if (result.error) {
                failed++;
            } else if (result.pdf_path) {
                success++;
            } else {
                skipped++;
            }

            if (onProgress) {
                onProgress(i + 1, projects.length, result);
            }

            // Rate limiting — wait between requests (except after the last one)
            if (i < projects.length - 1) {
                await sleep(rateLimitDelayMs);
            }
        }
    } finally {
        if (browser) await browser.close().catch(() => {});
    }

    return {
        results,
        summary: {
            total: projects.length,
            success,
            failed,
            skipped,
        },
    };
}
