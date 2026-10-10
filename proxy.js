import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import {
    clientAddress,
    createRateLimiter,
    rateLimitHeaders,
    rateLimits,
} from '@/lib/rate-limit';

// Account pages need a session. The dashboard, analytics, and TOR pages are
// public so guests can browse open and historical tenders (FR-4.2.1).
const PROTECTED_PAGES = ['/admin', '/profile'];
// Read-only endpoints guests can reach without signing in (FR-4.2.2).
const PUBLIC_API = ['/api/tors', '/api/projects'];
const READ_METHODS = new Set(['GET', 'HEAD']);

const limiter = createRateLimiter();

const startsWithAny = (pathname, prefixes) => prefixes.some(prefix => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
));

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
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
}

/**
 * Gate account pages behind a valid session and rate-limit the public API.
 * Unauthenticated page requests are redirected to the login page ("/") with
 * a ?next= hint so the callback can send them back where they were headed.
 *
 * (Next 16 renamed the "middleware" convention to "proxy"; same API.)
 */
export async function proxy(request) {
    const { pathname } = request.nextUrl;
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);

    if (startsWithAny(pathname, PUBLIC_API)) {
        return READ_METHODS.has(request.method) ? rateLimit(request, session) : NextResponse.next();
    }

    if (!session && startsWithAny(pathname, PROTECTED_PAGES)) {
        const loginUrl = new URL('/', request.url);
        loginUrl.searchParams.set('next', pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/admin/:path*',
        '/profile/:path*',
        '/api/tors/:path*',
        '/api/projects/:path*',
    ],
};
