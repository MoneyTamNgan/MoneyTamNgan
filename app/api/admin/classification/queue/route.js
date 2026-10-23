import connectDB from '@/lib/db';
import { authorizeAdminRequest } from '@/lib/admin-auth';
import { parsePositiveInteger } from '@/lib/api/query-params';
import { listLowConfidenceTors } from '@/lib/low-confidence-review';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' };

export async function GET(request) {
    const auth = await authorizeAdminRequest(request);
    if (!auth.authorized) return NextResponse.json({ error: { code: auth.code, message: auth.message } }, { status: auth.status, headers });
    const params = new URL(request.url).searchParams;
    const page = parsePositiveInteger(params.get('page'), 1, 'page', 1000000);
    const pageSize = parsePositiveInteger(params.get('pageSize'), 20, 'pageSize', 100);
    const confidenceType = params.get('confidenceType') || 'either';
    if (page.error || pageSize.error || !['either', 'classification', 'extraction'].includes(confidenceType)) {
        return NextResponse.json({ error: { code: 'INVALID_REVIEW_QUERY', message: page.error || pageSize.error
            || 'confidenceType must be either, classification or extraction' } }, { status: 400, headers });
    }
    try {
        await connectDB();
        return NextResponse.json(await listLowConfidenceTors({ page: page.value, pageSize: pageSize.value, confidenceType }), { headers });
    } catch {
        return NextResponse.json({ error: { code: 'LOW_CONFIDENCE_REVIEW_FAILED', message: 'Unable to load low-confidence TOR records' } }, { status: 500, headers });
    }
}
