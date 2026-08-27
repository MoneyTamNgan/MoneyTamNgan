import connectDB from '@/lib/db';
import Project from '@/models/Project';
import { NextResponse } from 'next/server';

/**
 * GET /api/projects/[id]
 *
 * Fetch a single project by its project_id.
 */
export async function GET(request, { params }) {
    try {
        await connectDB();

        const { id } = await params;

        const project = await Project.findOne({ project_id: id }).lean();

        if (!project) {
            return NextResponse.json({
                error: {
                    code: 'PROJECT_NOT_FOUND',
                    message: `No project exists with id: ${id}`,
                },
            }, { status: 404 });
        }

        return NextResponse.json(project, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    } catch (error) {
        return NextResponse.json({
            error: {
                code: 'GET_PROJECT_FAILED',
                message: error.message,
            },
        }, { status: 500 });
    }
}
