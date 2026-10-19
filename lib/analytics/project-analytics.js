import { analyticsArtifactStages } from './artifact-stages.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const BIDDING_STATUSES = new Set(['open', 'closed', 'cancelled', 'unknown']);
const CURRENT_TENDER_FILTER = { tender: { $exists: true, $ne: null } };

function parsePositiveInteger(value, fallback, name, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === '') return { value: fallback };
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return { error: `${name} must be an integer between 1 and ${max}` };
    return { value: parsed };
}

function parseNonNegativeNumber(value, name) {
    if (value === null || value === '') return { value: null };
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? { value: parsed } : { error: `${name} must be a non-negative number` };
}

function parseDate(value, name, endOfDay = false) {
    if (!value) return { value: null };
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return { error: `${name} must be a valid ISO 8601 date` };
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) parsed.setUTCHours(23, 59, 59, 999);
    return { value: parsed };
}

export function parseAnalyticsQuery(searchParams) {
    const page = parsePositiveInteger(searchParams.get('page'), 1, 'page');
    const limit = parsePositiveInteger(searchParams.get('limit') ?? searchParams.get('pageSize'), DEFAULT_LIMIT, 'limit', MAX_LIMIT);
    const budgetMin = parseNonNegativeNumber(searchParams.get('budgetMin'), 'budgetMin');
    const budgetMax = parseNonNegativeNumber(searchParams.get('budgetMax'), 'budgetMax');
    const dateFrom = parseDate(searchParams.get('dateFrom'), 'dateFrom');
    const dateTo = parseDate(searchParams.get('dateTo'), 'dateTo', true);
    const isSoftware = searchParams.get('isSoftware');
    const biddingStatus = searchParams.get('biddingStatus');
    const fiscalYearValue = searchParams.get('fiscalYear');

    if (page.error) return { error: page.error, code: 'INVALID_PAGE' };
    if (limit.error) return { error: limit.error, code: 'INVALID_LIMIT' };
    if (budgetMin.error) return { error: budgetMin.error, code: 'INVALID_BUDGET_MIN' };
    if (budgetMax.error) return { error: budgetMax.error, code: 'INVALID_BUDGET_MAX' };
    if (dateFrom.error) return { error: dateFrom.error, code: 'INVALID_DATE_FROM' };
    if (dateTo.error) return { error: dateTo.error, code: 'INVALID_DATE_TO' };
    if (budgetMin.value !== null && budgetMax.value !== null && budgetMin.value > budgetMax.value) return { error: 'budgetMin must be less than or equal to budgetMax', code: 'INVALID_BUDGET_RANGE' };
    if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) return { error: 'dateFrom must be on or before dateTo', code: 'INVALID_DATE_RANGE' };
    if (isSoftware !== null && isSoftware !== '' && isSoftware !== 'true' && isSoftware !== 'false') return { error: 'isSoftware must be true or false', code: 'INVALID_IS_SOFTWARE' };
    if (biddingStatus && !BIDDING_STATUSES.has(biddingStatus)) return { error: 'biddingStatus must be open, closed, cancelled, or unknown', code: 'INVALID_BIDDING_STATUS' };

    let fiscalYear = null;
    if (fiscalYearValue) {
        fiscalYear = Number(fiscalYearValue);
        if (!Number.isInteger(fiscalYear) || fiscalYear < 2400 || fiscalYear > 3000) return { error: 'fiscalYear must be a Buddhist Era year between 2400 and 3000', code: 'INVALID_FISCAL_YEAR' };
    }

    return { value: {
        page: page.value, limit: limit.value,
        isSoftware: isSoftware === null || isSoftware === '' ? null : isSoftware === 'true',
        agency: searchParams.get('agency')?.trim() || null,
        biddingStatus: biddingStatus || null, fiscalYear,
        dateFrom: dateFrom.value, dateTo: dateTo.value,
        budgetMin: budgetMin.value, budgetMax: budgetMax.value,
    } };
}

function rawMatch(filters) {
    const match = { ...CURRENT_TENDER_FILTER };
    if (filters.isSoftware !== null) match.is_software = filters.isSoftware;
    if (filters.agency) match.dept_name = filters.agency;
    if (filters.dateFrom || filters.dateTo) {
        match['timeline.announce_date'] = {};
        if (filters.dateFrom) match['timeline.announce_date'].$gte = filters.dateFrom;
        if (filters.dateTo) match['timeline.announce_date'].$lte = filters.dateTo;
    }
    return match;
}

function biddingDeadlineExpression() {
    const submissionDate = { $ifNull: ['$tender.submission_date', '$submission_schedule.date'] };
    const submissionEndTime = { $ifNull: ['$tender.submission_end_time', '$submission_schedule.end_time'] };
    return { $ifNull: [
        '$submission_schedule.ends_at',
        { $ifNull: [
            { $dateFromString: {
                dateString: { $concat: [submissionDate, 'T', submissionEndTime, ':00'] },
                format: '%Y-%m-%dT%H:%M:%S', timezone: 'Asia/Bangkok', onError: null, onNull: null,
            } },
            '$tender.closes_at',
        ] },
    ] };
}

/** Tender-aware analytics. Bidding data never comes from contract dates or project_status. */
export function buildAnalyticsPipeline(filters, now = new Date()) {
    const pipeline = [
        { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
        { $group: { _id: '$project_id', project: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$project' } },
        { $match: rawMatch(filters) },
        ...analyticsArtifactStages(),
        { $addFields: {
            analyticsBidCloseAt: biddingDeadlineExpression(),
            analyticsBudget: { $ifNull: ['$budget', '$tender.reference_price'] },
            analyticsTenderStatus: { $toLower: { $ifNull: ['$tender.status', ''] } },
        } },
        { $addFields: {
            analyticsCalculatedFiscalYear: { $cond: [
                { $ne: [{ $type: '$analyticsBidCloseAt' }, 'date'] }, null,
                { $let: {
                    vars: { closeParts: { $dateToParts: { date: '$analyticsBidCloseAt', timezone: 'Asia/Bangkok' } } },
                    in: { $add: ['$$closeParts.year', 543, { $cond: [{ $gte: ['$$closeParts.month', 10] }, 1, 0] }] },
                } },
            ] },
            analyticsBiddingStatus: { $switch: {
                branches: [
                    { case: { $eq: ['$analyticsTenderStatus', 'cancelled'] }, then: 'cancelled' },
                    { case: { $ne: [{ $type: '$analyticsBidCloseAt' }, 'date'] }, then: 'unknown' },
                    { case: { $lte: ['$analyticsBidCloseAt', now] }, then: 'closed' },
                ],
                default: 'open',
            } },
            analyticsDocumentReadiness: { $switch: {
                branches: [
                    { case: '$_validSummary', then: 'analysis_ready' },
                    { case: { $ne: ['$_tor', null] }, then: 'tor_ready' },
                    { case: { $ne: ['$_invitation', null] }, then: 'announcement_only' },
                ],
                default: 'no_documents',
            } },
        } },
        { $addFields: {
            analyticsFiscalYear: { $switch: {
                branches: [
                    { case: { $and: [{ $eq: ['$_fiscal.status', 'found'] }, { $isNumber: '$_fiscal.year' }] }, then: '$_fiscal.year' },
                    { case: { $eq: ['$_fiscal.status', 'ambiguous'] }, then: null },
                ],
                default: '$analyticsCalculatedFiscalYear',
            } },
            analyticsFiscalYearSource: { $switch: {
                branches: [
                    { case: { $and: [{ $eq: ['$_fiscal.status', 'found'] }, { $isNumber: '$_fiscal.year' }] }, then: 'document' },
                    { case: { $eq: ['$_fiscal.status', 'ambiguous'] }, then: 'ambiguous' },
                    { case: { $ne: ['$analyticsCalculatedFiscalYear', null] }, then: 'bid_close_estimate' },
                ], default: 'unknown',
            } },
            // Kept as an optional legacy view; the submission session itself is
            // deliberately not treated as project duration.
            analyticsProjectLength: { $cond: [
                { $or: [{ $ne: [{ $type: '$timeline.contract_start' }, 'date'] }, { $ne: [{ $type: '$timeline.contract_end' }, 'date'] }, { $lt: ['$timeline.contract_end', '$timeline.contract_start'] }] }, null,
                { $max: [1, { $ceil: { $divide: [{ $subtract: ['$timeline.contract_end', '$timeline.contract_start'] }, 31557600000] } }] },
            ] },
            analyticsBidSortAt: { $ifNull: ['$analyticsBidCloseAt', new Date('9999-12-31T00:00:00.000Z')] },
        } },
    ];

    const derivedMatch = {};
    if (filters.biddingStatus) derivedMatch.analyticsBiddingStatus = filters.biddingStatus;
    if (filters.fiscalYear !== null) derivedMatch.analyticsFiscalYear = filters.fiscalYear;
    if (filters.budgetMin !== null || filters.budgetMax !== null) {
        derivedMatch.analyticsBudget = {};
        if (filters.budgetMin !== null) derivedMatch.analyticsBudget.$gte = filters.budgetMin;
        if (filters.budgetMax !== null) derivedMatch.analyticsBudget.$lte = filters.budgetMax;
    }
    if (Object.keys(derivedMatch).length) pipeline.push({ $match: derivedMatch });
    return pipeline;
}

export function analyticsDataQuality() {
    return {
        scope: 'projects with tender only',
        biddingStatus: 'live deadline: submission_schedule.ends_at, submission end time, then tender.closes_at',
        fiscalYear: 'confirmed document fiscal year; fallback estimate from bidding close in Asia/Bangkok; ambiguous years excluded',
        budget: 'project.budget, fallback tender.reference_price',
        projectLength: 'legacy contract timeline only; unavailable without contract dates',
        documentReadiness: 'linked-record availability; file bytes and extraction quality are not verified',
    };
}

export function toAnalyticsItem(project) {
    const toIso = (value) => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return {
        id: project.project_id, title: project.project_name, agency: project.dept_name,
        budget: project.analyticsBudget ?? null, projectStatus: project.project_status ?? '', isSoftware: project.is_software ?? null,
        announceDate: toIso(project.timeline?.announce_date),
        bidClosesAt: toIso(project.analyticsBidCloseAt),
        bidStartsAt: toIso(project.submission_schedule?.starts_at),
        bidSubmissionDate: project.tender?.submission_date ?? project.submission_schedule?.date ?? null,
        bidStartTime: project.tender?.submission_start_time ?? project.submission_schedule?.start_time ?? null,
        bidEndTime: project.tender?.submission_end_time ?? project.submission_schedule?.end_time ?? null,
        fiscalYear: project.analyticsFiscalYear ?? null,
        fiscalYearSource: project.analyticsFiscalYearSource ?? 'unknown',
        biddingStatus: project.analyticsBiddingStatus,
        projectLength: project.analyticsProjectLength ?? null,
        documentReadiness: project.analyticsDocumentReadiness,
    };
}

export const ANALYTICS_CONSTANTS = { MAX_LIMIT, DEFAULT_LIMIT, BIDDING_STATUSES };
