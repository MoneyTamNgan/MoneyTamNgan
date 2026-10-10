import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { signSession } from '@/lib/auth';
import { proxy } from '@/proxy';

const request = (path, init = {}) => new NextRequest(`http://localhost:3000${path}`, init);

describe('proxy', () => {
    it('lets guests open public dashboard, analytics, and TOR pages', async () => {
        for (const path of ['/dashboard', '/analytics', '/tors/69010000001']) {
            const response = await proxy(request(path));
            expect(response.headers.get('location')).toBeNull();
        }
    });

    it('redirects guests away from account pages', async () => {
        const response = await proxy(request('/profile'));
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toBe('http://localhost:3000/?next=%2Fprofile');
    });

    it('allows signed-in users into account pages', async () => {
        const token = await signSession({ sub: 'user-1', role: 'user' });
        const response = await proxy(request('/admin', { headers: { cookie: `mtn_session=${token}` } }));
        expect(response.headers.get('location')).toBeNull();
    });

    it('rate-limits guest reads of the public API per client address', async () => {
        const headers = { 'x-forwarded-for': '203.0.113.99' };
        let response;
        for (let i = 0; i < 60; i += 1) response = await proxy(request('/api/tors', { headers }));
        expect(response.status).toBe(200);
        expect(response.headers.get('x-ratelimit-remaining')).toBe('0');

        response = await proxy(request('/api/tors/abc', { headers }));
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBeTruthy();
        expect((await response.json()).error.code).toBe('RATE_LIMITED');

        const other = await proxy(request('/api/tors', { headers: { 'x-forwarded-for': '203.0.113.100' } }));
        expect(other.status).toBe(200);
    });

    it('does not count writes against the read limit', async () => {
        const response = await proxy(request('/api/projects/1/classification', {
            method: 'PATCH', headers: { 'x-forwarded-for': '203.0.113.150' },
        }));
        expect(response.headers.get('x-ratelimit-limit')).toBeNull();
    });
});
