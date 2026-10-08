import { load } from 'cheerio';
import { resolveProjectFromAggregator } from './egp-aggregator.js';
import { normalizeThaiDigits } from './fiscal-budget.js';
import { classifyProjectMetadata } from './classifier.js';

const CLOSED = /^(?:(?:closed|ended|cancelled|canceled|awarded|completed)(?:$|\s)|สิ้นสุด|ปิดรับ|ยกเลิก|ประกาศผู้ชนะ|ลงนามสัญญา)/i;
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
let nextOfficialCheckAt = 0;

export function currentThaiFiscalYear(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).formatToParts(now);
    const year = Number(parts.find(part => part.type === 'year').value);
    const month = Number(parts.find(part => part.type === 'month').value);
    return String(year + 543 + (month >= 10 ? 1 : 0));
}

/** Only explicit bid submission deadlines, never contract end/announcement dates. */
export function parseBidDeadline(value) {
    if (typeof value !== 'string') return null;
    const text = normalizeThaiDigits(value).trim();
    // Machine-readable timestamps must include a timezone to avoid host-dependent results.
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
        const [year, month, day] = text.slice(0, 10).split('-').map(Number);
        const calendar = new Date(Date.UTC(year, month - 1, day));
        if (year < 2000 || year > 2200 || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
        const date = new Date(text);
        return Number.isFinite(date.getTime()) ? date : null;
    }
    const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(?:เวลา\s*)?(\d{1,2})[:.](\d{2})(?:\s*น\.?)?$/);
    const thai = text.match(/^(\d{1,2})\s+([^\s]+)\s+(?:พ\.?ศ\.?\s*)?(\d{4})\s+(?:เวลา\s*)?(\d{1,2})[:.](\d{2})(?:\s*น\.?)?$/);
    const match = numeric || thai;
    if (!match) return null; // A date without closing time is not proof that bidding remains open.
    const [, day, monthText, yearText, hour, minute] = match;
    const month = numeric ? Number(monthText) : MONTHS.indexOf(monthText) + 1;
    const year = Number(yearText) > 2400 ? Number(yearText) - 543 : Number(yearText);
    if (year < 2000 || year > 2200 || month < 1 || month > 12 || Number(hour) > 23 || Number(minute) > 59) return null;
    const local = new Date(Date.UTC(year, month - 1, Number(day), Number(hour), Number(minute)));
    if (local.getUTCDate() !== Number(day)) return null;
    return new Date(local.getTime() - 7 * 60 * 60 * 1000); // Official Thai deadlines: Asia/Bangkok.
}

export function assessProcurementEligibility(record, { now = new Date(), sourceUrl = null } = {}) {
    const result = (status, reason, deadline = null) => ({ status, reason,
        bid_deadline: deadline, checked_at: now, source_url: sourceUrl });
    const status = String(record.procurement_status || record.project_status || '').trim();
    const hasContract = record.timeline?.contract_start
        || (Array.isArray(record.contract) && record.contract.some(item => item && (item.contract_date || item.contract_id || item.winner_name)));
    if (hasContract || CLOSED.test(status)) return result('closed', hasContract ? 'Contract/award evidence exists' : `Closed procurement status: ${status}`);
    if (/ร่าง|draft/i.test(status)) return result('unknown', 'Draft TOR is not proof of an open bid');
    const deadline = parseBidDeadline(record.bid_submission_end || record.bid_deadline);
    if (!deadline) return result('unknown', 'No unambiguous bid closing timestamp');
    if (deadline <= now) return result('closed', 'Bid submission deadline has passed', deadline);
    const startValue = record.bid_submission_start;
    if (startValue) {
        const start = parseBidDeadline(startValue);
        if (!start) return result('unknown', 'Bid opening timestamp is ambiguous', deadline);
        if (start > now) return result('not_yet_open', 'Bid submission has not opened', deadline);
    }
    return result('open', 'Explicit future bid submission deadline', deadline);
}

/** Read narrowly labelled official fields, not dates from arbitrary TOR clauses or navigation. */
export function parseOfficialEligibilityHtml(html, options = {}) {
    const $ = load(html);
    $('script,style,nav,header,footer').remove();
    $('br').replaceWith('\n');
    $('tr,p,div,li').append('\n');
    const text = $('body').text();
    if (options.projectId && !normalizeThaiDigits(text).includes(String(options.projectId))) {
        return { ...assessProcurementEligibility({}, options), reason: 'Official page did not identify the requested project' };
    }
    if (/verify you are human|just a moment|cf-chl-|challenge-platform/i.test(html)) {
        return assessProcurementEligibility({}, options);
    }
    const deadlines = [...text.matchAll(/(?:วันสิ้นสุดการยื่นข้อเสนอ|วันสิ้นสุดการเสนอราคา|วันที่สิ้นสุดการเสนอราคา|กำหนดยื่นข้อเสนอและเสนอราคา)[ \t]*[:：]?[ \t]*([^\n\r]{1,150})/g)]
        .map(match => match[1].trim());
    const parsed = deadlines.map(parseBidDeadline);
    // Conflicting/repeated historical announcements need explicit revision selection, not guessing.
    const unique = new Set(parsed.filter(Boolean).map(date => date.toISOString()));
    const status = text.match(/สถานะโครงการ[ \t]*[:：][ \t]*([^\n\r]{1,80})/)?.[1]?.trim();
    return assessProcurementEligibility({ procurement_status: status,
        bid_deadline: parsed.length && parsed.every(Boolean) && unique.size === 1 ? [...unique][0] : null }, options);
}

export async function verifyProcurementEligibility(record, { now = new Date(), resolve = resolveProjectFromAggregator, fetchPage = fetch, minDelayMs = 1000,
    renderPage = fetchPage === fetch && process.env.ENABLE_BROWSER_FALLBACK !== 'false'
        ? async (url, id) => (await import('./scraper.js')).readRenderedOfficialHtml(url, id) : null,
} = {}) {
    const metadata = assessProcurementEligibility(record, { now });
    if (metadata.status === 'closed' && metadata.reason !== 'Bid submission deadline has passed') return metadata;
    // Require current official evidence; an old API deadline may have been cancelled or extended.
    let officialUrl;
    let rendered = false;
    try {
        // Per-process spacing; deployments with multiple workers need shared rate limiting.
        const checkAt = Math.max(Date.now(), nextOfficialCheckAt);
        nextOfficialCheckAt = checkAt + Math.max(0, minDelayMs);
        if (checkAt > Date.now()) await new Promise(resolveWait => setTimeout(resolveWait, checkAt - Date.now()));
        const resolved = await resolve(record.project_id);
        const url = new URL(resolved.officialDetailUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'process5.gprocurement.go.th'
            || !url.pathname.startsWith('/egp-agpc01-web/announcement/procurement/')) throw new Error('Unexpected official URL');
        officialUrl = url.href;
        const response = await fetchPage(url.href, { signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store',
            headers: { Accept: 'text/html', 'User-Agent': 'MoneyTamNgan/1.0' } });
        if (!response.ok) throw new Error(`Official page HTTP ${response.status}`);
        if (!(response.headers.get('content-type') || '').includes('text/html')) throw new Error('Official response is not HTML');
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response.body) {
            bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) throw new Error('Official response too large');
            chunks.push(Buffer.from(chunk));
        }
        const parsed = parseOfficialEligibilityHtml(Buffer.concat(chunks).toString('utf8'), { now, sourceUrl: url.href, projectId: record.project_id });
        if (parsed.status !== 'unknown' || !renderPage) return parsed;
        rendered = true;
        return parseOfficialEligibilityHtml(await renderPage(url.href, record.project_id), { now, sourceUrl: url.href, projectId: record.project_id });
    } catch (error) {
        if (officialUrl && renderPage && !rendered) {
            try { return parseOfficialEligibilityHtml(await renderPage(officialUrl, record.project_id),
                { now, sourceUrl: officialUrl, projectId: record.project_id }); }
            catch { /* Preserve unknown; acquisition must not bypass admission. */ }
        }
        return { ...metadata, status: 'unknown', reason: `Official verification unavailable: ${error.message}` };
    }
}

/** Admission check shared by legacy scraping entry points. */
export async function verifySoftwareProcurement(project, keywordSets = {}, verify = verifyProcurementEligibility) {
    if (!project) return { allowed: false, reason: 'Project metadata is required' };
    const isSoftware = project.classification?.status === 'manual_override' ? project.is_software
        : classifyProjectMetadata({ project_name: project.project_name }, keywordSets).isSoftware;
    if (isSoftware !== true) return { allowed: false, reason: 'Software classification is false or unverified' };
    const eligibility = await verify(project);
    return { allowed: eligibility.status === 'open', reason: eligibility.reason, eligibility };
}
