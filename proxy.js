import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession, hasScope } from '@/lib/auth';
import { authorizeScopeRequest, permissionFor } from '@/lib/request-authorization';
import { applyCors, contentSecurityPolicy, originError, securityHeaders } from '@/lib/security-policy';
import { randomBytes } from 'node:crypto';
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
 * Gate account pages behind a valid session, authorize admin/pipeline endpoints,
 * and rate-limit public read API endpoints for guest access (FR-4.2.1, FR-4.2.2).
 */
export async function proxy(request) {
    const { pathname } = request.nextUrl;
    const nonce = randomBytes(16).toString('base64');
    const csp = contentSecurityPolicy({ nonce, upgrade: process.env.NODE_ENV === 'production' && process.env.APP_ORIGIN?.startsWith('https://') });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce); // overwrite, never trust a client nonce
    requestHeaders.set('Content-Security-Policy', csp);
    const next = () => NextResponse.next({ request: { headers: requestHeaders } });
    let response;
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
                    : permission.public && READ_METHODS.has(request.method) ? rateLimit(request, auth.principal?.session) : next();
            }
        }
        try { applyCors(response, request); } catch { /* configuration errors already fail closed */ }
    } else {
        const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
        if (!session && startsWithAny(pathname, PROTECTED_PAGES)) {
            const loginUrl = new URL('/', request.url);
            loginUrl.searchParams.set('next', pathname);
            response = NextResponse.redirect(loginUrl);
        } else if (pathname.startsWith('/admin') && !hasScope(session, 'admin:read')) response = new NextResponse('Admin permission required', { status: 403 });
        else if (startsWithAny(pathname, ['/profile']) && !hasScope(session, 'profile:read')) response = new NextResponse('Profile permission required', { status: 403 });
        else response = next();
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
