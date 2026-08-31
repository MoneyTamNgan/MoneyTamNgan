import connectDB from '@/lib/db';
import ProcessingJob from '@/models/ProcessingJob';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        await connectDB();
        const jobId = new URL(request.url).searchParams.get('jobId');
        if (jobId) {
            const job = await ProcessingJob.findById(jobId).lean();
            if (!job) {
                return NextResponse.json({
                    status: 'failed',
                    error: { code: 'JOB_NOT_FOUND', message: 'Processing job was not found' },
                }, { status: 404 });
            }
            return NextResponse.json({ status: 'ok', job });
        }

        const [jobCounts, projectCounts] = await Promise.all([
            ProcessingJob.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
            Project.aggregate([{ $group: { _id: '$processing.status', count: { $sum: 1 } } }]),
        ]);
        return NextResponse.json({
            status: 'ok',
            jobs: Object.fromEntries(jobCounts.map(item => [item._id, item.count])),
            projects: Object.fromEntries(projectCounts.map(item => [item._id || 'untracked', item.count])),
        });
    } catch (error) {
        return NextResponse.json({
            status: 'failed',
            error: { code: 'PROCESSING_STATUS_FAILED', message: error.message },
        }, { status: 500 });
    }
}
