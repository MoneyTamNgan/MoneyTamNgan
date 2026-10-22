import connectDB from '@/lib/db';
import Project from '@/models/Project';
import ClassificationOverride from '@/models/ClassificationOverride';
import {
    applyClassificationOverride,
    OverrideError,
    parseOverrideBody,
    reviewerFromRequest,
    toOverrideHistoryItem,
} from '@/lib/classification-override';
import { toTorDetail } from '@/lib/api/tor-response';
import { hydrateProjectCompatibility } from '@/lib/project-compat';
import { NextResponse } from 'next/server';

// Restricted to admin sessions/operator tokens by proxy.js (all /api/admin/*).

function errorResponse(code, message, status) {
    return NextResponse.json({ error: { code, message } }, { status });
}

function projectIdFrom(id) {
    return typeof id === 'string' ? id.trim() : '';
}

/**
 * PATCH /api/admin/tors/{id}/classification
 *
 * Manually override a TOR's classification and/or document status
 * (FR-1.2.2, FR-1.2.3). Body (at least one field besides reason):
 *   { isSoftware?: boolean, tags?: string[], processingStatus?: string,
 *     documentStatus?: string, reason?: string, enqueueProcessing?: boolean }
 */
export async function PATCH(request, { params }) {
    const projectId = projectIdFrom((await params).id);
    if (!projectId) return errorResponse('INVALID_TOR_ID', 'TOR id is required', 400);

    let body;
    try {
        body = await request.json();
    } catch {
        return errorResponse('INVALID_BODY', 'Request body must be a JSON object', 400);
    }
    const { value, error } = parseOverrideBody(body);
    if (error) return errorResponse('INVALID_OVERRIDE', error, 400);

    const reviewer = await reviewerFromRequest(request);
    if (!reviewer) return errorResponse('UNAUTHORIZED', 'Admin authentication required', 401);

    try {
        await connectDB();
        const { target, candidate } = await applyClassificationOverride(projectId, value, reviewer);
        if (target === 'candidate') {
            return NextResponse.json({
                id: projectId,
                target,
                status: candidate.status,
                classification: {
                    isSoftware: candidate.classification?.isSoftware ?? null,
                    status: candidate.classification?.status ?? null,
                    tags: candidate.classification?.tags ?? [],
                    reason: candidate.classification?.reason ?? null,
                },
            });
        }
        const project = await Project.findOne({ project_id: projectId }).lean();
        const detail = toTorDetail(await hydrateProjectCompatibility(project));
        // The reviewer is admin-only data, so it is not part of the public TOR shape.
        const reviewedBy = project.classification?.reviewed_by;
        detail.classification.reviewedBy = reviewedBy?.via
            ? { userId: reviewedBy.user_id ?? null, email: reviewedBy.email ?? null, via: reviewedBy.via }
            : null;
        return NextResponse.json(detail);
    } catch (error) {
        if (error instanceof OverrideError) return errorResponse(error.code, error.message, error.status);
        return errorResponse('CLASSIFICATION_OVERRIDE_FAILED', error.message, 500);
    }
}

/** GET /api/admin/tors/{id}/classification — override history, newest first. */
export async function GET(_request, { params }) {
    const projectId = projectIdFrom((await params).id);
    if (!projectId) return errorResponse('INVALID_TOR_ID', 'TOR id is required', 400);

    try {
        await connectDB();
        const items = await ClassificationOverride.find({ project_id: projectId })
            .sort({ created_at: -1 }).limit(100).lean();
        return NextResponse.json({ items: items.map(toOverrideHistoryItem) });
    } catch (error) {
        return errorResponse('CLASSIFICATION_HISTORY_FAILED', error.message, 500);
    }
}
