import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

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
export async function GET(request) {
    try {
        await connectDB();

        const { searchParams } = new URL(request.url);

        // Pagination
        const page = Math.max(1, parseInt(searchParams.get('page')) || 1);
        const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize')) || 20));
        const skip = (page - 1) * pageSize;

        // Build filter query
        const filter = {};

        // Filter by software classification
        const isSoftware = searchParams.get('isSoftware');
        if (isSoftware !== null && isSoftware !== '') {
            filter.is_software = isSoftware === 'true';
        }

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
        const dateFrom = searchParams.get('dateFrom');
        const dateTo = searchParams.get('dateTo');
        if (dateFrom || dateTo) {
            filter['timeline.announce_date'] = {};
            if (dateFrom) filter['timeline.announce_date'].$gte = new Date(dateFrom);
            if (dateTo) filter['timeline.announce_date'].$lte = new Date(dateTo);
        }

        // Text search on project_name
        const search = searchParams.get('search');
        if (search) {
            filter.project_name = { $regex: search, $options: 'i' };
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

        return NextResponse.json({
            items,
            total,
            page,
            pageSize,
        }, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    } catch (error) {
        return NextResponse.json({
            error: {
                code: 'LIST_PROJECTS_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
