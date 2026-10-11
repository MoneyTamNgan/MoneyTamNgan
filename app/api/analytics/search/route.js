import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { computeSpendAggregates, parseAnalyticsFilter, uniqueProjectsStages } from '@/lib/analytics';
import { parsePositiveInteger } from '@/lib/api/query-params';
import { toTorListItem } from '@/lib/api/tor-response';
import { hydrateProjectsCompatibility } from '@/lib/project-compat';

const MAX_PAGE_SIZE = 100;

function errorResponse(code, message, status = 400) {
    return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * GET /api/analytics/search
 *
 * Public, read-only. Filters: dateFrom, dateTo, agency, budgetMin, budgetMax,
 * category (software | non-software), page, pageSize (default 20, max 100).
 * Aggregates cover every matching project, not just the returned page.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const parsed = parseAnalyticsFilter(searchParams);
    if (parsed.error) return errorResponse(parsed.error.code, parsed.error.message);
    const page = parsePositiveInteger(searchParams.get('page'), 1, 'page');
    const pageSize = parsePositiveInteger(searchParams.get('pageSize'), 20, 'pageSize', MAX_PAGE_SIZE);
    if (page.error) return errorResponse('INVALID_PAGE', page.error);
    if (pageSize.error) return errorResponse('INVALID_PAGE_SIZE', pageSize.error);

    try {
        await connectDB();
        const [aggregates, projects] = await Promise.all([
            computeSpendAggregates(Project, parsed.filter),
            Project.aggregate([
                ...uniqueProjectsStages(parsed.filter),
                { $sort: { 'timeline.announce_date': -1, updated_at: -1, _id: -1 } },
                { $skip: (page.value - 1) * pageSize.value },
                { $limit: pageSize.value },
            ]),
        ]);
        const items = await hydrateProjectsCompatibility(projects);
        return NextResponse.json({
            total: aggregates.projectCount,
            page: page.value,
            pageSize: pageSize.value,
            items: items.map(project => toTorListItem(project)),
            aggregates,
        });
    } catch (error) {
        return errorResponse('ANALYTICS_SEARCH_FAILED', error.message, 500);
    }
}
