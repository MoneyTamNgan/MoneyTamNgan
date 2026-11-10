import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => store }));
vi.mock('@/lib/mongodb', () => ({ connectToDatabase: vi.fn() }));
vi.mock('@/models/User', () => ({ User: { findOne: vi.fn(), findOneAndUpdate: vi.fn() } }));
const { GET: start } = await import('@/app/api/auth/google/start/route');
const { GET: login } = await import('@/app/api/auth/google/login/route');
const { GET: callback } = await import('@/app/api/auth/google/callback/route');
const { connectToDatabase } = await import('@/lib/mongodb');
let ip = 0;
const request = (stage, query = '') => new Request(`http://localhost:3000/api/auth/google/${stage}${query}`, {
    headers: { 'x-forwarded-for': `203.0.113.${ip}` },
});
beforeEach(() => {
    ip++;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
    vi.clearAllMocks();
    store.get.mockReturnValue({ value: 'expected|/profile' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Google OAuth security', () => {
    it('navigates browser sign-in to Google until limited, then returns to the countdown popup', async () => {
        const browserRequest = () => new Request('http://localhost:3000/api/auth/google/start', {
            headers: { Accept: 'text/html,application/xhtml+xml', 'x-forwarded-for': `203.0.113.${ip}` },
        });
        for (let i = 0; i < 5; i++) {
            const response = await start(browserRequest());
            expect(response.status).toBe(307);
            expect(new URL(response.headers.get('location')).hostname).toBe('accounts.google.com');
        }
        store.set.mockClear();
        const blocked = await start(browserRequest());
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get('retry-after')).toBe('900');
        expect(blocked.headers.get('content-type')).toContain('text/html');
        expect(await blocked.text()).toContain(`content="0;url=/?auth_wait_until=${Date.now() + 900000}"`);
        expect(store.set).not.toHaveBeenCalled();
    });
    it('returns a JSON authorization URL for the popup UI without an extra start request', async () => {
        const response = await start(new Request('http://localhost:3000/api/auth/google/start?next=%2Fprofile', {
            headers: { Accept: 'application/json', 'x-forwarded-for': `203.0.113.${ip}` },
        }));
        expect(response.status).toBe(200);
        expect(new URL((await response.json()).authorizationUrl).hostname).toBe('accounts.google.com');
        expect(store.set).toHaveBeenCalledOnce();
        expect(store.set.mock.calls[0][1]).toMatch(/\|\/profile$/);
        expect(response.headers.get('x-ratelimit-remaining')).toBe('4');
    });

    it('returns an HTML 429 that sends a browser callback to the countdown popup', async () => {
        for (let i = 0; i < 5; i++) await callback(request('callback', '?code=secret&state=wrong'));
        const response = await callback(new Request('http://localhost:3000/api/auth/google/callback?code=secret&state=wrong', {
            headers: { Accept: 'text/html', 'x-forwarded-for': `203.0.113.${ip}` },
        }));
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('900');
        const html = await response.text();
        expect(html).toContain(`/?auth_wait_until=${Date.now() + 900000}`);
        expect(html).not.toContain('secret');
    });
    it('shares the start budget with the login alias and resets after 15 minutes', async () => {
        for (let i = 0; i < 5; i++) {
            const response = await (i % 2 ? login(request('login')) : start(request('start', '?next=%2Fprofile')));
            expect(response.status).toBe(307);
            expect(new URL(response.headers.get('location')).hostname).toBe('accounts.google.com');
        }
        store.set.mockClear();
        const blocked = await login(request('login'));
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get('retry-after')).toBe('900');
        expect(blocked.headers.get('cache-control')).toBe('no-store');
        expect(store.set).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1501);
        expect((await start(request('start'))).headers.get('retry-after')).toBe('899');
        vi.advanceTimersByTime(900000);
        expect((await start(request('start'))).status).toBe(307);
    });

    it('isolates IPs and callback budgets and stops blocked callbacks before side effects', async () => {
        for (let i = 0; i < 5; i++) expect((await callback(request('callback', '?code=secret&state=wrong'))).status).toBe(400);
        store.get.mockClear(); store.delete.mockClear();
        const blocked = await callback(request('callback', '?code=secret&state=expected'));
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(store.get).not.toHaveBeenCalled();
        expect(store.delete).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
        expect(connectToDatabase).not.toHaveBeenCalled();
        expect(blocked.cookies.get('mtn_session')).toBeUndefined();
        expect((await start(request('start'))).status).toBe(307);
        ip++;
        expect((await callback(request('callback', '?code=secret&state=wrong'))).status).toBe(400);
    });

    it.each(['?code=private-code', '?code=private-code&state=private-state'])('audits invalid state without credentials: %s', async query => {
        expect((await callback(request('callback', query))).status).toBe(400);
        const event = JSON.parse(console.warn.mock.calls[0][0]);
        expect(event.event).toBe('oauth_invalid_state');
        expect(event.path).toBe('/api/auth/google/callback');
        expect(JSON.stringify(event)).not.toMatch(/private-code|private-state|expected/);
    });

    it('audits rate limiting and tolerates audit transport failure', async () => {
        for (let i = 0; i < 5; i++) await start(request('start'));
        expect((await start(request('start'))).status).toBe(429);
        expect(JSON.parse(console.warn.mock.calls[0][0])).toMatchObject({ event: 'oauth_rate_limited', reason: 'start' });
        console.warn.mockImplementation(() => { throw new Error('transport failed'); });
        expect((await start(request('start'))).status).toBe(429);
    });
});
