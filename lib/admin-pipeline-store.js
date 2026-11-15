import State from '../models/AdminPipelineState.js';
import Audit from '../models/PipelineTriggerAudit.js';
import { logPipelineAudit } from './admin-pipeline-audit.js';

const key = 'admin_pipeline';
const owned = (owner, now) => ({ _id: key, owner, 'run.status': 'running', lease_until: { $gt: now } });

export const pipelineStore = {
    async recover(now) {
        await State.updateOne({ _id: key, 'run.status': 'running', $or: [{ lease_until: { $lte: now } }, { lease_until: null }] }, {
            $set: { 'run.status': 'failed', 'run.phase': 'failed', 'run.completedAt': now.toISOString(),
                'run.error': 'Pipeline lease expired after interruption; retry is allowed',
                'run.errorCode': 'PIPELINE_INTERRUPTED', 'run.progress.stage': 'failed',
                'run.progress.message': 'Pipeline interrupted; lease expired' },
            $unset: { owner: '', lease_until: '' },
        });
    },
    async read() { return (await State.findById(key).lean())?.run || null; },
    async claim(run, owner, now, leaseUntil) {
        try {
            await State.findOneAndUpdate({ _id: key, 'run.status': { $ne: 'running' } }, {
                $set: { run, owner, lease_until: leaseUntil },
            }, { upsert: true, returnDocument: 'after' }).lean();
            return true;
        } catch (error) { if (error.code === 11000) return false; throw error; }
    },
    async renew(owner, run, now, leaseUntil) {
        return Boolean((await State.updateOne(owned(owner, now), { $set: { run, lease_until: leaseUntil } })).matchedCount);
    },
    async finish(owner, run, now) {
        return Boolean((await State.updateOne(owned(owner, now), {
            $set: { run }, $unset: { owner: '', lease_until: '' },
        })).matchedCount);
    },
    async reset() {
        return (await State.findOneAndUpdate({ _id: key, 'run.status': { $ne: 'running' } }, {
            $set: { 'run.status': 'idle', 'run.phase': 'idle',
                'run.progress': { current: 0, total: 0, percent: 0, stage: 'idle', message: 'Pipeline ready' },
                'run.error': null, 'run.errorCode': null },
        }, { returnDocument: 'after' }).lean())?.run || null;
    },
    async audit(event) { await Audit.create(event); logPipelineAudit(event); },
};
