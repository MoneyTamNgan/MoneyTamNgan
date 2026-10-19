/**
 * e-GP public announcement RSS feed.
 *
 * Each item carries the project ID and a direct document link, so open
 * tenders can be discovered and downloaded without a browser session:
 *   B0 -> draft bidding documents (ZIP via egp-upload-service/downloadFileTest)
 *   D0 -> invitation announcement (PDF via egp-template-service/view-pdf-file)
 */

import * as cheerio from 'cheerio';

const FEED_URL = 'https://process.gprocurement.go.th/EPROCRssFeedWeb/egpannouncerss.xml';
const DEFAULT_TIMEOUT_MS = 45000;

export const ANNOUNCE_TYPE = Object.freeze({
    PLAN: 'P0',
    MEDIAN_PRICE: '15',
    DRAFT_DOCUMENT: 'B0',
    INVITATION: 'D0',
    WINNER: 'W0',
});

/** Opening state implied by the announcement type. */
export const ANNOUNCE_STATUS = Object.freeze({
    B0: 'draft_open',
    D0: 'bidding_open',
});

/**
 * Tender state for the UI: a parsed closing time in the past wins, then the
 * most advanced announcement seen in the feed.
 */
export function tenderStatus({ hasDraft = false, hasInvitation = false, closesAt = null }, now = new Date()) {
    if (closesAt && new Date(closesAt) < now) return 'closed';
    if (hasInvitation) return ANNOUNCE_STATUS.D0;
    if (hasDraft) return ANNOUNCE_STATUS.B0;
    return 'unknown';
}

export function feedUrl(deptId, announceType) {
    const params = new URLSearchParams({ deptId: String(deptId), anounceType: announceType });
    return `${FEED_URL}?${params}`;
}

/** Feed is served as windows-874 (TIS-620 superset). */
export function decodeFeed(buffer) {
    return new TextDecoder('windows-874').decode(buffer);
}

/**
 * @param {string} xml - Decoded RSS document
 * @returns {Array<{projectId: string, title: string, method: string|null,
 *   announceLabel: string|null, link: string, pubDate: string|null}>}
 */
export function parseFeed(xml) {
    const $ = cheerio.load(xml, { xml: true });
    return $('item').toArray().flatMap(element => {
        const item = $(element);
        const description = item.find('description').first().text().trim();
        const [projectId, method = null, ...label] = description.split(',').map(part => part.trim());
        if (!/^\d{11}$/.test(projectId || '')) return [];
        return [{
            projectId,
            title: item.find('title').first().text().trim(),
            method,
            announceLabel: label.join(', ') || null,
            link: item.find('link').first().text().trim(),
            pubDate: item.find('pubDate').first().text().trim() || null,
        }];
    });
}

/**
 * Fetch one department's feed for one announcement type.
 * @param {{deptId: string, type: string, timeoutMs?: number, fetchImpl?: typeof fetch}} options
 */
export async function fetchAnnouncementFeed({
    deptId,
    type,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
}) {
    const response = await fetchImpl(feedUrl(deptId, type), {
        redirect: 'follow',
        headers: { Accept: 'application/rss+xml, text/xml;q=0.9, */*;q=0.5' },
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`e-GP RSS returned HTTP ${response.status}`);
    const xml = decodeFeed(new Uint8Array(await response.arrayBuffer()));
    return parseFeed(xml).map(item => ({ ...item, deptId: String(deptId), announceType: type }));
}

const FEED_DELAY_MS = 4000;
const FEED_BACKOFF_MS = [30000, 90000, 180000];

/**
 * Merge the B0 and D0 feeds of many departments into one entry per project.
 * Requests are sequential and spaced out: parallel or bursty requests made
 * the feed answer HTTP 429 or stop responding during benchmarking.
 *
 * @returns {Promise<Array<{projectId: string, deptId: string, title: string,
 *   method: string|null, draftLink: string|null, invitationLink: string|null,
 *   pubDate: string|null}>>}
 */
export async function collectOpenTenders({
    deptIds,
    delayMs = FEED_DELAY_MS,
    backoffMs = FEED_BACKOFF_MS,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    fetchImpl = fetch,
    maxProjects = Infinity,
    typeFailureLimit = 5,
    onError = () => {},
    onProgress = () => {},
}) {
    const byProject = new Map();
    // A feed type that fails for several departments in a row is down for the
    // run, so stop asking for it.
    const consecutiveFailures = { [ANNOUNCE_TYPE.DRAFT_DOCUMENT]: 0, [ANNOUNCE_TYPE.INVITATION]: 0 };
    let first = true;
    for (const deptId of deptIds) {
        if (byProject.size >= maxProjects) break;
        for (const type of [ANNOUNCE_TYPE.DRAFT_DOCUMENT, ANNOUNCE_TYPE.INVITATION]) {
            if (consecutiveFailures[type] >= typeFailureLimit) continue;
            if (!first) await sleep(delayMs);
            first = false;
            let items = [];
            for (let attempt = 0; ; attempt++) {
                try {
                    items = await fetchAnnouncementFeed({ deptId, type, fetchImpl });
                    consecutiveFailures[type] = 0;
                    break;
                } catch (error) {
                    // Some departments' feeds hang until the timeout every time;
                    // backing off would only add minutes, so fail that one fast.
                    const timedOut = error?.name === 'TimeoutError' || /timeout/i.test(error?.message);
                    if (timedOut || attempt >= backoffMs.length) {
                        consecutiveFailures[type] += 1;
                        onError({ deptId, type, error, disabled: consecutiveFailures[type] >= typeFailureLimit });
                        break;
                    }
                    await sleep(backoffMs[attempt]);
                }
            }
            for (const item of items) {
                const entry = byProject.get(item.projectId) || {
                    projectId: item.projectId,
                    deptId: item.deptId,
                    title: item.title,
                    method: item.method,
                    draftLink: null,
                    invitationLink: null,
                    pubDate: item.pubDate,
                };
                if (type === ANNOUNCE_TYPE.DRAFT_DOCUMENT) entry.draftLink = item.link;
                else entry.invitationLink = item.link;
                if (item.pubDate && (!entry.pubDate || item.pubDate > entry.pubDate)) entry.pubDate = item.pubDate;
                byProject.set(item.projectId, entry);
            }
        }
        onProgress({ deptId, projects: byProject.size });
    }
    return [...byProject.values()];
}
