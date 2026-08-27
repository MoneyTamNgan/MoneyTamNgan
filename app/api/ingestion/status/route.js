import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

/**
 * GET /api/ingestion/status
 *
 * Returns the current ingestion status:
 * - Total number of projects in the database
 * - Timestamp of the most recently ingested project
 */
export async function GET() {
    try {
        await connectDB();

        const totalProjects = await Project.countDocuments();

        // Find the most recently updated project
        const lastProject = await Project.findOne()
            .sort({ updated_at: -1 })
            .select('updated_at project_id')
            .lean();

        return NextResponse.json({
            status: 'ok',
            totalProjects,
            lastIngestedAt: lastProject?.updated_at || null,
            lastProjectId: lastProject?.project_id || null,
        });
    } catch (error) {
        return NextResponse.json({
            status: 'error',
            error: {
                code: 'STATUS_CHECK_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
