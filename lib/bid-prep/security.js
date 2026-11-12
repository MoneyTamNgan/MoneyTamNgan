import { NextResponse } from 'next/server';
import { clientAddress, createRateLimiter, rateLimitHeaders } from '../rate-limit.js';
import { requestPrincipal } from '../request-authorization.js';
import { withRouteSecurity } from '../route-security.js';
import { AI_DRAFT_NOTICE, NO_EGP_SUBMISSION_NOTICE, NO_EGP_SUBMISSION_NOTICE_TH, bidPrepNotices } from './notices.js';

export { AI_DRAFT_NOTICE, NO_EGP_SUBMISSION_NOTICE, NO_EGP_SUBMISSION_NOTICE_TH, bidPrepNotices };

/**
 * Endpoint → control map for FR-4.7. Handlers under app/api/bid-prep use these
 * buckets. Issue #139 must call consumeBidPrepLimit('draft-create', session.sub)
 * before any Vertex job so generation shares this quota.
 */
export const BID_PREP_ENDPOINTS = Object.freeze([
    { issue: '136', method: 'GET', path: '/api/profiles', scope: 'profile:read', bucket: 'profile', bola: 'Reads session.sub only' },
    { issue: '136', method: 'PUT', path: '/api/profiles', scope: 'profile:write', bucket: 'profile', bola: 'Writes session.sub only; body user id is ignored' },
    { issue: '136', method: 'PATCH', path: '/api/profiles', scope: 'profile:write', bucket: 'profile', bola: 'Writes session.sub only; body user id is ignored' },
    { issue: '136', method: 'DELETE', path: '/api/profiles', scope: 'profile:write', bucket: 'profile', bola: 'Deletes the signed-in account and that account\'s drafts' },
    { issue: '142', method: 'DELETE', path: '/api/bid-prep/data', scope: 'profile:write', bucket: 'delete', bola: 'Clears company fields and drafts for session.sub only' },
    { issue: '140', method: 'POST', path: '/api/bid-prep/drafts', scope: 'profile:write', bucket: 'draft-create', bola: 'Owner is session.sub; body user id is ignored' },
    { issue: '140', method: 'GET', path: '/api/bid-prep/drafts', scope: 'profile:read', bucket: 'read', bola: 'Lists session.sub drafts only' },
    { issue: '140', method: 'GET', path: '/api/bid-prep/drafts/[id]', scope: 'profile:read', bucket: 'read', bola: 'Another user\'s draft is 404' },
    { issue: '140', method: 'PATCH', path: '/api/bid-prep/drafts/[id]', scope: 'profile:write', bucket: 'write', bola: 'Another user\'s draft is 404' },
    { issue: '140', method: 'DELETE', path: '/api/bid-prep/drafts/[id]', scope: 'profile:write', bucket: 'write', bola: 'Another user\'s draft is 404' },
    { issue: '141', method: 'POST', path: '/api/bid-prep/drafts/[id]/export', scope: 'profile:write', bucket: 'export', bola: 'Another user\'s draft is 404' },
    { issue: '138', method: 'GET', path: '/api/bid-prep/tors/[projectId]/checklist', scope: 'profile:read', bucket: 'read', bola: 'Profile comes from session.sub; query user id is ignored' },
]);

const BUCKETS = {
    read: { window: 'minute', env: 'BID_PREP_READS_PER_MINUTE', fallback: 60 },
    write: { window: 'minute', env: 'BID_PREP_WRITES_PER_MINUTE', fallback: 30 },
    profile: { window: 'minute', env: 'BID_PREP_PROFILE_PER_MINUTE', fallback: 60 },
    'draft-create': { window: 'hour', env: 'BID_PREP_DRAFTS_PER_HOUR', fallback: 5 },
    export: { window: 'hour', env: 'BID_PREP_EXPORTS_PER_HOUR', fallback: 20 },
    delete: { window: 'hour', env: 'BID_PREP_DELETES_PER_HOUR', fallback: 10 },
};

let nowFn = () => Date.now();
const minuteLimiter = createRateLimiter({ windowMs: 60 * 1000, now: () => nowFn() });
const hourLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, now: () => nowFn() });

export function limitFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function consumeBidPrepLimit(bucket, userId) {
    const spec = BUCKETS[bucket];
    if (!spec || !userId) throw new TypeError('Unknown BidPrep rate limit');
    const limiter = spec.window === 'hour' ? hourLimiter : minuteLimiter;
    return limiter.hit(`bidprep:${bucket}:${userId}`, limitFromEnv(spec.env, spec.fallback));
}

/** Tests advance or replace the clock. Passing null restores Date.now. */
export function setBidPrepClockForTests(fn) {
    nowFn = typeof fn === 'function' ? fn : () => Date.now();
}

export function bidPrepError(code, message, status, headers) {
    return NextResponse.json({ error: { code, message } }, { status, headers });
}

export function profileRateLimitResponse(userId) {
    const result = consumeBidPrepLimit('profile', userId);
    if (result.allowed) return null;
    return bidPrepError(
        'RATE_LIMITED',
        `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
        429,
        rateLimitHeaders(result),
    );
}

/** Failures stay generic. Names only: messages can echo stored company data. */
export function bidPrepFailure(error) {
    try {
        console.error(JSON.stringify({ event: 'bid_prep_error', name: error?.name || 'Error' }));
    } catch { /* logging must not change the response */ }
    return bidPrepError('INTERNAL', 'The request could not be completed.', 500);
}

const AUDIT_EVENTS = new Set(['bid_prep_draft_created', 'bid_prep_draft_exported', 'bid_prep_data_deleted']);

/**
 * Same shape as lib/auth-audit.js: allowlisted fields, ISO-8601 time, client
 * address. Draft text, profiles and secrets are not accepted.
 */
export function logBidPrepAudit(request, event, details = {}) {
    try {
        if (!AUDIT_EVENTS.has(event)) return;
        const record = {
            event,
            userId: String(details.userId || '').slice(0, 64),
            timestamp: new Date().toISOString(),
            path: request?.url ? new URL(request.url).pathname.slice(0, 256) : '',
            clientAddress: clientAddress(request?.headers || new Headers()).slice(0, 128),
        };
        if (details.draftId) record.draftId = String(details.draftId).slice(0, 64);
        if (details.projectId) record.projectId = String(details.projectId).slice(0, 64);
        if (details.scope === 'account' || details.scope === 'company') record.scope = details.scope;
        if (Number.isInteger(details.draftsDeleted) && details.draftsDeleted >= 0) record.draftsDeleted = details.draftsDeleted;
        console.warn(JSON.stringify(record));
    } catch { /* Audit transport failures must not change the response. */ }
}

const LOG_KEY = /draft|profile|password|secret|token|authorization|section|company|signatory|email|credential|body/i;

export function redactForLog(value) {
    if (Array.isArray(value)) return value.map(redactForLog);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        output[key] = LOG_KEY.test(key) ? '[redacted]' : redactForLog(item);
    }
    return output;
}

export function isDraftId(value) {
    return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
}

export function isProjectId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
}

export async function readJson(request, { maxBytes }) {
    const type = request.headers.get('content-type') || '';
    if (!type.toLowerCase().includes('application/json')) {
        return { error: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' } };
    }
    const declared = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
        return { error: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } };
    }
    let text = '';
    try { text = await request.text(); } catch { return { error: { status: 400, code: 'INVALID_JSON', message: 'Request body must be JSON.' } }; }
    if (Buffer.byteLength(text) > maxBytes) {
        return { error: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } };
    }
    try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { error: { status: 400, code: 'INVALID_BODY', message: 'Request body must be a JSON object.' } };
        }
        return { value };
    } catch {
        return { error: { status: 400, code: 'INVALID_JSON', message: 'Request body must be JSON.' } };
    }
}

export function withBidPrep(handler, path, method, bucket) {
    return withRouteSecurity(async (request, context) => {
        try {
            const userId = (await requestPrincipal(request))?.session?.sub;
            if (!userId) return bidPrepError('UNAUTHORIZED', 'Authentication required', 401);
            const limit = consumeBidPrepLimit(bucket, userId);
            if (!limit.allowed) {
                return bidPrepError(
                    'RATE_LIMITED',
                    `Too many requests. Try again in ${limit.retryAfterSeconds} seconds.`,
                    429,
                    rateLimitHeaders(limit),
                );
            }
            const response = await handler(request, context, { userId: String(userId) });
            for (const [name, value] of Object.entries(rateLimitHeaders(limit))) {
                if (!response.headers.has(name)) response.headers.set(name, value);
            }
            return response;
        } catch (error) {
            return bidPrepFailure(error);
        }
    }, path, method);
}
