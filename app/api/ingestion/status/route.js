import connectDB from '@/lib/db';
import Project from '@/models/Project';
import DiscoveryCandidate from '@/models/DiscoveryCandidate';
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
        const [candidateCounts, pendingCandidates] = await Promise.all([
            DiscoveryCandidate.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
            DiscoveryCandidate.find({ status: { $in: ['pending', 'review_required', 'not_yet_open'] } })
                .sort({ updated_at: -1 }).limit(20).select('project_id status eligibility classification error updated_at').lean(),
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
