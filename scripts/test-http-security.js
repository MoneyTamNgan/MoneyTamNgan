import 'dotenv/config';
import assert from 'node:assert/strict';
import { signSession } from '../lib/auth.js';

// Read-only smoke test: denied mutations never reach their handlers.
const base = new URL(process.argv[2] || 'http://localhost:3000').origin;
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Use a localhost test server');
const response = await fetch(base);
assert.equal(response.status, 200);
for (const [header, value] of Object.entries({
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
})) assert.equal(response.headers.get(header), value, header);
const csp = response.headers.get('content-security-policy');
const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
assert.ok(nonce, 'Per-request CSP nonce');
assert.ok(!csp.split(';').find(x => x.trim().startsWith('script-src')).includes('unsafe-inline'));
const scripts = [...(await response.text()).matchAll(/<script\b[^>]*>/g)].map(x => x[0]);
assert.ok(scripts.length && scripts.every(s => s.includes(`nonce="${nonce}"`)), 'HTML script nonces match policy');
assert.notEqual(csp, (await fetch(base)).headers.get('content-security-policy'));
console.log('PASS five live headers, unique CSP nonce, matching HTML script nonces');
for (const [origin, status] of [[base, 204], ['https://evil.example', 403], ['*', 403], ['null', 403]]) {
    const result = await fetch(`${base}/api/processing/trigger`, { method: 'OPTIONS', headers: {
        Origin: origin, 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
    } });
    assert.equal(result.status, status);
    if (status === 204) assert.equal(result.headers.get('access-control-allow-origin'), base);
    else assert.equal(result.headers.get('access-control-allow-origin'), null);
}
console.log('PASS exact-origin preflight, rejected wildcard/null/foreign origins');
const token = await signSession({ sub: 'http-security-test', role: 'user' });
for (const [path, options, expected] of [
    ['/api/processing/trigger', { method: 'POST' }, 401],
    ['/api/processing/trigger', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: base } }, 403],
    ['/api/admin/classification/queue', { headers: { Authorization: `Bearer ${token}` } }, 403],
]) assert.equal((await fetch(base + path, options)).status, expected);
console.log('PASS anonymous and insufficient-scope mutations/admin reads denied');
if (process.env.PIPELINE_ADMIN_TOKEN?.length >= 32) {
    const headers = { Authorization: `Bearer ${process.env.PIPELINE_ADMIN_TOKEN}` };
    assert.equal((await fetch(`${base}/api/admin/classification/queue`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/processing/trigger`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(`${base}/api/processing/status`, { headers })).status, 200);
    console.log('PASS pipeline credential bounded to pipeline scope; status read succeeds');
}
