import ProcessingJob from '../models/ProcessingJob.js';

export async function enqueueProject(projectId, options = {}) {
    const normalized = String(projectId || '').trim();
    if (!normalized) throw new TypeError('projectId is required');
    const type = options.type || 'process_project';
    if (!['process_project', 'verify_candidate'].includes(type)) throw new TypeError('Unsupported job type');
    const priority = options.priority ?? (type === 'process_project' ? 10 : 0);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new TypeError('priority must be an integer from 0 to 100');
    const activeKey = `${type}:${normalized}`;
    const reuse = async job => {
        // Promote only explicit requests; never reset retry backoff or a live lease.
        if (options.priority !== undefined && job.status === 'queued') {
            await ProcessingJob.updateOne({ _id: job._id, status: 'queued' }, { $max: { priority } });
        }
        return { job, reused: true };
    };

    const existing = await ProcessingJob.findOne({
        project_id: normalized,
        type,
        status: { $in: ['queued', 'running'] },
    }).lean();
    if (existing) return reuse(existing);

    try {
        const job = await ProcessingJob.create({
            project_id: normalized,
            type,
            active_key: activeKey,
            priority,
            max_attempts: options.maxAttempts || 3,
        });
        return { job: job.toObject(), reused: false };
    } catch (error) {
        // The unique active_key index closes the race between concurrent API
        // requests that both pass the read-before-create check above.
        if (error?.code !== 11000) throw error;
        const job = await ProcessingJob.findOne({ active_key: activeKey }).lean();
        if (!job) throw error;
        return reuse(job);
    }
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
        sort: { priority: -1, created_at: 1, _id: 1 },
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
        $unset: { active_key: '' },
    });
}

export async function failJob(job, error) {
    const finalFailure = job.attempts >= job.max_attempts;
    const backoffMs = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.max(0, job.attempts - 1)));
    const update = {
        $set: {
            status: finalFailure ? 'failed' : 'queued',
            available_at: new Date(Date.now() + backoffMs),
            lease_until: null,
            error: error.message,
            ...(finalFailure ? { completed_at: new Date() } : {}),
        },
    };
    if (finalFailure) update.$unset = { active_key: '' };
    await ProcessingJob.updateOne({ _id: job._id }, update);
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
