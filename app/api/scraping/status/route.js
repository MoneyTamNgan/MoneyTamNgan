import connectDB from '@/lib/db';
import Project from '@/models/Project';
import Document from '@/models/Document';
import { NextResponse } from 'next/server';

/**
 * GET /api/scraping/status
 *
 * Returns scraping coverage statistics:
 * - Total projects in database
 * - Projects with a locally stored TOR file
 * - Projects without a locally stored TOR file
 * - Coverage percentage
 */
export async function GET() {
    try {
        await connectDB();

        const [totalProjects, withPdfFiles, withPdfLinks] = await Promise.all([
            Project.countDocuments(),
            Document.countDocuments({
                is_current_primary: true,
                'storage.backend': { $in: ['local', 'gcs'] },
            }),
            Document.countDocuments({ is_current_primary: true }),
        ]);

        const withoutPdfFiles = totalProjects - withPdfFiles;
        const coverage = totalProjects > 0
            ? `${Math.round((withPdfFiles / totalProjects) * 100)}%`
            : '0%';

        return NextResponse.json({
            status: 'ok',
            totalProjects,
            withPdfFiles,
            withoutPdfFiles,
            withPdfLinks,
            withPdf: withPdfFiles,
            withoutPdf: withoutPdfFiles,
            coverage,
        }, {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
    } catch (error) {
        return NextResponse.json({
            status: 'error',
            error: {
                code: 'STATUS_CHECK_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
