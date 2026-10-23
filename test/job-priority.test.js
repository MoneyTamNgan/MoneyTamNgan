import test from 'node:test';
import assert from 'node:assert/strict';
import ProcessingJob from '../models/ProcessingJob.js';
import { claimNextJob, enqueueProject } from '../lib/job-queue.js';

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
