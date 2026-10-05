const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const TOR_STAGES = new Set(['draft', 'official', 'review', 'closed']);
const BIDDING_STATUSES = new Set(['open', 'closed', 'cancelled']);
const CLOSED_PROJECT_STATUSES = ['superseded', 'invalid', 'มีฉบับใหม่', 'ไม่ถูกต้อง', 'ปิดรับ', 'ปิดรับแล้ว'];
const CANCELLED_PROJECT_STATUSES = ['cancelled', 'ยกเลิก'];
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function parsePositiveInteger(value, fallback, name, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === '') return { value: fallback };
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
        return { error: `${name} must be an integer between 1 and ${max}` };
    }
    return { value: parsed };
}

function parseNonNegativeNumber(value, name) {
    if (value === null || value === '') return { value: null };
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return { error: `${name} must be a non-negative number` };
    return { value: parsed };
}

function parseDate(value, name, endOfDay = false) {
    if (!value) return { value: null };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { error: `${name} must be a valid ISO 8601 date` };
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) parsed.setUTCHours(23, 59, 59, 999);
    return { value: parsed };
}

/** Validate public analytics query parameters without exposing Mongo-specific details. */
export function parseAnalyticsQuery(searchParams) {
    const page = parsePositiveInteger(searchParams.get('page'), 1, 'page');
    const limit = parsePositiveInteger(searchParams.get('limit') ?? searchParams.get('pageSize'), DEFAULT_LIMIT, 'limit', MAX_LIMIT);
    const budgetMin = parseNonNegativeNumber(searchParams.get('budgetMin'), 'budgetMin');
    const budgetMax = parseNonNegativeNumber(searchParams.get('budgetMax'), 'budgetMax');
    const dateFrom = parseDate(searchParams.get('dateFrom'), 'dateFrom');
    const dateTo = parseDate(searchParams.get('dateTo'), 'dateTo', true);
    const isSoftware = searchParams.get('isSoftware');
    const stage = searchParams.get('stage');
    const biddingStatus = searchParams.get('biddingStatus');
    const fiscalYearValue = searchParams.get('fiscalYear');

    if (page.error) return { error: page.error, code: 'INVALID_PAGE' };
    if (limit.error) return { error: limit.error, code: 'INVALID_LIMIT' };
    if (budgetMin.error) return { error: budgetMin.error, code: 'INVALID_BUDGET_MIN' };
    if (budgetMax.error) return { error: budgetMax.error, code: 'INVALID_BUDGET_MAX' };
    if (dateFrom.error) return { error: dateFrom.error, code: 'INVALID_DATE_FROM' };
    if (dateTo.error) return { error: dateTo.error, code: 'INVALID_DATE_TO' };
    if (budgetMin.value !== null && budgetMax.value !== null && budgetMin.value > budgetMax.value) {
        return { error: 'budgetMin must be less than or equal to budgetMax', code: 'INVALID_BUDGET_RANGE' };
    }
    if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
        return { error: 'dateFrom must be on or before dateTo', code: 'INVALID_DATE_RANGE' };
    }
    if (isSoftware !== null && isSoftware !== '' && isSoftware !== 'true' && isSoftware !== 'false') {
        return { error: 'isSoftware must be true or false', code: 'INVALID_IS_SOFTWARE' };
    }
    if (stage && !TOR_STAGES.has(stage)) {
        return { error: 'stage must be draft, official, review, or closed', code: 'INVALID_STAGE' };
    }
    if (biddingStatus && !BIDDING_STATUSES.has(biddingStatus)) {
        return { error: 'biddingStatus must be open, closed, or cancelled', code: 'INVALID_BIDDING_STATUS' };
    }

    let fiscalYear = null;
    if (fiscalYearValue) {
        fiscalYear = Number(fiscalYearValue);
        if (!Number.isInteger(fiscalYear) || fiscalYear < 2400 || fiscalYear > 3000) {
            return { error: 'fiscalYear must be a Buddhist Era year between 2400 and 3000', code: 'INVALID_FISCAL_YEAR' };
        }
    }

    return {
        value: {
            page: page.value,
            limit: limit.value,
            isSoftware: isSoftware === null || isSoftware === '' ? null : isSoftware === 'true',
            agency: searchParams.get('agency')?.trim() || null,
            stage: stage || null,
            biddingStatus: biddingStatus || null,
            fiscalYear,
            dateFrom: dateFrom.value,
            dateTo: dateTo.value,
            budgetMin: budgetMin.value,
            budgetMax: budgetMax.value,
        },
    };
}

function rawMatch(filters) {
    const match = {};
    if (filters.isSoftware !== null) match.is_software = filters.isSoftware;
    if (filters.agency) match.dept_name = filters.agency;
    if (filters.dateFrom || filters.dateTo) {
        match['timeline.announce_date'] = {};
        if (filters.dateFrom) match['timeline.announce_date'].$gte = filters.dateFrom;
        if (filters.dateTo) match['timeline.announce_date'].$lte = filters.dateTo;
    }
    if (filters.budgetMin !== null || filters.budgetMax !== null) {
        match.budget = {};
        if (filters.budgetMin !== null) match.budget.$gte = filters.budgetMin;
        if (filters.budgetMax !== null) match.budget.$lte = filters.budgetMax;
    }
    return match;
}

/**
 * Produces the canonical, temporary dashboard fields from the values available
 * today. Replace only this function when real bidding and TOR-stage fields land.
 */
export function buildAnalyticsPipeline(filters, now = new Date()) {
    const thirtyDaysBefore = new Date(now.getTime() - THIRTY_DAYS_MS);
    const thirtyDaysAfter = new Date(now.getTime() + THIRTY_DAYS_MS);

    const pipeline = [
        { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
        { $group: { _id: '$project_id', project: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$project' } },
        { $match: rawMatch(filters) },
        { $addFields: {
            analyticsDate: { $ifNull: ['$timeline.contract_start', '$timeline.announce_date'] },
            analyticsProjectStatus: { $toLower: { $ifNull: ['$project_status', ''] } },
        } },
        { $addFields: {
            analyticsFiscalYear: {
                $cond: [
                    { $eq: ['$analyticsDate', null] },
                    null,
                    { $add: [
                        { $year: '$analyticsDate' },
                        543,
                        { $cond: [{ $gte: [{ $month: '$analyticsDate' }, 10] }, 1, 0] },
                    ] },
                ],
            },
            analyticsEndDate: { $ifNull: ['$timeline.contract_end', '$analyticsDate'] },
            analyticsBiddingStatus: {
                $switch: {
                    branches: [
                        { case: { $in: ['$analyticsProjectStatus', CANCELLED_PROJECT_STATUSES] }, then: 'cancelled' },
                        { case: { $in: ['$analyticsProjectStatus', CLOSED_PROJECT_STATUSES] }, then: 'closed' },
                    ],
                    default: 'open',
                },
            },
            analyticsStage: {
                $switch: {
                    branches: [
                        { case: { $eq: [{ $ifNull: ['$timeline.contract_start', null] }, null] }, then: 'draft' },
                        { case: { $gt: ['$timeline.contract_start', thirtyDaysAfter] }, then: 'official' },
                        { case: { $gte: ['$timeline.contract_start', thirtyDaysBefore] }, then: 'review' },
                    ],
                    default: 'closed',
                },
            },
        } },
        { $addFields: {
            analyticsEndFiscalYear: {
                $cond: [
                    { $eq: ['$analyticsEndDate', null] },
                    '$analyticsFiscalYear',
                    { $add: [
                        { $year: '$analyticsEndDate' },
                        543,
                        { $cond: [{ $gte: [{ $month: '$analyticsEndDate' }, 10] }, 1, 0] },
                    ] },
                ],
            },
        } },
        { $addFields: {
            analyticsProjectLength: {
                $cond: [
                    { $eq: ['$analyticsFiscalYear', null] },
                    null,
                    { $max: [1, { $add: [{ $subtract: ['$analyticsEndFiscalYear', '$analyticsFiscalYear'] }, 1] }] },
                ],
            },
        } },
    ];

    const derivedMatch = {};
    if (filters.stage) derivedMatch.analyticsStage = filters.stage;
    if (filters.biddingStatus) derivedMatch.analyticsBiddingStatus = filters.biddingStatus;
    if (filters.fiscalYear !== null) derivedMatch.analyticsFiscalYear = filters.fiscalYear;
    if (Object.keys(derivedMatch).length) pipeline.push({ $match: derivedMatch });
    return pipeline;
}

export function analyticsDataQuality() {
    return {
        biddingStatus: 'temporary: project_status',
        biddingCloseAt: 'temporary: timeline.contract_end',
        torStage: 'temporary: timeline.contract_start',
        fiscalYear: 'timeline.contract_start, fallback timeline.announce_date',
    };
}

export function toAnalyticsItem(project) {
    const toIso = (value) => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return {
        id: project.project_id,
        title: project.project_name,
        agency: project.dept_name,
        budget: project.budget ?? 0,
        projectStatus: project.project_status ?? '',
        isSoftware: project.is_software ?? null,
        announceDate: toIso(project.timeline?.announce_date),
        contractStart: toIso(project.timeline?.contract_start),
        contractEnd: toIso(project.timeline?.contract_end),
        fiscalYear: project.analyticsFiscalYear ?? null,
        biddingStatus: project.analyticsBiddingStatus,
        stage: project.analyticsStage,
        projectLength: project.analyticsProjectLength ?? null,
    };
}

export const ANALYTICS_CONSTANTS = { MAX_LIMIT, DEFAULT_LIMIT, TOR_STAGES, BIDDING_STATUSES };
