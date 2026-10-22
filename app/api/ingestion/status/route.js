import connectDB from '@/lib/db';
import Project from '@/models/Project';
import DiscoveryCandidate from '@/models/DiscoveryCandidate';
import IngestionRun from '@/models/IngestionRun';
import { ingestionScheduleConfig, nextRunAt } from '@/lib/ingestion-schedule';
import { NextResponse } from 'next/server';

/**
 * GET /api/ingestion/status
 *
 * Returns the current ingestion status:
 * - Total number of projects in the database
 * - Timestamp of the most recently ingested project
 * - Automated run history and the next scheduled run (FR-1.1.1)
 */

const RUN_FIELDS = 'scheduled_for trigger status attempts max_retries started_at finished_at next_retry_at '
    + 'fetched_count stored_count scraped_count last_error failure_reason';

function scheduleInfo() {
    try {
        const { spec, schedule, timeZone } = ingestionScheduleConfig();
        return { spec, timeZone, nextRunAt: nextRunAt(schedule, new Date(), timeZone) };
    } catch (error) {
        return { error: error.message };
    }
}
export async function GET() {
    try {
        await connectDB();

        const totalProjects = await Project.countDocuments();
        const [candidateCounts, pendingCandidates, recentRuns] = await Promise.all([
            DiscoveryCandidate.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
            DiscoveryCandidate.find({ status: { $in: ['pending', 'review_required', 'not_yet_open'] } })
                .sort({ updated_at: -1 }).limit(20).select('project_id status eligibility classification error updated_at').lean(),
            IngestionRun.find().sort({ scheduled_for: -1 }).limit(10).select(RUN_FIELDS).lean(),
        ]);

        // Find the most recently updated project
        const lastProject = await Project.findOne()
            .sort({ updated_at: -1 })
            .select('updated_at project_id')
            .lean();

        return NextResponse.json({
            status: 'ok',
            totalProjects,
            candidates: Object.fromEntries(candidateCounts.map(item => [item._id, item.count])),
            pendingCandidates,
            lastIngestedAt: lastProject?.updated_at || null,
            lastProjectId: lastProject?.project_id || null,
            schedule: scheduleInfo(),
            lastRun: recentRuns[0] || null,
            recentRuns,
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
