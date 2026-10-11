import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import {
    clientAddress,
    createRateLimiter,
    rateLimitHeaders,
    rateLimits,
} from '@/lib/rate-limit';

// Pages gated behind authentication (FR-4.2.1: public guest access allowed elsewhere)
const PROTECTED_PAGES = ['/admin', '/profile'];
// Read-only endpoints guests can access without signing in (FR-4.2.2)
const PUBLIC_API = ['/api/tors', '/api/projects', '/api/analytics'];
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

function isPipelineAuthorized(request) {
    const configured = process.env.PIPELINE_ADMIN_TOKEN || '';
    const supplied = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const expectedBytes = Buffer.from(configured);
    const suppliedBytes = Buffer.from(supplied);

    return (
        configured.length >= 32 &&
        expectedBytes.length === suppliedBytes.length &&
        timingSafeEqual(expectedBytes, suppliedBytes)
    );
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

    // 1. Handle Public API Endpoint Rate-Limiting (FR-4.2.2)
    if (startsWithAny(pathname, PUBLIC_API) && isReadRequest) {
        return rateLimit(request, session);
    }

    // 2. Handle Protected & Internal API Endpoints
    if (isApi) {
        // Allow pipeline scripts with valid Bearer token
        if (isPipelineAuthorized(request)) {
            return NextResponse.next();
        }

        // Require active session and admin role for internal mutations / admin APIs
        if (!session) {
            return NextResponse.json(
                { error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' } },
                { status: 401 }
            );
        }

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

    // 3. Handle Protected Pages (Redirect unauthenticated users to login)
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
        '/api/tors/:path*',
        '/api/projects/:path*',
        '/api/analytics/:path*',
        '/api/admin/:path*',
        '/api/ingestion/:path*',
        '/api/processing/:path*',
        '/api/scraping/:path*',
    ],
};