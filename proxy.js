import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { isPipelineAuthorized } from '@/lib/pipeline-auth';
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
    const isApi = pathname.startsWith('/api/');
    const isReadRequest = READ_METHODS.has(request.method);

    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);

    // 1. Public API Read Requests (FR-4.2.1, FR-4.2.2):
    // Allows guest read access to all non-admin API routes while enforcing rate limits
    if (isApi && isReadRequest && !pathname.startsWith('/api/admin/')) {
        return rateLimit(request, session);
    }

    // 2. Protected & Internal API Endpoints / Mutations
    if (isApi) {
        // Bypass for background pipeline scripts authenticated via Bearer token
        if (isPipelineAuthorized(request)) {
            return NextResponse.next();
        }

        // Require active session
        if (!session) {
            return NextResponse.json(
                { error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' } },
                { status: 401 }
            );
        }

        // Require admin role
        if (session.role !== 'admin') {
            return NextResponse.json(
                { error: { code: 'FORBIDDEN', message: 'Admin role required' } },
                { status: 403 }
            );
        }

        // CSRF Cross-Origin Mutation Guard
        if (!isReadRequest) {
            const origin = request.headers.get('origin');
            const expectedOrigin = process.env.APP_ORIGIN || new URL(request.url).origin;
            if (
                request.headers.get('sec-fetch-site') === 'cross-site' ||
                (origin && origin !== expectedOrigin)
            ) {
                return NextResponse.json(
                    { error: { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin mutation denied' } },
                    { status: 403 }
                );
            }
        }

        return NextResponse.next();
    }

    // 3. Protected Pages (Redirect unauthenticated users to login)
    if (!session && startsWithAny(pathname, PROTECTED_PAGES)) {
        const loginUrl = new URL('/', request.url);
        loginUrl.searchParams.set('next', pathname);
        return NextResponse.redirect(loginUrl);
    }

    if (pathname.startsWith('/admin') && session?.role !== 'admin') {
        return new NextResponse('Admin role required', { status: 403 });
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/admin/:path*',
        '/profile/:path*',
        '/api/:path*',
    ],
};
