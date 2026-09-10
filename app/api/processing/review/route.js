import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

export async function GET(request) {
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
        return NextResponse.json({ items, total, page, pageSize });
    } catch (error) {
        return NextResponse.json({
            error: { code: 'REVIEW_QUEUE_FAILED', message: error.message },
        }, { status: 500 });
    }
}
