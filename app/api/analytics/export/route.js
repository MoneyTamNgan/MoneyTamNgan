import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { buildAnalyticsPipeline, parseAnalyticsQuery, toAnalyticsItem } from '@/lib/analytics/project-analytics';

const MAX_EXPORT_ROWS = 5000;

function csvCell(value) {
    return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function toCsv(items) {
    const headers = ['project_id', 'project_name', 'agency', 'budget', 'project_status', 'is_software', 'announce_date', 'contract_start', 'contract_end', 'fiscal_year', 'bidding_status', 'tor_stage', 'project_length'];
    const rows = items.map((item) => [
        item.id, item.title, item.agency, item.budget, item.projectStatus, item.isSoftware,
        item.announceDate, item.contractStart, item.contractEnd, item.fiscalYear,
        item.biddingStatus, item.stage, item.projectLength,
    ].map(csvCell).join(','));
    return `\uFEFF${headers.join(',')}\n${rows.join('\n')}`;
}

/** GET /api/analytics/export?format=csv|json plus the same filters as /search. */
export async function GET(request) {
    const url = new URL(request.url);
    const format = url.searchParams.get('format');
    if (format !== 'csv' && format !== 'json') {
        return NextResponse.json({ error: { code: 'INVALID_FORMAT', message: 'format must be csv or json' } }, { status: 400 });
    }

    const parsed = parseAnalyticsQuery(url.searchParams);
    if (parsed.error) {
        return NextResponse.json({ error: { code: parsed.code, message: parsed.error } }, { status: 400 });
    }

    try {
        await connectDB();
        const items = await Project.aggregate([
            ...buildAnalyticsPipeline(parsed.value, new Date()),
            { $sort: { 'timeline.contract_end': 1, 'timeline.announce_date': -1, updated_at: -1, _id: -1 } },
            { $limit: MAX_EXPORT_ROWS },
        ]);
        const data = items.map(toAnalyticsItem);
        const filename = `tor-analytics-${new Date().toISOString().slice(0, 10)}.${format}`;
        if (format === 'csv') {
            return new NextResponse(toCsv(data), {
                headers: {
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                },
            });
        }
        return new NextResponse(JSON.stringify(data, null, 2), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="${filename}"`,
            },
        });
    } catch (error) {
        return NextResponse.json({ error: { code: 'ANALYTICS_EXPORT_FAILED', message: error.message } }, { status: 500 });
    }
}
