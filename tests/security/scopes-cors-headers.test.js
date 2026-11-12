import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { signSession, verifySession, hasScope, ROLE_SCOPES } from '@/lib/auth';
import { withRouteSecurity } from '@/lib/route-security';
import { allowedOrigins, contentSecurityPolicy, securityHeaders } from '@/lib/security-policy';
import { proxy } from '@/proxy';
import config from '@/next.config';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const request = (path, method = 'GET', headers = {}) => new NextRequest(`http://localhost:3000${path}`, { method, headers });
const credential = async (role, scopes) => `Bearer ${await signSession({ sub: `${role}-fixture`, role, ...(scopes ? { scopes } : {}) })}`;
afterEach(() => vi.unstubAllEnvs());

it('issues signed, versioned role-bounded scopes and supports narrower grants', async () => {
    for (const role of ['user', 'admin', 'pipeline']) {
        const session = await verifySession(await signSession({ sub: 'fixture', role }));
        expect(session.scopes).toEqual(ROLE_SCOPES[role]);
    }
    const session = await verifySession(await signSession({ sub: 'user', role: 'user', scopes: ['tor:read'] }));
    expect(hasScope(session, 'tor:read')).toBe(true);
    expect(hasScope(session, 'profile:write')).toBe(false);
    await expect(signSession({ sub: 'user', role: 'user', scopes: ['pipeline:trigger'] })).rejects.toThrow(/Scope/);
});

it('requires re-login for legacy sessions and rejects forged role/scope grants', async () => {
    for (const claims of [{ sub: 'legacy', role: 'admin' }, { sub: 'bad', role: 'user', scopes: ['admin:write'], auth_version: 2 }]) {
        const token = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h')
            .sign(new TextEncoder().encode(process.env.JWT_SECRET));
        expect(await verifySession(token)).toBeNull();
    }
    expect((await proxy(request('/api/processing/trigger', 'POST', { 'x-role': 'admin', 'x-scopes': 'pipeline:trigger', Origin: 'http://localhost:3000' }))).status).toBe(401);
});

it('keeps public reads public and authorizes normal profile owners, not only admins', async () => {
    expect((await proxy(request('/api/tors'))).status).toBe(200);
    const Authorization = await credential('user');
    expect((await proxy(request('/api/profiles', 'PATCH', { Authorization, Origin: 'http://localhost:3000' }))).status).toBe(200);
    expect((await proxy(request('/api/processing/trigger', 'POST', { Authorization }))).status).toBe(403);
});

it.each([
    ['/api/profiles', 'PATCH', 'profile:write'],
    ['/api/processing/trigger', 'POST', 'pipeline:trigger'],
    ['/api/admin/keywords', 'PUT', 'admin:write'],
    ['/api/projects/p/classification', 'PATCH', 'tor:write'],
    ['/api/processing/review', 'GET', 'admin:read'],
    ['/api/admin/pipeline/status', 'GET', 'admin:read'],
    ['/api/admin/pipeline/status', 'DELETE', 'admin:write'],
    ['/api/admin/pipeline/trigger', 'POST', 'admin:write'],
])('enforces %s %s inside route handling even without Proxy', async (path, method, scope) => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const secured = withRouteSecurity(handler, path, method);
    expect((await secured(request(path, method))).status).toBe(401);
    expect((await secured(request(path, method, { Authorization: await credential('admin', ['tor:read']), Origin: 'http://localhost:3000' }))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect((await secured(request(path, method, { Authorization: await credential('admin', [scope]), Origin: 'http://localhost:3000' }))).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
});

it('bounds legacy pipeline credentials to pipeline operations, never profiles/admin', async () => {
    vi.stubEnv('PIPELINE_ADMIN_TOKEN', 'operator-fixture-'.repeat(4));
    const Authorization = `Bearer ${process.env.PIPELINE_ADMIN_TOKEN}`;
    for (const [path, method, status] of [
        ['/api/ingestion/trigger', 'POST', 200], ['/api/processing/status', 'GET', 200],
        ['/api/profiles', 'PATCH', 403], ['/api/admin/classification/queue', 'GET', 403],
        ['/api/projects/p/classification', 'PATCH', 403],
    ]) expect((await proxy(request(path, method, { Authorization }))).status).toBe(status);
    expect((await proxy(request('/api/ingestion/trigger', 'POST', { Authorization, Origin: '*' }))).status).toBe(403);
    expect((await proxy(request('/api/ingestion/trigger', 'POST', { Authorization, Origin: 'https://evil.example' }))).status).toBe(403);
});

it('bounds cron credentials to notifications and does not accept query secrets', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-fixture-'.repeat(4));
    const Authorization = `Bearer ${process.env.CRON_SECRET}`;
    expect((await proxy(request('/api/notifications/digest', 'GET', { Authorization }))).status).toBe(200);
    expect((await proxy(request('/api/notifications/digest?secret=anything'))).status).toBe(401);
    expect((await proxy(request('/api/processing/trigger', 'POST', { Authorization }))).status).toBe(403);
});

it('rejects missing/wildcard/null/unlisted browser origins, but permits approved same-origin requests', async () => {
    const cookie = `mtn_session=${await signSession({ sub: 'owner', role: 'user' })}`;
    for (const Origin of [undefined, '*', 'null', 'http://localhost:3000.evil.example', 'https://evil.example']) {
        const headers = { cookie, ...(Origin ? { Origin } : {}) };
        expect((await proxy(request('/api/profiles', 'PATCH', headers))).status).toBe(403);
        const guard = withRouteSecurity(() => { throw new Error('must not mutate'); }, '/api/profiles', 'PATCH');
        expect((await guard(request('/api/profiles', 'PATCH', headers))).status).toBe(403);
    }
    expect((await proxy(request('/api/profiles', 'PATCH', { cookie, Origin: 'http://localhost:3000' }))).status).toBe(200);
});

it('handles credential-free preflight with exact origins/methods/headers', async () => {
    const headers = { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' };
    const response = await proxy(request('/api/profiles', 'OPTIONS', headers));
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    for (const bad of [{ Origin: '*' }, { 'Access-Control-Request-Method': 'TRACE' }, { 'Access-Control-Request-Headers': 'x-evil' }]) {
        expect((await proxy(request('/api/profiles', 'OPTIONS', { ...headers, ...bad }))).status).toBe(403);
    }
});

it('never allows wildcard or malformed configured origins and does not trust arbitrary Host values', () => {
    for (const CORS_ALLOWED_ORIGINS of ['*', 'https://*.example.com', 'https://example.com/path', 'http://example.com', 'null']) {
        expect(() => allowedOrigins({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS })).toThrow();
    }
    expect(allowedOrigins({ NODE_ENV: 'production' })).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
});

it('configures all five headers plus conditional exact-origin CORS in next.config.js', async () => {
    expect(config.poweredByHeader).toBe(false);
    const rules = await config.headers();
    expect(rules[0].headers).toContainEqual({ key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' });
    for (const header of securityHeaders()) expect(rules[0].headers).toContainEqual(header);
    for (const rule of rules.slice(1)) expect(rule.headers.find(h => h.key === 'Access-Control-Allow-Origin').value).not.toContain('*');
});

it('uses unique server nonces, never client nonces, and excludes unsafe-eval/unsafe-inline scripts in production', async () => {
    const responses = await Promise.all([proxy(request('/', 'GET', { 'x-nonce': 'attacker' })), proxy(request('/'))]);
    const policies = responses.map(r => r.headers.get('content-security-policy'));
    expect(policies[0]).not.toBe(policies[1]);
    expect(policies[0]).not.toContain('attacker');
    expect(policies[0]).toContain('frame-ancestors \'none\'');
    const production = contentSecurityPolicy({ nonce: 'fixture', development: false });
    expect(production).not.toContain('unsafe-eval');
    expect(production.match(/script-src[^;]+/)[0]).not.toContain('unsafe-inline');
    for (const r of responses) {
        expect(r.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
        expect(r.headers.get('x-frame-options')).toBe('DENY');
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
        expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    }
});

it('registers independent security wrappers for every route export, with the profile alias reusing guarded handlers', async () => {
    async function walk(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = `${dir}/${entry.name}`;
            if (entry.isDirectory()) await walk(path);
            else if (entry.name === 'route.js') {
                const source = await readFile(path, 'utf8');
                if (path.endsWith('/profile/route.js')) expect(source).toMatch(/export \{ GET, PATCH, PUT, DELETE \} from/);
                else {
                    expect(source).not.toMatch(/export async function (GET|POST|PUT|PATCH|DELETE)/);
                    expect(source).toMatch(/export const (GET|POST|PUT|PATCH|DELETE) = with(?:RouteSecurity|BidPrep)/);
                }
            }
        }
    }
    await walk(fileURLToPath(new URL('../../app/api', import.meta.url)));
    const guard = await readFile(fileURLToPath(new URL('../../lib/bid-prep/security.js', import.meta.url)), 'utf8');
    expect(guard).toMatch(/return withRouteSecurity\(/);
});

it('protects actual sensitive handlers before any database or outbound operation', async () => {
    const cases = [
        [() => import('@/app/api/ingestion/trigger/route'), 'POST', '/api/ingestion/trigger'],
        [() => import('@/app/api/processing/trigger/route'), 'POST', '/api/processing/trigger'],
        [() => import('@/app/api/admin/keywords/route'), 'PUT', '/api/admin/keywords'],
        [() => import('@/app/api/projects/[id]/classification/route'), 'PATCH', '/api/projects/p/classification'],
        [() => import('@/app/api/notifications/digest/route'), 'GET', '/api/notifications/digest'],
        [() => import('@/app/api/profiles/route'), 'DELETE', '/api/profiles'],
    ];
    for (const [load, method, path] of cases) {
        const route = await load();
        expect((await route[method](request(path, method), { params: Promise.resolve({ id: 'p' }) })).status).toBe(401);
    }
});
