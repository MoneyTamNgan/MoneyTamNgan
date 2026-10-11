import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { EXPORT_ROW_LIMIT, loadExportRows, parseAnalyticsFilter, toCsv } from '@/lib/analytics';

function errorResponse(code, message, status = 400) {
    return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * GET /api/analytics/export?format=csv|json
 *
 * Public, read-only download of matching projects, using the same filters as
 * /api/analytics/search. At most EXPORT_ROW_LIMIT rows; X-Export-Truncated
 * reports whether more matched.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format');
    if (format !== 'csv' && format !== 'json') {
        return errorResponse('INVALID_FORMAT', 'format must be csv or json');
    }
    const parsed = parseAnalyticsFilter(searchParams);
    if (parsed.error) return errorResponse(parsed.error.code, parsed.error.message);

    try {
        await connectDB();
        const { rows, truncated } = await loadExportRows(Project, parsed.filter, EXPORT_ROW_LIMIT);
        const stamp = new Date().toISOString().slice(0, 10);
        const headers = {
            'Content-Disposition': `attachment; filename="tor-projects-${stamp}.${format}"`,
            'Cache-Control': 'no-store',
            'X-Export-Truncated': String(truncated),
        };
        if (format === 'json') {
            return new NextResponse(JSON.stringify(rows, null, 2), {
                headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
            });
        }
        return new NextResponse(toCsv(rows), {
            headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
        });
    } catch (error) {
        return errorResponse('ANALYTICS_EXPORT_FAILED', error.message, 500);
    }
}
