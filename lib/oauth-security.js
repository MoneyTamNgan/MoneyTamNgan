import { NextResponse } from 'next/server';
import { clientAddress, createRateLimiter, rateLimitHeaders } from './rate-limit.js';
import { logAuthAudit } from './auth-audit.js';

const limiter = createRateLimiter({ windowMs: 15 * 60 * 1000, now: () => Date.now() });
const paths = new Set(['/api/auth/google/start', '/api/auth/google/login', '/api/auth/google/callback']);
export const isGoogleOAuthPath = path => paths.has(path);

/** Separate start/callback budgets; both start URLs share a single budget. */
export function withOAuthLimit(handler, stage) {
    return async (request, context) => {
        const result = limiter.hit(`oauth:${stage}:${clientAddress(request.headers)}`, 5);
        let response;
        if (!result.allowed) {
            logAuthAudit(request, 'oauth_rate_limited', stage);
            response = NextResponse.json({ error: { code: 'RATE_LIMITED',
                message: `Too many authentication attempts. Try again in ${result.retryAfterSeconds} seconds.` } },
            { status: 429 });
            // Google callbacks are full browser navigations. Keep the HTTP 429,
            // then take the browser to the login popup without exposing OAuth query data.
            if (!request.headers.get('accept')?.includes('application/json') && request.headers.get('accept')?.includes('text/html')) {
                const destination = `/?auth_wait_until=${result.resetAt}`;
                response = new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${destination}"><title>Please wait</title></head><body><p>Too many authentication attempts. <a href="${destination}">View time remaining</a></p></body></html>`,
                    { status: 429, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
        } else response = await handler(request, context);
        for (const [name, value] of Object.entries(rateLimitHeaders(result))) response.headers.set(name, value);
        response.headers.set('Cache-Control', 'no-store');
        return response;
    };
}
