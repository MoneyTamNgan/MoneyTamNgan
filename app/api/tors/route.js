import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { toTorListItem } from '@/lib/api/tor-response';

import { hydrateProjectsCompatibility } from '@/lib/project-compat';
import { parseDate, parseNonNegativeNumber, parsePositiveInteger, parseStage, parseBiddingStatus, stageFilter } from '@/lib/api/query-params';

const MAX_LIMIT = 100;
const CURRENT_TENDER_FILTER = { tender: { $exists: true, $ne: null } };

function errorResponse(code, message, status = 400) {
    return NextResponse.json({ error: { code, message } }, { status });
}

function biddingDeadlineExpression() {
    const submissionDate = { $ifNull: ['$tender.submission_date', '$submission_schedule.date'] };
    const submissionEndTime = { $ifNull: ['$tender.submission_end_time', '$submission_schedule.end_time'] };
    return {
        $ifNull: [
            '$submission_schedule.ends_at',
            {
                $ifNull: [
                    {
                        $dateFromString: {
                            dateString: { $concat: [submissionDate, 'T', submissionEndTime, ':00'] },
                            format: '%Y-%m-%dT%H:%M:%S',
                            timezone: 'Asia/Bangkok',
                            onError: null,
                            onNull: null,
                        },
                    },
                    '$tender.closes_at',
                ],
            },
        ],
    };
}

function biddingStatusPipeline(status, now = new Date()) {
    if (!status) return [];
    const notCancelled = {
        $ne: [{ $toLower: { $ifNull: ['$tender.status', ''] } }, 'cancelled'],
    };
    // MongoDB comparison operators order null/missing values before Dates.
    // Check the BSON type explicitly so missing or unparseable deadlines can
    // never be treated as already closed.
    const hasDeadline = { $eq: [{ $type: '$_biddingCloseAt' }, 'date'] };
    const deadlineMatches = status === 'open'
        ? { $gt: ['$_biddingCloseAt', now] }
        : status === 'closed'
            ? { $lte: ['$_biddingCloseAt', now] }
            : { $eq: ['$_biddingCloseAt', null] };

    const conditions = status === 'unknown'
        ? [{ $ne: [{ $type: '$_biddingCloseAt' }, 'date'] }]
        : [notCancelled, hasDeadline, deadlineMatches];

    return [
        { $addFields: { _biddingCloseAt: biddingDeadlineExpression() } },
        { $match: { $expr: { $and: conditions } } },
    ];
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
 * - stage (temporary contract-start-derived TOR stage)
 * - biddingStatus (live open/closed/unknown value calculated from submission deadline)
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

    const stageResult = parseStage(searchParams.get('stage'));
    if (stageResult.error) return errorResponse('INVALID_STAGE', stageResult.error);

    const biddingStatusResult = parseBiddingStatus(searchParams.get('biddingStatus'));
    if (biddingStatusResult.error) return errorResponse('INVALID_BIDDING_STATUS', biddingStatusResult.error);

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

        const temporaryStageFilter = stageFilter(stageResult.value);
        if (temporaryStageFilter) Object.assign(filter, temporaryStageFilter);

        if (dateFromResult.value || dateToResult.value) {
            filter['timeline.announce_date'] = {};
            if (dateFromResult.value) filter['timeline.announce_date'].$gte = dateFromResult.value;
            if (dateToResult.value) filter['timeline.announce_date'].$lte = dateToResult.value;
        }

        if (budgetMinResult.value !== null || budgetMaxResult.value !== null) {
            filter.budget = {};
            if (budgetMinResult.value !== null) filter.budget.$gte = budgetMinResult.value;
            if (budgetMaxResult.value !== null) filter.budget.$lte = budgetMaxResult.value;
        }

        if (q) filter.$text = { $search: q };

        const pipeline = [
            { $match: filter }
        ];

        if (q) {
            pipeline.push({ $addFields: { score: { $meta: 'textScore' } } });
        }

        // A project can exist more than once when it has been ingested by an
        // earlier pipeline. Select its most recently updated record before
        // paginating so the dashboard never shows duplicates.
        pipeline.push(
            { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
            { $group: { _id: '$project_id', project: { $first: '$$ROOT' } } },
            { $replaceRoot: { newRoot: '$project' } },
            // The dashboard is temporarily scoped to the current tender
            // schema. Apply this after de-duplication so an obsolete version
            // of a project cannot make its latest record appear eligible.
            { $match: CURRENT_TENDER_FILTER }
        );

        // Evaluate the live deadline after deduplication so an old snapshot
        // cannot make a newer project appear open or closed incorrectly.
        pipeline.push(...biddingStatusPipeline(biddingStatusResult.value));

        const sort = q ? { score: { $meta: 'textScore' } } : { 'timeline.announce_date': -1, updated_at: -1, _id: -1 };

        const [projects, totalResult] = await Promise.all([
            Project.aggregate([
                ...pipeline,
                { $sort: sort },
                { $skip: (pageResult.value - 1) * limitResult.value },
                { $limit: limitResult.value },
            ]),
            Project.aggregate([
                ...pipeline,
                { $count: 'total' },
            ]),
        ]);
        const total = totalResult[0]?.total ?? 0;

        let userDoc = null;
        try {
            const { cookies } = await import('next/headers');
            const { verifySession, SESSION_COOKIE } = await import('@/lib/auth');
            const { User } = await import('@/models/User');
            
            const cookieStore = await cookies();
            const token = cookieStore.get(SESSION_COOKIE)?.value;
            if (token) {
                const session = await verifySession(token);
                if (session?.sub) {
                    userDoc = await User.findOne({ _id: session.sub }).lean();
                }
            }
        } catch (err) {
            console.error('Error fetching user for match score:', err);
        }

        const hydratedProjects = await hydrateProjectsCompatibility(projects);
        return NextResponse.json({
            status: 'success',
            page: pageResult.value,
            limit: limitResult.value,
            total,
            data: hydratedProjects.map(project => toTorListItem(project, userDoc)),
        });
    } catch (error) {
        return errorResponse('LIST_TORS_FAILED', error.message, 500);
    }
}
