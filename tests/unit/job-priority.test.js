import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import ProcessingJob from '../../models/ProcessingJob.js';
import { claimNextJob, enqueueProject } from '../../lib/job-queue.js';

test('native worker dependencies load without a Next bundler, database connection or email delivery', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { notifyUsersOfMatchingTors } from './lib/services/notification-service.js';
        import { refreshProjectFiscalBudget } from './lib/fiscal-backfill.js';
        import { createRecoverySweep } from './lib/processing-recovery.js';
        import { parseSchedule } from './lib/ingestion-schedule.js';
        if ([notifyUsersOfMatchingTors, refreshProjectFiscalBudget, createRecoverySweep, parseSchedule]
            .some(value => typeof value !== 'function')) throw new Error('Missing worker dependency');
    `], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 10000,
        env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:27017/merge-import-only', RESEND_API_KEY: '' } });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('processing jobs outrank candidate verification without bypassing retry availability', async t => {
    const created = [];
    t.mock.method(ProcessingJob, 'findOne', () => ({ lean: async () => null }));
    t.mock.method(ProcessingJob, 'create', async value => { created.push(value); return { toObject: () => value }; });
    await enqueueProject('software');
    await enqueueProject('candidate', { type: 'verify_candidate' });
    assert.equal(created[0].priority, 10);
    assert.equal(created[1].priority, 0);
    t.mock.method(ProcessingJob, 'findOneAndUpdate', async (filter, update, options) => {
        assert.equal(filter.status, 'queued');
        assert.ok(filter.available_at.$lte instanceof Date);
        assert.deepEqual(options.sort, { priority: -1, created_at: 1, _id: 1 });
        assert.equal(update.$inc.attempts, 1);
    });
    await claimNextJob();
});

test('explicit promotion reuses queued job and never resets backoff or a running lease', async t => {
    let job = { _id: 'existing', status: 'queued' };
    const updates = [];
    t.mock.method(ProcessingJob, 'findOne', () => ({ lean: async () => job }));
    t.mock.method(ProcessingJob, 'updateOne', async (...args) => updates.push(args));
    assert.equal((await enqueueProject('p', { priority: 10 })).reused, true);
    assert.deepEqual(updates, [[{ _id: 'existing', status: 'queued' }, { $max: { priority: 10 } }]]);
    job = { ...job, status: 'running' };
    await enqueueProject('p', { priority: 10 });
    assert.equal(updates.length, 1);
    await assert.rejects(enqueueProject('p', { priority: -1 }), /priority/);
});
