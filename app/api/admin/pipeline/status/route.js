import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { getStatus, resetStatus } from '@/lib/services/pipeline-runner';
import Project from '@/models/Project';

export const runtime = 'nodejs';

/**
 * GET /api/admin/pipeline/status
 *
 * Retrieves the current execution status and progress of the admin data pipeline.
 */
export async function GET() {
    try {
        await connectDB();

        const run = getStatus();

        let dbStats = null;
        try {
            const [totalProjects, withSummary] = await Promise.all([
                Project.countDocuments(),
                Project.countDocuments({ latest_summary_id: { $exists: true } }),
            ]);
            dbStats = { totalProjects, withSummary };
        } catch {
            // Stats are secondary to runner status
        }

        return NextResponse.json({
            status: 'ok',
            run,
            dbStats,
        }, { status: 200 });
    } catch (error) {
        console.error('❌ Failed to get pipeline status:', error);
        return NextResponse.json({
            status: 'failed',
            error: {
                code: 'STATUS_CHECK_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}

/**
 * DELETE /api/admin/pipeline/status
 *
 * Resets the runner state back to idle (useful for clearing failed or stalled state).
 */
export async function DELETE() {
    try {
        const run = resetStatus();
        return NextResponse.json({
            status: 'ok',
            message: 'Pipeline status reset to idle',
            run,
        }, { status: 200 });
    } catch (error) {
        return NextResponse.json({
            status: 'failed',
            error: {
                code: 'STATUS_RESET_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
