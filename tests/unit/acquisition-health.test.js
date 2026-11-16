import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAcquisitions, recordAcquisitionAttempt } from '../../lib/acquisition-health.js';
const now = new Date('2026-11-16T10:00:00Z');
const rows = statuses => statuses.map((status, i) => ({ status, source: 'worker', run_id: 'run1', completed_at: new Date(+now - i * 1000) }));
test('health does not claim 90% reliability before 20 acquisitions', () => {
    const report = summarizeAcquisitions(rows(['success', 'skipped']), now);
    assert.equal(report.status, 'insufficient_data'); assert.equal(report.attempted, 1); assert.equal(report.skipped, 1);
});
test('health includes per-run counters and exact threshold, exclusions and last success', () => {
    const report = summarizeAcquisitions(rows([...Array(18).fill('success'), 'failed', 'failed']), now);
    assert.equal(report.status, 'healthy'); assert.equal(report.successRate, .9);
    assert.equal(report.byRun.run1.attempted, 20); assert.equal(report.lastSuccessAt.getTime(), now.getTime());
    assert.equal(summarizeAcquisitions(rows([...Array(17).fill('success'), ...Array(3).fill('failed')]), now).status, 'degraded');
});
test('five consecutive failures signal degraded health even with a small sample; stale attempts degrade', () => {
    assert.equal(summarizeAcquisitions(rows(Array(5).fill('failed')), now).status, 'degraded');
    assert.equal(summarizeAcquisitions(rows(['success']), new Date(+now + 25*3600000)).stale, true);
});
test('attempt writes are idempotent and allowlisted, failure logs do not include upstream payload', async t => {
    const writes = [], logs = [];
    t.mock.method(console, 'error', line => logs.push(line));
    const Model = { updateOne: async (...args) => writes.push(args) };
    const input = { attemptKey: 'same-key', projectId: '69000000001', source: 'worker', status: 'failed',
        reasonCode: 'temporary_timeout', startedAt: now, url: 'https://host/?token=SECRET', error: 'person@example.com' };
    await recordAcquisitionAttempt(input, Model); await recordAcquisitionAttempt(input, Model);
    assert.deepEqual(writes[0][0], writes[1][0]); assert.ok(writes[0][1].$setOnInsert);
    assert.doesNotMatch(JSON.stringify(writes)+logs.join(''), /SECRET|person@example/);
});
test('telemetry failure never throws or interrupts processing', async t => {
    t.mock.method(console, 'error', () => {});
    assert.equal(await recordAcquisitionAttempt({ projectId: '69000000001', startedAt: now }, { updateOne: async () => { throw Error('secret'); } }), false);
});

test('a duplicate immutable attempt does not emit a new failure signal', async t => {
    const logs = []; t.mock.method(console, 'error', line => logs.push(line));
    const event = { attemptKey: 'same', projectId: '69000000001', source: 'worker', status: 'failed', reasonCode: 'temporary_timeout', startedAt: now };
    await recordAcquisitionAttempt(event, { updateOne: async () => ({ matchedCount: 1, upsertedCount: 0 }) });
    assert.equal(logs.length, 0);
    await recordAcquisitionAttempt(event, { updateOne: async () => ({ matchedCount: 0, upsertedCount: 1 }) });
    assert.equal(logs.length, 1);
});
