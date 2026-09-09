import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { toTorSummary } from '@/lib/api/tor-response';

/** GET /api/tors/{id}/summary */
export async function GET(_request, { params }) {
    const { id } = await params;
    const projectId = typeof id === 'string' ? id.trim() : '';

    if (!projectId) {
        return NextResponse.json({
            error: { code: 'INVALID_TOR_ID', message: 'TOR id is required' },
        }, { status: 400 });
    }

    try {
        await connectDB();
        const project = await Project.findOne({ project_id: projectId }).lean();

        if (!project) {
            return NextResponse.json({
                error: { code: 'TOR_NOT_FOUND', message: `No TOR exists with id: ${projectId}` },
            }, { status: 404 });
        }

        return NextResponse.json(toTorSummary(project));
    } catch (error) {
        return NextResponse.json({
            error: { code: 'GET_TOR_SUMMARY_FAILED', message: error.message },
        }, { status: 500 });
    }
}
