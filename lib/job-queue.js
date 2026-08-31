import ProcessingJob from '../models/ProcessingJob.js';

export async function enqueueProject(projectId, options = {}) {
    const normalized = String(projectId || '').trim();
    if (!normalized) throw new TypeError('projectId is required');

    const existing = await ProcessingJob.findOne({
        project_id: normalized,
        type: 'process_project',
        status: { $in: ['queued', 'running'] },
    }).lean();
    if (existing) return { job: existing, reused: true };

    const job = await ProcessingJob.create({
        project_id: normalized,
        max_attempts: options.maxAttempts || 3,
    });
    return { job: job.toObject(), reused: false };
}

export async function claimNextJob(leaseMs = 10 * 60 * 1000) {
    const now = new Date();
    return ProcessingJob.findOneAndUpdate({
        status: 'queued',
        available_at: { $lte: now },
    }, {
        $set: {
            status: 'running',
            lease_until: new Date(now.getTime() + leaseMs),
            started_at: now,
            error: null,
        },
        $inc: { attempts: 1 },
    }, {
        returnDocument: 'after',
        sort: { created_at: 1 },
    });
}

export async function completeJob(jobId, result) {
    return ProcessingJob.updateOne({ _id: jobId }, {
        $set: {
            status: 'completed',
            result,
            completed_at: new Date(),
            lease_until: null,
            error: null,
        },
    });
}

export async function failJob(job, error) {
    const finalFailure = job.attempts >= job.max_attempts;
    const backoffMs = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, job.attempts - 1)));
    await ProcessingJob.updateOne({ _id: job._id }, {
        $set: {
            status: finalFailure ? 'failed' : 'queued',
            available_at: new Date(Date.now() + backoffMs),
            lease_until: null,
            error: error.message,
            ...(finalFailure ? { completed_at: new Date() } : {}),
        },
    });
    return { finalFailure };
}

export async function requeueExpiredJobs() {
    return ProcessingJob.updateMany({
        status: 'running',
        lease_until: { $lt: new Date() },
    }, {
        $set: { status: 'queued', available_at: new Date(), lease_until: null },
    });
}
