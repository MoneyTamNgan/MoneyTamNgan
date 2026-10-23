import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { enqueueProject } from '@/lib/job-queue';
import { NextResponse } from 'next/server';

export async function PATCH(request, { params }) {
    try {
        await connectDB();
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        if (typeof body.isSoftware !== 'boolean') {
            return NextResponse.json({
                error: { code: 'INVALID_CLASSIFICATION', message: 'isSoftware must be a boolean' },
            }, { status: 400 });
        }

        const project = await Project.findOneAndUpdate({ project_id: id }, {
            $set: {
                is_software: body.isSoftware,
                'classification.status': 'manual_override',
                'classification.confidence': 1,
                'classification.method': 'manual',
                'classification.classified_at': new Date(),
                'classification.reason': String(body.reason || 'Manual review').slice(0, 1000),
                'processing.status': body.isSoftware ? 'document_pending' : 'irrelevant',
                'processing.error': null,
                'workflow.status': body.isSoftware ? 'document_pending' : 'irrelevant',
                'workflow.error': null,
                'workflow.updated_at': new Date(),
            },
        }, { returnDocument: 'after', runValidators: true }).lean();

        if (!project) {
            return NextResponse.json({
                error: { code: 'PROJECT_NOT_FOUND', message: `No project exists with id: ${id}` },
            }, { status: 404 });
        }
        // Software approval schedules work; the worker still verifies current
        // open bidding before any new acquisition. Repeated approval reuses an
        // active job rather than downloading/OCRing inside this HTTP request.
        if (body.isSoftware) {
            try { await enqueueProject(id); }
            catch (error) {
                return NextResponse.json({ classificationSaved: true, projectId: id,
                    error: { code: 'CLASSIFICATION_ENQUEUE_FAILED',
                        message: 'Software approval was saved, but processing could not be queued. Retry this request; active jobs are deduplicated.' },
                }, { status: 503 });
            }
        }
        return NextResponse.json(project);
    } catch (error) {
        return NextResponse.json({
            error: { code: 'CLASSIFICATION_UPDATE_FAILED', message: error.message },
        }, { status: 500 });
    }
}
