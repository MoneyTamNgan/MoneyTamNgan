import { NextResponse } from 'next/server';
import { withRouteSecurity } from '@/lib/route-security';
import connectDB from '@/lib/db';
import { getStatus, resetStatus } from '@/lib/services/pipeline-runner';
import Project from '@/models/Project';

export const runtime = 'nodejs';

/**
 * GET /api/admin/pipeline/status
 *
 * Retrieves the current execution status and progress of the admin data pipeline.
 */
async function handleGET() {
    try {
        await connectDB();

        const run = await getStatus();

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
        console.error(JSON.stringify({ event: 'pipeline_status_error', name: error?.name || 'Error' }));
        return NextResponse.json({
            status: 'failed',
            error: {
                code: 'STATUS_CHECK_FAILED',
                message: 'Pipeline status is unavailable',
            },
        }, { status: 500 });
    }
}

/**
 * DELETE /api/admin/pipeline/status
 *
 * Resets the runner state back to idle (useful for clearing failed or stalled state).
 */
async function handleDELETE() {
    try {
        await connectDB();
        const run = await resetStatus();
        return NextResponse.json({
            status: 'ok',
            message: 'Pipeline status reset to idle',
            run,
        }, { status: 200 });
    } catch (error) {
        if (error.code === 'PIPELINE_ALREADY_RUNNING') return NextResponse.json({ status: 'conflict',
            error: { code: error.code, message: 'An active run cannot be reset' }, currentRun: error.currentRun }, { status: 409 });
        return NextResponse.json({
            status: 'failed',
            error: {
                code: 'STATUS_RESET_FAILED',
                message: 'Pipeline status reset is unavailable',
            },
        }, { status: 500 });
    }
}

export const GET = withRouteSecurity(handleGET, '/api/admin/pipeline/status', 'GET');
export const DELETE = withRouteSecurity(handleDELETE, '/api/admin/pipeline/status', 'DELETE');
