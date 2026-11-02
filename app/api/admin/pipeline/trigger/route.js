import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { getStatus, triggerPipeline } from '@/lib/services/pipeline-runner';

export const runtime = 'nodejs';
export const maxDuration = 300;

function badRequest(message) {
    return NextResponse.json({
        status: 'failed',
        error: { code: 'INVALID_PIPELINE_REQUEST', message },
    }, { status: 400 });
}

/**
 * POST /api/admin/pipeline/trigger
 *
 * Triggers the full end-to-end data pipeline from start to finish:
 * 1. Open tender RSS discovery & software keyword classification
 * 2. TOR & Announcement dual-document acquisition (Hybrid P5)
 * 3. Text extraction, Thai OCR & Vertex AI summarization & risk scoring
 * 4. Contractor skill matching & notification dispatch
 *
 * Body (optional):
 *   {
 *     limit?: number,         // Max tenders to process (default: 5, max: 50)
 *     depts?: string[],       // Array of 4-digit RSS department IDs
 *     projectIds?: string[],  // Specific project IDs to process
 *     allowBrowser?: boolean, // Enable Puppeteer fallback (default: true)
 *     sync?: boolean          // Wait for pipeline completion (default: false)
 *   }
 */
export async function POST(request) {
    try {
        await connectDB();

        let body = {};
        try {
            body = await request.json();
        } catch {
            // Empty body is valid, defaults used
        }

        const { limit = 5, depts, projectIds, allowBrowser = true, sync = false, force = false, tenders } = body;

        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            return badRequest('limit must be an integer between 1 and 50');
        }

        if (depts !== undefined && (!Array.isArray(depts) || depts.some(d => typeof d !== 'string'))) {
            return badRequest('depts must be an array of department ID strings');
        }

        if (projectIds !== undefined && (!Array.isArray(projectIds) || projectIds.some(id => typeof id !== 'string'))) {
            return badRequest('projectIds must be an array of project ID strings');
        }

        if (typeof allowBrowser !== 'boolean' || typeof sync !== 'boolean' || typeof force !== 'boolean') {
            return badRequest('allowBrowser, sync, and force must be booleans');
        }

        const currentStatus = getStatus();
        if (currentStatus.status === 'running') {
            return NextResponse.json({
                status: 'conflict',
                error: {
                    code: 'PIPELINE_ALREADY_RUNNING',
                    message: 'A data pipeline run is already in progress',
                },
                currentRun: currentStatus,
            }, { status: 409 });
        }

        if (sync) {
            const result = await triggerPipeline({
                limit,
                depts,
                projectIds,
                tenders,
                allowBrowser,
                sync: true,
                force,
            });

            return NextResponse.json({
                status: 'completed',
                runId: result.id,
                summary: result.summary,
                completedAt: result.completedAt,
                run: result,
            }, { status: 200 });
        }

        const run = triggerPipeline({
            limit,
            depts,
            projectIds,
            tenders,
            allowBrowser,
            sync: false,
            force,
        });

        return NextResponse.json({
            status: 'accepted',
            runId: run.id,
            message: 'Data pipeline run started in background',
            statusUrl: '/api/admin/pipeline/status',
            run,
        }, { status: 202 });
    } catch (error) {
        if (error.code === 'PIPELINE_ALREADY_RUNNING') {
            return NextResponse.json({
                status: 'conflict',
                error: {
                    code: 'PIPELINE_ALREADY_RUNNING',
                    message: error.message,
                },
                currentRun: getStatus(),
            }, { status: 409 });
        }

        console.error('❌ Failed to trigger admin pipeline:', error);
        return NextResponse.json({
            status: 'failed',
            error: {
                code: 'PIPELINE_TRIGGER_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
