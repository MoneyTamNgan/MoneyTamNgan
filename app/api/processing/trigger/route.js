import connectDB from '@/lib/db';
import { enqueueProject } from '@/lib/job-queue';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_BATCH_SIZE = 100;

function badRequest(message) {
    return NextResponse.json({
        status: 'failed',
        error: { code: 'INVALID_PROCESSING_REQUEST', message },
    }, { status: 400 });
}

/** POST { projectId?: string, batchSize?: number } */
export async function POST(request) {
    try {
        await connectDB();
        const body = await request.json().catch(() => ({}));
        const projectId = body.projectId === undefined ? null : String(body.projectId).trim();
        const batchSize = body.batchSize ?? 10;

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
            const projects = await Project.find({
                'classification.status': { $ne: 'not_software' },
                $or: [
                    { 'processing.status': { $exists: false } },
                    {
                        'processing.status': {
                            $in: [
                                'metadata_ingested', 'classification_pending', 'document_pending',
                                'metadata_only', 'retry_pending', 'failed',
                            ],
                        },
                    },
                ],
            }).select('project_id').limit(batchSize).lean();
            projectIds = projects.map(project => project.project_id);
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
