import { describe, expect, it } from 'vitest';
import { clientAddress, createRateLimiter, rateLimitHeaders } from '@/lib/rate-limit';

describe('createRateLimiter', () => {
    it('allows requests up to the limit, then blocks until the window resets', () => {
        let time = 0;
        const limiter = createRateLimiter({ windowMs: 60_000, now: () => time });
        expect(limiter.hit('ip:a', 2)).toMatchObject({ allowed: true, remaining: 1 });
        expect(limiter.hit('ip:a', 2)).toMatchObject({ allowed: true, remaining: 0 });
        expect(limiter.hit('ip:a', 2)).toMatchObject({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
        expect(limiter.hit('ip:b', 2).allowed).toBe(true);

        time = 60_000;
        expect(limiter.hit('ip:a', 2)).toMatchObject({ allowed: true, remaining: 1 });
    });

    it('sets Retry-After only on blocked responses', () => {
        const limiter = createRateLimiter({ now: () => 0 });
        expect(rateLimitHeaders(limiter.hit('k', 1))).not.toHaveProperty('Retry-After');
        expect(rateLimitHeaders(limiter.hit('k', 1))).toMatchObject({
            'X-RateLimit-Limit': '1', 'X-RateLimit-Remaining': '0', 'Retry-After': '60',
        });
    });
});

describe('clientAddress', () => {
    it('prefers the first forwarded address, then x-real-ip', () => {
        expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe('203.0.113.5');
        expect(clientAddress(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
        expect(clientAddress(new Headers())).toBe('unknown');
    });
});
