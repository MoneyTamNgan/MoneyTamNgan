import connectDB from '@/lib/db';
import { enqueueProject } from '@/lib/job-queue';
import Project from '@/models/Project';
import DiscoveryCandidate from '@/models/DiscoveryCandidate';
import { recoverPendingProjects } from '@/lib/processing-recovery';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_BATCH_SIZE = 100;

function badRequest(message) {
    return NextResponse.json({
        status: 'failed',
        error: { code: 'INVALID_PROCESSING_REQUEST', message },
    }, { status: 400 });
}

/** POST { projectId?: string, batchSize?: number, scanLimit?: number,
 * afterId?: string, dryRun?: boolean, retryFailed?: boolean }
 * Recovery options apply to bulk requests without projectId/candidateId. */
export async function POST(request) {
    try {
        await connectDB();
        const body = await request.json().catch(() => ({}));
        if ((body.projectId !== undefined || body.candidateId !== undefined)
            && ['dryRun', 'scanLimit', 'afterId', 'retryFailed'].some(key => body[key] !== undefined)) {
            return badRequest('Bulk recovery options require a request without projectId or candidateId');
        }
        const projectId = body.projectId === undefined ? null : String(body.projectId).trim();
        const batchSize = body.batchSize ?? 10;
        if (body.candidateId !== undefined) {
            if (body.projectId !== undefined || typeof body.candidateId !== 'string' || !body.candidateId.trim()) {
                return badRequest('Provide candidateId or projectId, not both');
            }
            const candidateId = body.candidateId.trim();
            if (!await DiscoveryCandidate.exists({ project_id: candidateId })) return badRequest('Candidate does not exist');
            const { job, reused } = await enqueueProject(candidateId, { type: 'verify_candidate' });
            return NextResponse.json({ status: 'accepted', queued: reused ? 0 : 1,
                reused: reused ? 1 : 0, jobs: [{ id: String(job._id), projectId: candidateId,
                    type: 'verify_candidate', status: job.status, reused }] }, { status: 202 });
        }

        if (body.projectId !== undefined && !projectId) {
            return badRequest('projectId must be a non-empty string');
        }
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
            return badRequest(`batchSize must be an integer between 1 and ${MAX_BATCH_SIZE}`);
        }

        let projectIds;
        if (projectId) {
            const exists = await Project.exists({ project_id: projectId });
            if (!exists) return badRequest(`Project ${projectId} does not exist`);
            projectIds = [projectId];
        } else {
            try {
                const recovery = await recoverPendingProjects({ batchSize,
                    scanLimit: body.scanLimit ?? 100, afterId: body.afterId ?? null,
                    dryRun: body.dryRun ?? false, retryFailed: body.retryFailed ?? false });
                return NextResponse.json({ status: 'accepted', ...recovery }, { status: 202 });
            } catch (error) {
                if (error instanceof TypeError) return badRequest(error.message);
                throw error;
            }
        }

        const jobs = [];
        for (const id of projectIds) {
            const { job, reused } = await enqueueProject(id);
            jobs.push({ id: String(job._id), projectId: id, status: job.status, reused });
        }

        return NextResponse.json({
            status: 'accepted',
            queued: jobs.filter(job => !job.reused).length,
            reused: jobs.filter(job => job.reused).length,
            jobs,
        }, { status: 202 });
    } catch (error) {
        return NextResponse.json({
            status: 'failed',
            error: { code: 'PROCESSING_ENQUEUE_FAILED', message: error.message },
        }, { status: 500 });
    }
}
