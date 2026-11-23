import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ADMIN_UNLOCK_COOKIE, ADMIN_UNLOCK_SECONDS, adminClientAddress, adminGateConfig, signAdminUnlock } from '@/lib/admin-gate';
import { requestPrincipal } from '@/lib/request-authorization';
import { createRateLimiter, rateLimitHeaders } from '@/lib/rate-limit';
import { logAuthAudit } from '@/lib/auth-audit';
import { sessionCookieOptions } from '@/lib/auth';
import { withRouteSecurity } from '@/lib/route-security';

export const runtime = 'nodejs';

const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000 });
const fail = (status, code, message, headers) => NextResponse.json({ error: { code, message } }, { status, headers });

function codeMatches(code, hashHex) {
    const given = createHash('sha256').update(code).digest();
    const expected = Buffer.from(hashHex, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Admin only (the proxy already checked role and address). Exchanges the access code for a short unlock cookie. */
async function handlePOST(request) {
    const principal = await requestPrincipal(request);
    const session = principal?.session;
    if (!session || session.role !== 'admin') return fail(403, 'INSUFFICIENT_SCOPE', 'Admin role required');

    const config = adminGateConfig();
    if (!config.codeEnabled) return NextResponse.json({ unlocked: true, required: false });
    if (!config.codeHash) return fail(503, 'ADMIN_CODE_MISCONFIGURED', 'The admin access code is not configured correctly');

    const address = adminClientAddress(request.headers);
    const attempt = limiter.hit(`admin-unlock:${session.sub}:${address}`, 5);
    const headers = rateLimitHeaders(attempt);
    if (!attempt.allowed) {
        logAuthAudit(request, 'admin_unlock', 'rate_limited', { userId: session.sub, role: session.role });
        return fail(429, 'RATE_LIMITED', `Too many attempts. Try again in ${attempt.retryAfterSeconds} seconds.`, headers);
    }

    let code = '';
    try {
        if (Number(request.headers.get('content-length') ?? 0) > 512) throw new Error('too large');
        const body = await request.json();
        code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
    } catch {
        return fail(400, 'INVALID_BODY', 'Send JSON like {"code":"XXXX-XXXX"}', headers);
    }
    if (!code || code.length > 64 || !codeMatches(code, config.codeHash)) {
        logAuthAudit(request, 'admin_unlock', 'invalid_code', { userId: session.sub, role: session.role });
        return fail(403, 'ADMIN_CODE_INVALID', 'The access code is not correct', headers);
    }

    logAuthAudit(request, 'admin_unlock', 'success', { userId: session.sub, role: session.role });
    const response = NextResponse.json({ unlocked: true, expiresInSeconds: ADMIN_UNLOCK_SECONDS }, { headers });
    response.cookies.set(ADMIN_UNLOCK_COOKIE, await signAdminUnlock({ sub: session.sub, address }),
        { ...sessionCookieOptions(), sameSite: 'strict', maxAge: ADMIN_UNLOCK_SECONDS });
    return response;
}

export const POST = withRouteSecurity(handlePOST, '/api/admin/unlock', 'POST');
