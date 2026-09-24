import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { toTorListItem } from '@/lib/api/tor-response';
import { hydrateProjectsCompatibility } from '@/lib/project-compat';

const MAX_LIMIT = 100;

function errorResponse(code, message, status = 400) {
    return NextResponse.json({ error: { code, message } }, { status });
}

export function parsePositiveInteger(value, fallback, name, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === '') return { value: fallback };
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
        return { error: `${name} must be an integer between 1 and ${max}` };
    }
    return { value: parsed };
}

export function parseNonNegativeNumber(value, name) {
    if (value === null || value === '') return { value: null };
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return { error: `${name} must be a non-negative number` };
    }
    return { value: parsed };
}

export function parseDate(value, name, endOfDay = false) {
    if (!value) return { value: null };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { error: `${name} must be a valid ISO 8601 date` };
    }
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        parsed.setUTCHours(23, 59, 59, 999);
    }
    return { value: parsed };
}

/**
 * GET /api/tors
 *
 * Query parameters:
 * - page (default: 1)
 * - limit (default: 10, maximum: 100)
 * - isSoftware (true or false)
 * - agency (exact department name)
 * - status (exact project status)
 * - dateFrom / dateTo (inclusive announce-date range)
 * - q (full-text search across project title, agency, and extracted tech stack)
 * - budgetMin / budgetMax (inclusive budget range)
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const pageResult = parsePositiveInteger(searchParams.get('page'), 1, 'page');
    const limitResult = parsePositiveInteger(searchParams.get('limit'), 10, 'limit', MAX_LIMIT);

    if (pageResult.error) return errorResponse('INVALID_PAGE', pageResult.error);
    if (limitResult.error) return errorResponse('INVALID_LIMIT', limitResult.error);

    const isSoftware = searchParams.get('isSoftware');
    if (isSoftware !== null && isSoftware !== '' && isSoftware !== 'true' && isSoftware !== 'false') {
        return errorResponse('INVALID_IS_SOFTWARE', 'isSoftware must be true or false');
    }

    const dateFromResult = parseDate(searchParams.get('dateFrom'), 'dateFrom');
    const dateToResult = parseDate(searchParams.get('dateTo'), 'dateTo', true);
    if (dateFromResult.error) return errorResponse('INVALID_DATE_FROM', dateFromResult.error);
    if (dateToResult.error) return errorResponse('INVALID_DATE_TO', dateToResult.error);
    if (dateFromResult.value && dateToResult.value && dateFromResult.value > dateToResult.value) {
        return errorResponse('INVALID_DATE_RANGE', 'dateFrom must be on or before dateTo');
    }

    const budgetMinResult = parseNonNegativeNumber(searchParams.get('budgetMin'), 'budgetMin');
    const budgetMaxResult = parseNonNegativeNumber(searchParams.get('budgetMax'), 'budgetMax');
    if (budgetMinResult.error) return errorResponse('INVALID_BUDGET_MIN', budgetMinResult.error);
    if (budgetMaxResult.error) return errorResponse('INVALID_BUDGET_MAX', budgetMaxResult.error);
    if (budgetMinResult.value !== null && budgetMaxResult.value !== null && budgetMinResult.value > budgetMaxResult.value) {
        return errorResponse('INVALID_BUDGET_RANGE', 'budgetMin must be less than or equal to budgetMax');
    }

    const q = searchParams.get('q')?.trim() || null;

    try {
        await connectDB();

        const filter = {};
        if (isSoftware === 'true') filter.is_software = true;
        if (isSoftware === 'false') filter.is_software = false;

        const agency = searchParams.get('agency');
        if (agency) filter.dept_name = agency;

        const status = searchParams.get('status');
        if (status) filter.project_status = status;

        if (dateFromResult.value || dateToResult.value) {
            filter['timeline.announce_date'] = {};
            if (dateFromResult.value) filter['timeline.announce_date'].$gte = dateFromResult.value;
            if (dateToResult.value) filter['timeline.announce_date'].$lte = dateToResult.value;
        }

        // A project can exist more than once when it has been ingested by an
        // earlier pipeline. Select its most recently updated record before
        // filtering and paginating so the dashboard never shows duplicates.
        const latestProjectPipeline = [
            { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
            { $group: { _id: '$project_id', project: { $first: '$$ROOT' } } },
            { $replaceRoot: { newRoot: '$project' } },
            { $match: filter },
        ];

        const [projects, totalResult] = await Promise.all([
            Project.aggregate([
                ...latestProjectPipeline,
                { $sort: { 'timeline.announce_date': -1, updated_at: -1, _id: -1 } },
                { $skip: (pageResult.value - 1) * limitResult.value },
                { $limit: limitResult.value },
            ]),
            Project.aggregate([
                ...latestProjectPipeline,
                { $count: 'total' },
            ]),
        if (budgetMinResult.value !== null || budgetMaxResult.value !== null) {
            filter.budget = {};
            if (budgetMinResult.value !== null) filter.budget.$gte = budgetMinResult.value;
            if (budgetMaxResult.value !== null) filter.budget.$lte = budgetMaxResult.value;
        }

        if (q) filter.$text = { $search: q };

        const projection = q ? { score: { $meta: 'textScore' } } : null;
        const sort = q ? { score: { $meta: 'textScore' } } : { 'timeline.announce_date': -1, updated_at: -1 };

        const [projects, total] = await Promise.all([
            Project.find(filter, projection)
                .sort(sort)
                .skip((pageResult.value - 1) * limitResult.value)
                .limit(limitResult.value)
                .lean(),
            Project.countDocuments(filter),
        ]);
        const total = totalResult[0]?.total ?? 0;

        const compatibleProjects = await hydrateProjectsCompatibility(projects);
        return NextResponse.json({
            status: 'success',
            page: pageResult.value,
            limit: limitResult.value,
            total,
            data: compatibleProjects.map(toTorListItem),
        });
    } catch (error) {
        return errorResponse('LIST_TORS_FAILED', error.message, 500);
    }
}
