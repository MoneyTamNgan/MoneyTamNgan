import { load } from 'cheerio';

const AGGREGATOR_ORIGIN = 'https://egp-gprocurement.com';
const OFFICIAL_EGP_HOST = 'process5.gprocurement.go.th';
const OFFICIAL_DETAIL_PREFIX = '/egp-agpc01-web/announcement/procurement/';
const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024;

function normalizeProjectId(projectId) {
    const value = String(projectId || '').trim();
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(value)) {
        throw new TypeError('projectId has an invalid format');
    }
    return value;
}

async function responseTextWithLimit(response, maxBytes) {
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) {
        throw new Error(`Aggregator response exceeds the ${maxBytes} byte limit`);
    }
    if (!response.body) return '';

    const chunks = [];
    let received = 0;
    for await (const chunk of response.body) {
        received += chunk.length;
        if (received > maxBytes) {
            throw new Error(`Aggregator response exceeds the ${maxBytes} byte limit`);
        }
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

function officialDetailUrl(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== OFFICIAL_EGP_HOST) return null;
        if (!url.pathname.startsWith(OFFICIAL_DETAIL_PREFIX)) return null;
        return url.href;
    } catch {
        return null;
    }
}

export function parseAggregatorHtml(html, projectId, pageUrl) {
    const normalizedProjectId = normalizeProjectId(projectId);
    const $ = load(String(html || ''));
    const title = $('h1').first().text().trim()
        || $('meta[property="og:title"]').attr('content')?.trim()
        || $('title').text().trim()
        || null;
    const canonical = $('link[rel="canonical"]').attr('href') || pageUrl;
    const canonicalUrl = new URL(canonical, AGGREGATOR_ORIGIN);
    const expectedPath = `/p/${encodeURIComponent(normalizedProjectId)}`;
    if (canonicalUrl.hostname !== 'egp-gprocurement.com'
        || (canonicalUrl.pathname !== expectedPath
            && !canonicalUrl.pathname.startsWith(`${expectedPath}/`))) {
        throw new Error('Aggregator page did not match the requested project ID');
    }

    const officialLinks = [];
    const seen = new Set();
    $('a[href]').each((index, element) => {
        const href = $(element).attr('href');
        const url = officialDetailUrl(href);
        if (!url || seen.has(url)) return;
        seen.add(url);
        officialLinks.push({
            url,
            label: $(element).text().replace(/\s+/g, ' ').trim() || 'Official e-GP detail',
        });
    });

    if (officialLinks.length === 0) {
        throw new Error(`Aggregator returned no official e-GP detail link for ${normalizedProjectId}`);
    }

    return {
        projectId: normalizedProjectId,
        title,
        permalink: `${AGGREGATOR_ORIGIN}/p/${encodeURIComponent(normalizedProjectId)}`,
        pageUrl: canonicalUrl.href,
        officialDetailUrl: officialLinks[0].url,
        officialLinks,
    };
}

/** Resolve a stable project permalink into the encrypted official e-GP detail URL. */
export async function resolveProjectFromAggregator(projectId, options = {}) {
    const normalizedProjectId = normalizeProjectId(projectId);
    const permalink = `${AGGREGATOR_ORIGIN}/p/${encodeURIComponent(normalizedProjectId)}`;
    const response = await fetch(permalink, {
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs || 15000),
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
        },
    });
    if (!response.ok) {
        throw new Error(`Aggregator returned HTTP ${response.status} for ${normalizedProjectId}`);
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'egp-gprocurement.com') {
        throw new Error('Aggregator redirected to an unexpected host');
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
        throw new Error(`Aggregator returned ${contentType || 'an unknown content type'}`);
    }
    const html = await responseTextWithLimit(
        response,
        options.maxHtmlBytes || DEFAULT_MAX_HTML_BYTES
    );
    return parseAggregatorHtml(html, normalizedProjectId, response.url);
}
