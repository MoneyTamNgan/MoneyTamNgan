import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { planProjectRecovery, recoverPendingProjects, createRecoverySweep } from '../lib/processing-recovery.js';

const row = (n, fields = {}) => ({ _id: new mongoose.Types.ObjectId(n.toString(16).padStart(24, '0')),
    project_id: String(n), project_name: 'พัฒนาระบบสารสนเทศ',
    processing: { status: 'metadata_ingested' }, ...fields });
const query = value => ({ sort() { return this; }, lean: async () => value });
function fixtures(rows, jobs = []) {
    const writes = [];
    return { writes, dependencies: {
        loadKeywords: async options => { assert.equal(options.seed, false); return {}; },
        ProjectModel: { find: filter => {
            let limit;
            return { sort() { return this; }, limit(n) { limit = n; return this; },
                lean: async () => rows.filter(p => !filter._id || String(p._id) < String(filter._id.$lt)).slice(0, limit) };
        } },
        JobModel: { findOne: filter => query(jobs.find(job => job.project_id === filter.project_id
            && (!filter.status || filter.status.$in.includes(job.status)))) },
        enqueue: async id => {
            writes.push(id);
            const job = { _id: `job-${id}`, project_id: id, status: 'queued' };
            jobs.push(job);
            return { job, reused: false };
        },
    } };
}

test('recovery includes downloaded PDFs, verifies metadata, and never queues non-software or closed acquisition', () => {
    assert.equal(planProjectRecovery(row(1)).stage, 'verify_and_acquire');
    assert.equal(planProjectRecovery(row(1, { primary_document_id: 'doc', processing: { status: 'document_downloaded' } })).stage, 'resume_document');
    assert.equal(planProjectRecovery(row(1, { project_status: 'Cancelled' })).reason, 'closed_procurement');
    assert.equal(planProjectRecovery(row(1, { project_name: 'ก่อสร้างอาคาร' })).reason, 'not_software');
    assert.equal(planProjectRecovery(row(1, { project_name: 'รายการทดสอบ' })).reason, 'uncertain_software');
    assert.equal(planProjectRecovery(row(1, { is_software: false, classification: { status: 'manual_override' } })).reason, 'not_software');
});

test('durable OCR resumes Vertex after closure without acquiring new PDFs; disabled Vertex waits', () => {
    const project = row(1, { project_status: 'Closed', primary_document_id: 'doc', latest_extraction_run_id: 'run' });
    assert.equal(planProjectRecovery(project, { vertexEnabled: true }).stage, 'resume_vertex');
    assert.equal(planProjectRecovery(project).reason, 'vertex_disabled');
    assert.equal(planProjectRecovery({ ...project, latest_summary_id: 'summary' }).reason, 'already_summarized');
    assert.equal(planProjectRecovery({ ...project, processing: { status: 'review_required' } }).reason, 'manual_review_or_terminal');
});

test('dry-run reads keyword rules without seeding and writes nothing', async () => {
    const { writes, dependencies } = fixtures([row(2), row(1)]);
    const result = await recoverPendingProjects({}, dependencies);
    assert.equal(result.wouldQueue, 2);
    assert.equal(result.queued, 0);
    assert.deepEqual(writes, []);
});

test('repeated catch-up reuses active jobs and continues past them, without starving older records', async () => {
    const { writes, dependencies } = fixtures([row(3), row(2), row(1)]);
    const first = await recoverPendingProjects({ dryRun: false, batchSize: 1 }, dependencies);
    const next = await recoverPendingProjects({ dryRun: false, batchSize: 1 }, dependencies);
    const older = await recoverPendingProjects({ dryRun: false, batchSize: 1, afterId: next.nextAfterId }, dependencies);
    assert.equal(first.queued, 1);
    assert.equal(next.reused, 1);
    assert.equal(older.queued, 1);
    assert.deepEqual(writes, ['3', '2', '1']);
});

test('terminal failures require explicit retry; recently completed attempts respect cooldown', async () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const { dependencies } = fixtures([row(3), row(2), row(1)], [
        { project_id: '3', status: 'failed' },
        { project_id: '2', status: 'completed', completed_at: now },
    ]);
    const result = await recoverPendingProjects({ now }, dependencies);
    assert.equal(result.skipped.failed_requires_explicit_retry, 1);
    assert.equal(result.skipped.recently_attempted, 1);
    assert.equal(result.wouldQueue, 1);
    const retry = await recoverPendingProjects({ now, retryFailed: true }, dependencies);
    assert.equal(retry.wouldQueue, 3);
});

test('enabling Vertex resumes ai_pending immediately, without waiting for cooldown', async () => {
    const project = row(1, { primary_document_id: 'doc', latest_extraction_run_id: 'run', processing: { status: 'ai_pending' } });
    const { dependencies } = fixtures([project], [{ project_id: '1', status: 'completed',
        completed_at: new Date(), result: { status: 'ai_pending' } }]);
    const result = await recoverPendingProjects({ vertexEnabled: true }, dependencies);
    assert.equal(result.wouldQueue, 1);
});

test('one enqueue failure does not abort other projects or lose diagnostic details', async () => {
    const { dependencies } = fixtures([row(2), row(1)]);
    const enqueue = dependencies.enqueue;
    dependencies.enqueue = async id => { if (id === '2') throw new Error('queue unavailable'); return enqueue(id); };
    const result = await recoverPendingProjects({ dryRun: false }, dependencies);
    assert.equal(result.failed, 1);
    assert.equal(result.queued, 1);
    assert.equal(result.entries[0].reason, 'queue unavailable');
});

test('recovery validates bounds and cursors before any database scan', async () => {
    for (const options of [{ batchSize: 0 }, { scanLimit: 1001 }, { afterId: 'bad' }, { dryRun: 'yes' }, { retryFailed: 'yes' }]) {
        await assert.rejects(recoverPendingProjects(options), TypeError);
    }
});

test('idle sweep spaces scans, advances cursors and resets after a complete pass', async () => {
    const calls = [];
    const sweep = createRecoverySweep({ intervalMs: 1000 }, { recover: async options => {
        calls.push(options);
        return { queued: 0, exhausted: calls.length === 2, nextAfterId: String(row(1)._id) };
    } });
    await sweep(0);
    assert.equal(await sweep(999), null);
    await sweep(1000);
    await sweep(2000);
    assert.equal(calls[0].afterId, null);
    assert.equal(calls[1].afterId, String(row(1)._id));
    assert.equal(calls[2].afterId, null);
});
