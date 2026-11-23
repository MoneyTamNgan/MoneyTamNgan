import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession, hasScope, sessionCookieOptions } from '@/lib/auth';
import { sessionAccountActive } from '@/lib/account-status';
import { authorizeScopeRequest, permissionFor } from '@/lib/request-authorization';
import { applyCors, contentSecurityPolicy, originError, securityHeaders } from '@/lib/security-policy';
import { randomBytes } from 'node:crypto';
import { isGoogleOAuthPath } from '@/lib/oauth-security';
import { ADMIN_UNLOCK_COOKIE, adminGateConfig, checkAdminGate } from '@/lib/admin-gate';
import { isPipelineTrigger, pipelineAuditContext, logPipelineAudit } from '@/lib/admin-pipeline-audit';
import {
    clientAddress,
    createRateLimiter,
    rateLimitHeaders,
    rateLimits,
} from '@/lib/rate-limit';

const PROTECTED_PAGES = ['/admin', '/profile'];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const limiter = createRateLimiter();

const startsWithAny = (pathname, prefixes) =>
    prefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));

function rateLimit(request, session) {
    const limits = rateLimits();
    const result = session?.sub
        ? limiter.hit(`user:${session.sub}`, limits.user)
        : limiter.hit(`ip:${clientAddress(request.headers)}`, limits.guest);

    const headers = rateLimitHeaders(result);
    if (!result.allowed) {
        return NextResponse.json({
            error: {
                code: 'RATE_LIMITED',
                message: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
            },
        }, { status: 429, headers });
    }

    const response = NextResponse.next();
    for (const [name, value] of Object.entries(headers)) {
        response.headers.set(name, value);
    }
    return response;
}

/**
 * Permanent redirect to the slash-less path. Next's built-in redirect is skipped
 * (`skipTrailingSlashRedirect`) so this response can carry securityHeaders().
 * Root `/` is unchanged and the query string is preserved. The Location must be
 * absolute: the proxy adapter rejects a relative one. Next then emits a
 * same-origin relative Location on the wire.
 */
function redirectTrailingSlash(request) {
    const { pathname } = request.nextUrl;
    if (pathname === '/' || !pathname.endsWith('/')) return null;
    // Use a standard URL. NextURL.href puts the original trailing slash back.
    const url = new URL(request.url);
    url.pathname = pathname.replace(/\/+$/, '') || '/';
    const response = NextResponse.redirect(url, 308);
    for (const { key, value } of securityHeaders()) response.headers.set(key, value);
    return response;
}

/**
 * Gate account pages behind a valid session, authorize admin/pipeline endpoints,
 * and rate-limit public read API endpoints for guest access (FR-4.2.1, FR-4.2.2).
 */
export async function proxy(request) {
    const slashRedirect = redirectTrailingSlash(request);
    if (slashRedirect) return slashRedirect;
    const { pathname } = request.nextUrl;
    const nonce = randomBytes(16).toString('base64');
    const csp = contentSecurityPolicy({ nonce, upgrade: process.env.NODE_ENV === 'production' && process.env.APP_ORIGIN?.startsWith('https://') });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce); // overwrite, never trust a client nonce
    requestHeaders.set('Content-Security-Policy', csp);
    const next = () => NextResponse.next({ request: { headers: requestHeaders } });
    let response;
    let pageHasSession = true;
    if (pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS') {
            const error = originError(request);
            response = error ? NextResponse.json({ error: { code: 'FORBIDDEN_ORIGIN', message: error } }, { status: 403 })
                : new NextResponse(null, { status: 204 });
        } else {
            const permission = permissionFor(pathname, request.method);
            const auth = await authorizeScopeRequest(request, permission);
            if (!auth.authorized) response = NextResponse.json({ error: { code: auth.code, message: auth.message } }, { status: auth.status });
            else {
                const error = originError(permission.mutation ? { headers: request.headers, method: 'POST' } : request,
                    { machine: ['pipeline', 'bearer', 'cron'].includes(auth.principal?.kind) });
                response = error ? NextResponse.json({ error: { code: 'FORBIDDEN_ORIGIN', message: error } }, { status: 403 })
                    : permission.public && READ_METHODS.has(request.method) && !isGoogleOAuthPath(pathname) ? rateLimit(request, auth.principal?.session) : next();
            }
        }
        if ([401, 403].includes(response.status) && isPipelineTrigger(pathname, request.method)) {
            const principal = request.method === 'OPTIONS' ? null : await authorizeScopeRequest(request, permissionFor(pathname, request.method));
            logPipelineAudit({ ...pipelineAuditContext(request, principal?.principal), outcome: 'denied', http_status: response.status });
        }
        try { applyCors(response, request); } catch { /* configuration errors already fail closed */ }
    } else {
        const cookieSession = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
        const session = cookieSession && await sessionAccountActive(cookieSession) ? cookieSession : null;
        pageHasSession = Boolean(session);
        if (!session && startsWithAny(pathname, PROTECTED_PAGES)) {
            const loginUrl = new URL('/', request.url);
            loginUrl.searchParams.set('next', pathname);
            response = NextResponse.redirect(loginUrl);
        } else if (pathname.startsWith('/admin') && !hasScope(session, 'admin:read')) response = new NextResponse('Admin permission required', { status: 403 });
        else if (pathname.startsWith('/admin') && adminGateConfig().enabled) {
            // The sign-in page for the access code only needs the address check.
            const onUnlockPage = pathname === '/admin/unlock';
            const gate = await checkAdminGate({
                config: adminGateConfig(), headers: request.headers, session,
                unlockToken: request.cookies.get(ADMIN_UNLOCK_COOKIE)?.value, requireCode: !onUnlockPage,
            });
            if (gate.ok) response = next();
            else if (gate.code === 'ADMIN_CODE_REQUIRED') {
                const unlockUrl = new URL('/admin/unlock', request.url);
                unlockUrl.searchParams.set('next', pathname);
                response = NextResponse.redirect(unlockUrl);
            } else response = new NextResponse(gate.message, { status: 403 });
        }
        else if (startsWithAny(pathname, ['/profile']) && !hasScope(session, 'profile:read')) response = new NextResponse('Profile permission required', { status: 403 });
        else response = next();
    }
    // A refused credential (expired, invalid, or its account is disabled) is cleared from the browser.
    if (request.cookies.get(SESSION_COOKIE) && (response.status === 401 || !pageHasSession)) {
        response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    }
    for (const { key, value } of securityHeaders(csp)) response.headers.set(key, value);
    if (!pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'private, no-store');
    return response;
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
