import 'dotenv/config';
import assert from 'node:assert/strict';
import { signSession, SESSION_COOKIE } from '../lib/auth.js';

const origin = process.argv[2] || 'http://localhost:3107';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('HTTP smoke test only supports localhost');
const projectId = '66089621472';
const session = await signSession({ sub: '000000000000000000000001', role: 'admin' });
const headers = { Cookie: `${SESSION_COOKIE}=${session}` };
assert.equal((await fetch(`${origin}/api/processing/trigger`, { method: 'POST', body: '{}' })).status, 401);
console.log('PASS anonymous mutations blocked');
const paths = ['/api/tors?isSoftware=true', `/api/tors/${projectId}`, `/api/tors/${projectId}/summary`,
    `/api/tors/${projectId}/anomalies`, `/api/projects/${projectId}`, `/api/processing/status?projectId=${projectId}`,
    '/api/processing/review', '/api/ingestion/status', '/admin', '/analytics', `/tors/${projectId}`, `/tors/${projectId}/document`];
for (const endpoint of paths) {
    const response = await fetch(`${origin}${endpoint}`, { headers, redirect: 'manual' });
    assert.equal(response.status, 200, `${endpoint}: ${response.status}`);
    const text = await response.text();
    if (endpoint === `/api/tors/${projectId}`) {
        const detail = JSON.parse(text);
        assert.equal(detail.fiscalBudget.year, 2565);
        assert.ok(detail.summary);
    }
    if (endpoint === `/tors/${projectId}`) assert.ok(text.includes('ปีงบประมาณ') && text.includes('2565'));
    if (endpoint === '/admin' || endpoint === '/analytics') assert.ok(text.includes('E2E fixture'));
    console.log(`PASS ${endpoint}`);
}
if (process.argv.includes('--queue')) {
    let first;
    for (let index = 0; index < 2; index++) {
        const response = await fetch(`${origin}/api/processing/trigger`, { method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
        assert.equal(response.status, 202);
        const result = await response.json();
        if (!index) first = result.jobs[0].id;
        else { assert.equal(result.jobs[0].id, first); assert.equal(result.reused, 1); }
    }
    console.log(`PASS real HTTP enqueue and duplicate prevention: ${first}`);
}
