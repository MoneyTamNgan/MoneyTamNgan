/** Query-string parsers shared by the public list and analytics endpoints. */

export function parsePositiveInteger(value, fallback, name, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === '') return { value: fallback };
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
        return { error: `${name} must be an integer between 1 and ${max}` };
    }
    return { value: parsed };
}

export function parseNonNegativeNumber(value, name) {
    if (value === null || value === '') return { value: null };
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: `${name} must be a non-negative number` };
    }
    return { value: parsed };
}

export function parseDate(value, name, endOfDay = false) {
    if (!value) return { value: null };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { error: `${name} must be a valid ISO 8601 date` };
    }
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        parsed.setUTCHours(23, 59, 59, 999);
    }
    return { value: parsed };
}


const TOR_STAGES = new Set(['draft', 'official', 'review', 'closed']);
const BIDDING_STATUSES = new Set(['open', 'closed', 'unknown']);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export function parseStage(value) {
    if (value === null || value === '') return { value: null };
    if (!TOR_STAGES.has(value)) return { error: 'stage must be draft, official, review, or closed' };
    return { value };
}

export function parseBiddingStatus(value) {
    if (value === null || value === '') return { value: null };
    if (!BIDDING_STATUSES.has(value)) return { error: 'biddingStatus must be open, closed, or unknown' };
    return { value };
}

export function stageFilter(stage, now = new Date()) {
    if (!stage) return null;
    const thirtyDaysBefore = new Date(now.getTime() - THIRTY_DAYS_MS);
    const thirtyDaysAfter = new Date(now.getTime() + THIRTY_DAYS_MS);
    if (stage === 'draft') {
        return { $or: [{ 'timeline.contract_start': null }, { 'timeline.contract_start': { $exists: false } }] };
    }
    if (stage === 'official') return { 'timeline.contract_start': { $gt: thirtyDaysAfter } };
    if (stage === 'review') return { 'timeline.contract_start': { $gte: thirtyDaysBefore, $lte: thirtyDaysAfter } };
    return { 'timeline.contract_start': { $lt: thirtyDaysBefore } };
}

const THAI_CHARACTERS = /[\u0E00-\u0E7F]/;
const PROJECT_ID_QUERY = /^\d{5,}$/;
const MAX_SEARCH_LENGTH = 200;

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the MongoDB filter fragment for the free-text `q` parameter.
 *
 * - Latin queries use the weighted text index (title, agency, tech stack).
 * - Thai queries and project-id queries cannot use it: MongoDB does not
 *   segment Thai, so $text only matches whole space-delimited words and
 *   misses most real titles. They use an escaped substring/prefix match.
 *
 * @returns {{ filter: object, usesTextIndex: boolean }}
 */
export function buildSearchFilter(rawQuery) {
    const q = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, MAX_SEARCH_LENGTH) : '';
    if (!q) return { filter: {}, usesTextIndex: false };
    if (PROJECT_ID_QUERY.test(q)) {
        return { filter: { project_id: { $regex: `^${q}` } }, usesTextIndex: false };
    }
    if (THAI_CHARACTERS.test(q)) {
        const pattern = { $regex: escapeRegex(q), $options: 'i' };
        return { filter: { $or: [{ project_name: pattern }, { dept_name: pattern }] }, usesTextIndex: false };
    }
    return { filter: { $text: { $search: q } }, usesTextIndex: true };
}
