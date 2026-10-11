import { it, expect, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { signSession, SESSION_COOKIE } from './lib/auth';
afterEach(() => delete process.env.PIPELINE_ADMIN_TOKEN);
const url = 'http://localhost/api/processing/trigger';
it('denies anonymous mutation but preserves read-only status', async () => {
    expect((await proxy(new NextRequest(url, { method: 'POST' }))).status).toBe(401);
    expect((await proxy(new NextRequest('http://localhost/api/processing/status'))).status).toBe(200);
});
it('requires admin role and rejects cross-origin admin mutations', async () => {
    for (const role of ['user', 'admin']) {
        const cookie = `${SESSION_COOKIE}=${await signSession({ sub: 'test', role })}`;
        expect((await proxy(new NextRequest(url, { method: 'POST', headers: { cookie } }))).status).toBe(role === 'admin' ? 200 : 403);
        if (role === 'admin') expect((await proxy(new NextRequest(url, { method: 'POST', headers: { cookie, Origin: 'https://evil.example' } }))).status).toBe(403);
    }
});
it('accepts strong operator bearer tokens only when explicitly configured', async () => {
    process.env.PIPELINE_ADMIN_TOKEN = 'a'.repeat(40);
    expect((await proxy(new NextRequest(url, { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(40)}` } }))).status).toBe(200);
    expect((await proxy(new NextRequest(url, { method: 'POST', headers: { Authorization: `Bearer ${'b'.repeat(40)}` } }))).status).toBe(401);
});
