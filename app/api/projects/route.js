import { withRouteSecurity } from "@/lib/route-security";
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { hydrateProjectsCompatibility } from '@/lib/project-compat';
import { parseDate } from '@/lib/api/query-params';
import { NextResponse } from 'next/server';

const MAX_SEARCH_LENGTH = 200;

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * GET /api/projects
 *
 * List and filter projects with pagination.
 *
 * Query params:
 *   - page (default: 1)
 *   - pageSize (default: 20, max: 100)
 *   - isSoftware (boolean filter)
 *   - agency (exact match on dept_name)
 *   - status (project_status filter)
 *   - dateFrom (ISO date, lower bound on timeline.announce_date)
 *   - dateTo (ISO date, upper bound on timeline.announce_date)
 *   - search (text search on project_name)
 */
async function handleGET(request) {
    try {
        const { searchParams } = new URL(request.url);

        // Validate software classification filter
        const isSoftware = searchParams.get('isSoftware');
        if (isSoftware !== null && isSoftware !== '' && isSoftware !== 'true' && isSoftware !== 'false') {
            return NextResponse.json({
                error: { code: 'INVALID_IS_SOFTWARE', message: 'isSoftware must be true or false' },
            }, { status: 400 });
        }

        // Validate date range parameters
        const dateFromResult = parseDate(searchParams.get('dateFrom'), 'dateFrom');
        const dateToResult = parseDate(searchParams.get('dateTo'), 'dateTo', true);
        if (dateFromResult.error || dateToResult.error) {
            return NextResponse.json({
                error: { code: 'INVALID_DATE_RANGE', message: 'Invalid dateFrom or dateTo parameter' },
            }, { status: 400 });
        }
        if (dateFromResult.value && dateToResult.value && dateFromResult.value > dateToResult.value) {
            return NextResponse.json({
                error: { code: 'INVALID_DATE_RANGE', message: 'Invalid dateFrom or dateTo parameter' },
            }, { status: 400 });
        }

        // Validate search text length
        const rawSearch = searchParams.get('search');
        const search = rawSearch ? rawSearch.trim() : '';
        if (search.length > MAX_SEARCH_LENGTH) {
            return NextResponse.json({
                error: { code: 'INVALID_SEARCH', message: 'search must not exceed 200 characters' },
            }, { status: 400 });
        }

        await connectDB();

        // Pagination
        const page = Math.max(1, parseInt(searchParams.get('page')) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize')) || 20));
        const skip = (page - 1) * pageSize;

        // Build filter query
        const filter = {};

        if (isSoftware === 'true') filter.is_software = true;
        if (isSoftware === 'false') filter.is_software = false;

        // Filter by agency (department name)
        const agency = searchParams.get('agency');
        if (agency) {
            filter.dept_name = agency;
        }

        // Filter by project status
        const status = searchParams.get('status');
        if (status) {
            filter.project_status = status;
        }

        // Filter by date range (announce_date)
        if (dateFromResult.value || dateToResult.value) {
            filter['timeline.announce_date'] = {};
            if (dateFromResult.value) filter['timeline.announce_date'].$gte = dateFromResult.value;
            if (dateToResult.value) filter['timeline.announce_date'].$lte = dateToResult.value;
        }

        // Escaped text search on project_name (prevents ReDoS / operator injection)
        if (search) {
            filter.project_name = { $regex: escapeRegex(search), $options: 'i' };
        }

        // Execute query
        const [items, total] = await Promise.all([
            Project.find(filter)
                .sort({ updated_at: -1 })
                .skip(skip)
                .limit(pageSize)
                .lean(),
            Project.countDocuments(filter),
        ]);

        const compatibleItems = await hydrateProjectsCompatibility(items);
        return NextResponse.json({
            items: compatibleItems,
            total,
            page,
            pageSize,
        }, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    } catch {
        return NextResponse.json({
            error: {
                code: 'LIST_PROJECTS_FAILED',
                message: 'Failed to list projects',
            },
        }, { status: 500 });
    }
}

export const GET = withRouteSecurity(handleGET, "/api/projects", "GET");
