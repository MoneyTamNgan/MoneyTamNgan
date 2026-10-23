import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { hydrateProjectsCompatibility } from '@/lib/project-compat';
import { NextResponse } from 'next/server';
import { authorizeAdminRequest } from '@/lib/admin-auth';

export async function GET(request) {
    const auth = await authorizeAdminRequest(request);
    if (!auth.authorized) return NextResponse.json({ error: { code: auth.code, message: auth.message } }, { status: auth.status,
        headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
    try {
        await connectDB();
        const params = new URL(request.url).searchParams;
        const page = Math.max(1, Number(params.get('page')) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(params.get('pageSize')) || 20));
        const filter = {
            $or: [
                { 'classification.status': 'uncertain' },
                { 'processing.status': 'review_required' },
                { 'processing.status': 'failed' },
            ],
        };
        const [items, total] = await Promise.all([
            Project.find(filter)
                .sort({ updated_at: -1 })
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean(),
            Project.countDocuments(filter),
        ]);
        return NextResponse.json({
            items: await hydrateProjectsCompatibility(items),
            total,
            page,
            pageSize,
        }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
    } catch (error) {
        return NextResponse.json({
            error: { code: 'REVIEW_QUEUE_FAILED', message: error.message },
        }, { status: 500 });
    }
}
