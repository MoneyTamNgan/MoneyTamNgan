/**
 * Public spend analytics (FR-4.1.1, FR-4.1.3).
 *
 * Aggregates run in MongoDB so the public dashboard and exports cover every
 * stored project, not just one page of the TOR feed.
 */

import { parseDate, parseNonNegativeNumber } from './api/query-params.js';

export const EXPORT_ROW_LIMIT = 10000;
const CATEGORIES = { software: true, 'non-software': false };

/**
 * Build the shared Project filter from public query parameters.
 * Returns { filter } or { error: { code, message } }.
 */
export function parseAnalyticsFilter(searchParams) {
    const dateFrom = parseDate(searchParams.get('dateFrom'), 'dateFrom');
    const dateTo = parseDate(searchParams.get('dateTo'), 'dateTo', true);
    const budgetMin = parseNonNegativeNumber(searchParams.get('budgetMin'), 'budgetMin');
    const budgetMax = parseNonNegativeNumber(searchParams.get('budgetMax'), 'budgetMax');
    if (dateFrom.error) return { error: { code: 'INVALID_DATE_FROM', message: dateFrom.error } };
    if (dateTo.error) return { error: { code: 'INVALID_DATE_TO', message: dateTo.error } };
    if (budgetMin.error) return { error: { code: 'INVALID_BUDGET_MIN', message: budgetMin.error } };
    if (budgetMax.error) return { error: { code: 'INVALID_BUDGET_MAX', message: budgetMax.error } };
    if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) {
        return { error: { code: 'INVALID_DATE_RANGE', message: 'dateFrom must be on or before dateTo' } };
    }
    if (budgetMin.value !== null && budgetMax.value !== null && budgetMin.value > budgetMax.value) {
        return { error: { code: 'INVALID_BUDGET_RANGE', message: 'budgetMin must be less than or equal to budgetMax' } };
    }

    const category = searchParams.get('category');
    if (category && !(category in CATEGORIES)) {
        return { error: { code: 'INVALID_CATEGORY', message: 'category must be software or non-software' } };
    }

    const filter = {};
    const agency = searchParams.get('agency');
    if (agency) filter.dept_name = agency;
    if (category) filter.is_software = CATEGORIES[category];
    if (dateFrom.value || dateTo.value) {
        filter['timeline.announce_date'] = {};
        if (dateFrom.value) filter['timeline.announce_date'].$gte = dateFrom.value;
        if (dateTo.value) filter['timeline.announce_date'].$lte = dateTo.value;
    }
    if (budgetMin.value !== null || budgetMax.value !== null) {
        filter.budget = {};
        if (budgetMin.value !== null) filter.budget.$gte = budgetMin.value;
        if (budgetMax.value !== null) filter.budget.$lte = budgetMax.value;
    }
    return { filter };
}

/** Match, then keep the most recently updated record per project_id. */
export function uniqueProjectsStages(filter) {
    return [
        { $match: filter },
        { $sort: { updated_at: -1, created_at: -1, _id: -1 } },
        { $group: { _id: '$project_id', project: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$project' } },
    ];
}

const toMoney = { $ifNull: ['$budget', 0] };

// Extracted fields live on the latest DocumentSummary, not the project.
const summaryStages = [
    { $match: { latest_summary_id: { $type: 'objectId' } } },
    { $lookup: {
        from: 'documentsummaries',
        localField: 'latest_summary_id',
        foreignField: '_id',
        as: 'summary',
        pipeline: [{ $project: {
            technologies: '$extraction.tech_stack.value',
            flagCount: { $add: [
                { $size: { $ifNull: ['$extraction.flagged_clauses', []] } },
                { $size: { $ifNull: ['$extraction.risk_findings', []] } },
            ] },
        } }],
    } },
    { $unwind: '$summary' },
];

/** One aggregation for every dashboard metric. */
export function spendMetricsPipeline(filter, { agencyLimit = 20, technologyLimit = 8 } = {}) {
    return [
        ...uniqueProjectsStages(filter),
        { $facet: {
            totals: [{ $group: {
                _id: null,
                projectCount: { $sum: 1 },
                totalSpend: { $sum: toMoney },
                meanBudget: { $avg: '$budget' },
                medianDuration: { $median: { input: '$timeline.duration_days', method: 'approximate' } },
                softwareCount: { $sum: { $cond: [{ $eq: ['$is_software', true] }, 1, 0] } },
                highBudgetCount: { $sum: { $cond: [{ $eq: ['$anomalies.high_budget_flag', true] }, 1, 0] } },
                summarizedCount: { $sum: { $cond: [{ $ifNull: ['$latest_summary_id', false] }, 1, 0] } },
            } }],
            byAgency: [
                { $group: {
                    _id: { $ifNull: ['$dept_name', null] },
                    projectCount: { $sum: 1 },
                    totalSpend: { $sum: toMoney },
                    meanBudget: { $avg: '$budget' },
                } },
                { $sort: { totalSpend: -1, _id: 1 } },
                { $limit: agencyLimit },
            ],
            byStatus: [
                { $group: { _id: { $ifNull: ['$project_status', 'Active'] }, projectCount: { $sum: 1 } } },
                { $sort: { projectCount: -1, _id: 1 } },
            ],
            technologies: [
                ...summaryStages,
                { $unwind: '$summary.technologies' },
                { $group: { _id: '$summary.technologies', projects: { $addToSet: '$project_id' } } },
                { $project: { projectCount: { $size: '$projects' } } },
                { $sort: { projectCount: -1, _id: 1 } },
                { $limit: technologyLimit },
            ],
            // High-budget projects are already counted in totals.highBudgetCount.
            flaggedOnly: [
                { $match: { 'anomalies.high_budget_flag': { $ne: true } } },
                ...summaryStages,
                { $match: { 'summary.flagCount': { $gt: 0 } } },
                { $count: 'count' },
            ],
        } },
    ];
}

const round = value => (typeof value === 'number' ? Math.round(value * 100) / 100 : null);

/** Shape the $facet output into the public aggregates response. */
export function toSpendAggregates(facets) {
    const totals = facets?.totals?.[0] ?? {};
    return {
        projectCount: totals.projectCount ?? 0,
        totalSpend: totals.totalSpend ?? 0,
        meanBudget: round(totals.meanBudget) ?? 0,
        medianDuration: round(totals.medianDuration),
        softwareCount: totals.softwareCount ?? 0,
        summarizedCount: totals.summarizedCount ?? 0,
        // A project counts once whether it has a high budget, flagged clauses, or both.
        anomalyCount: (totals.highBudgetCount ?? 0) + (facets?.flaggedOnly?.[0]?.count ?? 0),
        byAgency: (facets?.byAgency ?? []).map(item => ({
            agency: item._id,
            projectCount: item.projectCount,
            totalSpend: item.totalSpend,
            meanBudget: round(item.meanBudget) ?? 0,
        })),
        byStatus: (facets?.byStatus ?? []).map(item => ({ status: item._id, projectCount: item.projectCount })),
        topTechnologies: (facets?.technologies ?? []).map(item => ({
            technology: item._id,
            projectCount: item.projectCount,
        })),
    };
}

export async function computeSpendAggregates(ProjectModel, filter = {}, options = {}) {
    const [facets] = await ProjectModel.aggregate(spendMetricsPipeline(filter, options));
    return toSpendAggregates(facets);
}

const isoDate = value => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const EXPORT_COLUMNS = [
    'id', 'title', 'agency', 'subAgency', 'budget', 'projectStatus', 'isSoftware',
    'announceDate', 'contractStart', 'contractEnd', 'durationDays',
    'highBudgetFlag', 'budgetDeviationMultiplier', 'updatedAt',
];

/** Flat, spreadsheet-friendly view of one project. */
export function toExportRow(project) {
    return {
        id: project.project_id,
        title: project.project_name ?? null,
        agency: project.dept_name ?? null,
        subAgency: project.dept_sub_name ?? null,
        budget: project.budget ?? null,
        projectStatus: project.project_status ?? 'Active',
        isSoftware: project.is_software ?? null,
        announceDate: isoDate(project.timeline?.announce_date),
        contractStart: isoDate(project.timeline?.contract_start),
        contractEnd: isoDate(project.timeline?.contract_end),
        durationDays: project.timeline?.duration_days ?? null,
        highBudgetFlag: project.anomalies?.high_budget_flag ?? false,
        budgetDeviationMultiplier: project.anomalies?.budget_deviation_multiplier ?? 1,
        updatedAt: isoDate(project.updated_at),
    };
}

function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    // Spreadsheet apps execute cells that start with these as formulas.
    if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** CSV with a UTF-8 BOM so Excel reads Thai text correctly. */
export function toCsv(rows) {
    const lines = [EXPORT_COLUMNS.join(','), ...rows.map(row => EXPORT_COLUMNS.map(column => csvCell(row[column])).join(','))];
    return `﻿${lines.join('\r\n')}\r\n`;
}

export async function loadExportRows(ProjectModel, filter = {}, limit = EXPORT_ROW_LIMIT) {
    const projects = await ProjectModel.aggregate([
        ...uniqueProjectsStages(filter),
        { $sort: { 'timeline.announce_date': -1, project_id: 1 } },
        { $limit: limit + 1 },
    ]);
    return { rows: projects.slice(0, limit).map(toExportRow), truncated: projects.length > limit };
}
