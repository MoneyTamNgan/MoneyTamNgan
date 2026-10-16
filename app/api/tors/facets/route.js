import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';

const CURRENT_TENDER_FILTER = { tender: { $exists: true, $ne: null } };

/**
 * GET /api/tors/facets
 *
 * Returns the complete, de-duplicated agency list for dashboard filters.
 * This deliberately is not constrained by the current list page/limit.
 */
export async function GET(request) {
    try {
        const isSoftware = new URL(request.url).searchParams.get('isSoftware');
        if (isSoftware !== null && isSoftware !== 'true' && isSoftware !== 'false') {
            return NextResponse.json({
                error: { code: 'INVALID_IS_SOFTWARE', message: 'isSoftware must be true or false' },
            }, { status: 400 });
        }

        await connectDB();
        const filter = isSoftware === null ? {} : { is_software: isSoftware === 'true' };

        const [agencies, totalResult] = await Promise.all([
            Project.aggregate([
                { $match: filter },
                { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
                { $group: { _id: '$project_id', project: { $first: '$$ROOT' } } },
                { $replaceRoot: { newRoot: '$project' } },
                { $match: CURRENT_TENDER_FILTER },
                { $group: { _id: '$dept_name', count: { $sum: 1 } } },
                { $match: { _id: { $type: 'string', $ne: '' } } },
                { $sort: { _id: 1 } },
            ]),
            Project.aggregate([
                { $match: filter },
                { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
                { $group: { _id: '$project_id', project: { $first: '$$ROOT' } } },
                // Keep the total aligned with the list and agency facets:
                // only current-schema records with a tender object count.
                { $replaceRoot: { newRoot: '$project' } },
                { $match: CURRENT_TENDER_FILTER },
                { $count: 'total' },
            ]),
        ]);

        return NextResponse.json({
            status: 'success',
            total: totalResult[0]?.total ?? 0,
            agencies: agencies.map(({ _id, count }) => ({ name: _id, count })),
        });
    } catch (error) {
        return NextResponse.json({
            error: { code: 'LIST_TOR_FACETS_FAILED', message: error.message },
        }, { status: 500 });
    }
}
