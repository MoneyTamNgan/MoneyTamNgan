import assert from 'node:assert/strict';
import test from 'node:test';
import { describeEgpHttpFailure, fetchFromEGP, probeEgpEdge } from '../../lib/egp-api.js';
import { isTransientError } from '../../lib/ingestion-schedule.js';

const SECURITY_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Access Denied</title>
    <style>body { color: #333; }</style>
</head>
<body>
    <h1>Access Denied</h1>
    <p>Your request has been blocked by our security systems.</p>
    <p><strong>Ray ID:</strong> a5d67afbe81e5332</p>
    <p><strong>IP Address:</strong> 203.0.113.10</p>
    <p>reflected api-key test-secret-key</p>
</body>
</html>`;

function withKey(t) {
    const old = process.env.EGP_API_KEY;
    process.env.EGP_API_KEY = 'test-secret-key';
    t.after(() => {
        if (old === undefined) delete process.env.EGP_API_KEY;
        else process.env.EGP_API_KEY = old;
    });
}

test('Cloudflare Access Denied is an edge block, not a bad API key', () => {
    const described = describeEgpHttpFailure({
        status: 403,
        statusText: 'Forbidden',
        body: SECURITY_PAGE,
        apiKey: 'test-secret-key',
    });
    assert.equal(described.code, 'EGP_UPSTREAM_BLOCKED');
    assert.equal(described.retryable, false);
    assert.equal(described.rayId, 'a5d67afbe81e5332');
    assert.match(described.message, /before the API key was checked/);
    assert.match(described.message, /Ray ID a5d67afbe81e5332/);
    assert.match(described.message, /client IP 203\.0\.113\.10/);
    assert.equal(described.message.includes('test-secret-key'), false);
    assert.equal(isTransientError(Object.assign(new Error(described.message), described)), false);
});

test('a JSON 403 that names the key is an auth failure', () => {
    const described = describeEgpHttpFailure({
        status: 403,
        statusText: 'Forbidden',
        body: JSON.stringify({ success: false, message: 'Invalid API Key test-secret-key' }),
        apiKey: 'test-secret-key',
    });
    assert.equal(described.code, 'EGP_AUTH_FAILED');
    assert.equal(described.retryable, false);
    assert.match(described.message, /Rotate the EGP_API_KEY/);
    assert.match(described.message, /\[REDACTED\]/);
    assert.equal(described.message.includes('test-secret-key'), false);
});

test('Cloudflare 502 stays a transient upstream failure', () => {
    const body = JSON.stringify({
        type: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-502/',
        title: 'Error 502: Bad gateway',
        status: 502,
        detail: 'The origin web server returned an invalid response',
    });
    const described = describeEgpHttpFailure({ status: 502, statusText: 'Bad Gateway', body });
    assert.equal(described.code, 'EGP_UPSTREAM_UNAVAILABLE');
    assert.equal(described.retryable, undefined);
    assert.equal(isTransientError(Object.assign(new Error(described.message), { status: 502 })), true);
});

test('fetchFromEGP reports a security block without retrying or leaking the key', async t => {
    withKey(t);
    t.mock.method(globalThis, 'fetch', async () => new Response(SECURITY_PAGE, {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    }));
    await assert.rejects(fetchFromEGP({ year: '2570', limit: 1 }), error => {
        assert.equal(error.code, 'EGP_UPSTREAM_BLOCKED');
        assert.equal(error.status, 403);
        assert.equal(error.retryable, false);
        assert.equal(error.message.includes('test-secret-key'), false);
        assert.equal(isTransientError(error), false);
        return true;
    });
});

test('edge probe fails only on the Cloudflare page', async () => {
    const blocked = await probeEgpEdge({
        fetchImpl: async () => new Response(SECURITY_PAGE, { status: 403, statusText: 'Forbidden' }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'EGP_UPSTREAM_BLOCKED');

    const missingKey = await probeEgpEdge({
        fetchImpl: async () => new Response(JSON.stringify({ success: false, message: 'Invalid API Key' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        }),
    });
    assert.equal(missingKey.ok, true);
    assert.equal(missingKey.status, 401);

    const offline = await probeEgpEdge({
        fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); },
    });
    assert.equal(offline.ok, true);
    assert.equal(offline.skipped, true);
});
