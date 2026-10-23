import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { proxy } from '@/proxy';

const request = (path, init = {}) => new NextRequest(`http://localhost:3000${path}`, init);

describe('proxy middleware', () => {
    afterEach(() => {
        delete process.env.PIPELINE_ADMIN_TOKEN;
    });

    describe('Guest Access & Rate Limiting (FR-4.2.1, FR-4.2.2)', () => {
        it('lets guests open public dashboard, analytics, and TOR pages', async () => {
            for (const path of ['/dashboard', '/analytics', '/tors/69010000001']) {
                const response = await proxy(request(path));
                expect(response.headers.get('location')).toBeNull();
            }
        });

        it('redirects guests away from protected account pages', async () => {
            const response = await proxy(request('/profile'));
            expect(response.status).toBe(307);
            expect(response.headers.get('location')).toBe('http://localhost:3000/?next=%2Fprofile');
        });

        it('allows signed-in users into account pages', async () => {
            const token = await signSession({ sub: 'user-1', role: 'user' });
            const response = await proxy(request('/profile', { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
            expect(response.headers.get('location')).toBeNull();
        });

        it('allows admin users into admin pages', async () => {
            const token = await signSession({ sub: 'admin-1', role: 'admin' });
            const response = await proxy(request('/admin', { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
            expect(response.headers.get('location')).toBeNull();
        });

        it('rate-limits guest reads of the public API per client address', async () => {
            const headers = { 'x-forwarded-for': '203.0.113.99' };
            let response;
            for (let i = 0; i < 60; i += 1) {
                response = await proxy(request('/api/tors', { headers }));
            }
            expect(response.status).toBe(200);
            expect(response.headers.get('x-ratelimit-remaining')).toBe('0');

            response = await proxy(request('/api/tors/abc', { headers }));
            expect(response.status).toBe(429);
            expect(response.headers.get('retry-after')).toBeTruthy();
            expect((await response.json()).error.code).toBe('RATE_LIMITED');

            const other = await proxy(request('/api/tors', { headers: { 'x-forwarded-for': '203.0.113.100' } }));
            expect(other.status).toBe(200);
        });
    });

    describe('API Security & Pipeline Operator Access', () => {
        it('protects both the admin low-confidence queue and the existing processing review GET', async () => {
            for (const path of ['/api/admin/classification/queue', '/api/processing/review']) {
                expect((await proxy(request(path))).status).toBe(401);
                const user = await signSession({ sub: 'user', role: 'user' });
                expect((await proxy(request(path, { headers: { cookie: `${SESSION_COOKIE}=${user}` } }))).status).toBe(403);
                const admin = await signSession({ sub: 'admin', role: 'admin' });
                expect((await proxy(request(path, { headers: { cookie: `${SESSION_COOKIE}=${admin}` } }))).status).toBe(200);
                process.env.PIPELINE_ADMIN_TOKEN = 'r'.repeat(40);
                expect((await proxy(request(path, { headers: { Authorization: `Bearer ${'r'.repeat(40)}` } }))).status).toBe(200);
            }
        });
        const triggerUrl = '/api/processing/trigger';

        it('denies anonymous mutation but preserves read-only status', async () => {
            const postRes = await proxy(request(triggerUrl, { method: 'POST' }));
            expect(postRes.status).toBe(401);

            const getRes = await proxy(request('/api/processing/status'));
            expect(getRes.status).toBe(200);
        });

        it('requires admin role and rejects cross-origin admin mutations', async () => {
            for (const role of ['user', 'admin']) {
                const cookie = `${SESSION_COOKIE}=${await signSession({ sub: 'test', role })}`;

                const res = await proxy(request(triggerUrl, { method: 'POST', headers: { cookie } }));
                expect(res.status).toBe(role === 'admin' ? 200 : 403);

                if (role === 'admin') {
                    const crossOriginRes = await proxy(
                        request(triggerUrl, { method: 'POST', headers: { cookie, Origin: 'https://evil.example' } })
                    );
                    expect(crossOriginRes.status).toBe(403);
                }
            }
        });

        it('accepts strong operator bearer tokens only when explicitly configured', async () => {
            process.env.PIPELINE_ADMIN_TOKEN = 'a'.repeat(40);

            const validRes = await proxy(
                request(triggerUrl, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${'a'.repeat(40)}` },
                })
            );
            expect(validRes.status).toBe(200);

            const invalidRes = await proxy(
                request(triggerUrl, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${'b'.repeat(40)}` },
                })
            );
            expect(invalidRes.status).toBe(401);
        });
    });
});
