import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import {
    analyticsDataQuality,
    buildAnalyticsPipeline,
    parseAnalyticsQuery,
    toAnalyticsItem,
} from '@/lib/analytics/project-analytics';

const LENGTH_LABELS = {
    one: '1 ปีงบประมาณ',
    two: '2 ปีงบประมาณ',
    threePlus: '3 ปีงบประมาณขึ้นไป',
    unknown: 'ยังไม่ระบุช่วงเวลา',
};

const DOCUMENT_READINESS_LABELS = {
    analysis_ready: 'สรุปเอกสารพร้อมใช้',
    tor_ready: 'มี TOR รอประมวลผล',
    announcement_only: 'มีเฉพาะประกาศเชิญชวน',
    no_documents: 'ยังไม่มีเอกสาร',
};

const CLOSING_WINDOW_LABELS = {
    within_24h: 'ปิดรับภายใน 24 ชั่วโมง',
    within_3d: 'ปิดรับภายใน 3 วัน',
    within_7d: 'ปิดรับภายใน 7 วัน',
    later: 'ปิดรับเกิน 7 วัน',
    closed: 'ปิดรับแล้ว',
    cancelled: 'ยกเลิก',
    unknown: 'ยังไม่ทราบวันปิดรับ',
};

function lengthBucketExpression() {
    return {
        $switch: {
            branches: [
                { case: { $eq: ['$analyticsProjectLength', null] }, then: 'unknown' },
                { case: { $eq: ['$analyticsProjectLength', 1] }, then: 'one' },
                { case: { $eq: ['$analyticsProjectLength', 2] }, then: 'two' },
            ],
            default: 'threePlus',
        },
    };
}

function analyticsFacets(now) {
    const oneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const closingWindow = {
        $switch: {
            branches: [
                { case: { $eq: ['$analyticsBiddingStatus', 'cancelled'] }, then: 'cancelled' },
                { case: { $eq: ['$analyticsBiddingStatus', 'closed'] }, then: 'closed' },
                { case: { $eq: ['$analyticsBiddingStatus', 'unknown'] }, then: 'unknown' },
                { case: { $lte: ['$analyticsBidCloseAt', oneDay] }, then: 'within_24h' },
                { case: { $lte: ['$analyticsBidCloseAt', threeDays] }, then: 'within_3d' },
                { case: { $lte: ['$analyticsBidCloseAt', sevenDays] }, then: 'within_7d' },
            ],
            default: 'later',
        },
    };
    return {
        metrics: [
            { $group: {
                _id: null,
                totalTors: { $sum: 1 },
                totalBudget: { $sum: { $ifNull: ['$analyticsBudget', 0] } },
                openForBidding: { $sum: { $cond: [{ $eq: ['$analyticsBiddingStatus', 'open'] }, 1, 0] } },
                openBudget: { $sum: { $cond: [{ $eq: ['$analyticsBiddingStatus', 'open'] }, { $ifNull: ['$analyticsBudget', 0] }, 0] } },
                closingSoon: { $sum: { $cond: [{ $and: [
                    { $eq: ['$analyticsBiddingStatus', 'open'] },
                    { $gt: ['$analyticsBidCloseAt', now] },
                    { $lte: ['$analyticsBidCloseAt', sevenDays] },
                ] }, 1, 0] } },
            } },
        ],
        fiscalYearTrend: [
            { $match: { analyticsFiscalYear: { $ne: null } } },
            { $group: { _id: '$analyticsFiscalYear', count: { $sum: 1 }, totalBudget: { $sum: { $ifNull: ['$analyticsBudget', 0] } } } },
            { $sort: { _id: 1 } },
        ],
        projectLength: [
            { $addFields: { analyticsLengthBucket: lengthBucketExpression() } },
            { $group: { _id: '$analyticsLengthBucket', count: { $sum: 1 }, totalBudget: { $sum: { $ifNull: ['$analyticsBudget', 0] } } } },
        ],
        biddingStatus: [
            { $group: { _id: '$analyticsBiddingStatus', count: { $sum: 1 }, totalBudget: { $sum: { $ifNull: ['$analyticsBudget', 0] } } } },
            { $sort: { count: -1, _id: 1 } },
        ],
        closingWindow: [
            { $addFields: { analyticsClosingWindow: closingWindow } },
            { $group: { _id: '$analyticsClosingWindow', count: { $sum: 1 }, totalBudget: { $sum: { $ifNull: ['$analyticsBudget', 0] } } } },
            { $sort: { count: -1, _id: 1 } },
        ],
        documentReadiness: [
            { $group: { _id: '$analyticsDocumentReadiness', count: { $sum: 1 }, totalBudget: { $sum: { $ifNull: ['$analyticsBudget', 0] } } } },
            { $sort: { count: -1, _id: 1 } },
        ],
        topAgencies: [
            { $match: { dept_name: { $type: 'string', $ne: '' } } },
            { $group: { _id: '$dept_name', count: { $sum: 1 }, totalBudget: { $sum: { $ifNull: ['$analyticsBudget', 0] } } } },
            { $sort: { totalBudget: -1, _id: 1 } },
            { $limit: 5 },
        ],
        total: [{ $count: 'count' }],
    };
}

function itemPipeline(page, limit) {
    return [
        { $sort: { analyticsBidSortAt: 1, 'timeline.announce_date': -1, updated_at: -1, _id: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
    ];
}

function normalizeBreakdown(items) {
    return items.map((item) => ({ key: item._id, count: item.count, totalBudget: item.totalBudget }));
}

/** GET /api/analytics/search — aggregate the deduplicated TOR catalog for the Analytics UI. */
export async function GET(request) {
    const parsed = parseAnalyticsQuery(new URL(request.url).searchParams);
    if (parsed.error) {
        return NextResponse.json({ error: { code: parsed.code, message: parsed.error } }, { status: 400 });
    }

    const filters = parsed.value;
    const now = new Date();
    try {
        await connectDB();
        const basePipeline = buildAnalyticsPipeline(filters, now);
        const facetFilters = { ...filters, agency: null, stage: null, biddingStatus: null, fiscalYear: null, dateFrom: null, dateTo: null, budgetMin: null, budgetMax: null };

        const [result, facets] = await Promise.all([
            Project.aggregate([
                ...basePipeline,
                { $facet: { ...analyticsFacets(now), data: itemPipeline(filters.page, filters.limit) } },
            ]),
            Project.aggregate([
                ...buildAnalyticsPipeline(facetFilters, now),
                { $facet: {
                    agencies: [
                        { $match: { dept_name: { $type: 'string', $ne: '' } } },
                        { $group: { _id: '$dept_name', count: { $sum: 1 } } },
                        { $sort: { _id: 1 } },
                    ],
                    fiscalYears: [
                        { $match: { analyticsFiscalYear: { $ne: null } } },
                        { $group: { _id: '$analyticsFiscalYear', count: { $sum: 1 } } },
                        { $sort: { _id: -1 } },
                    ],
                } },
            ]),
        ]);

        const payload = result[0] ?? {};
        const available = facets[0] ?? {};
        const metrics = payload.metrics?.[0] ?? {
            totalTors: 0, totalBudget: 0, openForBidding: 0, openBudget: 0, closingSoon: 0,
        };

        return NextResponse.json({
            status: 'success',
            generatedAt: now.toISOString(),
            filters,
            dataQuality: analyticsDataQuality(),
            metrics,
            charts: {
                fiscalYearTrend: (payload.fiscalYearTrend ?? []).map((item) => ({ fiscalYear: item._id, count: item.count, totalBudget: item.totalBudget })),
                projectLength: (payload.projectLength ?? []).map((item) => ({ key: item._id, label: LENGTH_LABELS[item._id], count: item.count, totalBudget: item.totalBudget })),
                biddingStatus: normalizeBreakdown(payload.biddingStatus ?? []),
                closingWindow: (payload.closingWindow ?? []).map((item) => ({ key: item._id, label: CLOSING_WINDOW_LABELS[item._id], count: item.count, totalBudget: item.totalBudget })),
                documentReadiness: (payload.documentReadiness ?? []).map((item) => ({ key: item._id, label: DOCUMENT_READINESS_LABELS[item._id], count: item.count, totalBudget: item.totalBudget })),
                topAgencies: (payload.topAgencies ?? []).map((item) => ({ name: item._id, count: item.count, totalBudget: item.totalBudget })),
            },
            facets: {
                agencies: (available.agencies ?? []).map((item) => ({ name: item._id, count: item.count })),
                fiscalYears: (available.fiscalYears ?? []).map((item) => ({ year: item._id, count: item.count })),
            },
            page: filters.page,
            limit: filters.limit,
            total: payload.total?.[0]?.count ?? 0,
            data: (payload.data ?? []).map(toAnalyticsItem),
        });
    } catch (error) {
        return NextResponse.json({
            error: { code: 'ANALYTICS_SEARCH_FAILED', message: error.message },
        }, { status: 500 });
    }
}
