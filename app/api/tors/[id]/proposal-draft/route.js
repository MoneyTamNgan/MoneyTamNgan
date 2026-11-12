import { withRouteSecurity } from '@/lib/route-security';
import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import Project from '@/models/Project';
import ProcessingJob from '@/models/ProcessingJob';
import { hydrateProjectCompatibility } from '@/lib/project-compat';
import { enqueueProposalDraft } from '@/lib/job-queue';
import { requestPrincipal } from '@/lib/request-authorization';
import { rateLimitHeaders } from '@/lib/rate-limit';
import { normalizeTor, presentProposalDraft, logProposalEvent, proposalDraftJobFilter } from '@/lib/proposal/draft';
import { takeProposalDraftSlot } from '@/lib/proposal/limit';

export const runtime = 'nodejs';

function error(status, code, message, headers) {
    return NextResponse.json({ error: { code, message } }, { status, headers });
}

async function ownerId(request) {
    return (await requestPrincipal(request))?.session?.sub || null;
}

function hasExtractedFacts(tor) {
    return Boolean(tor.summary || tor.scope_of_work.length || tor.qualifications.length || tor.tech_stack.length);
}

/** POST /api/tors/{id}/proposal-draft — enqueue only; the worker calls Vertex. */
async function handlePOST(request, { params }) {
    const { id } = await params;
    const projectId = typeof id === 'string' ? id.trim() : '';
    if (!projectId) return error(400, 'INVALID_TOR_ID', 'TOR id is required');
    const userId = await ownerId(request);
    if (!userId) return error(401, 'UNAUTHORIZED', 'Authentication required');

    try {
        await connectDB();
        const project = await Project.findOne({ project_id: projectId }).lean();
        if (!project) return error(404, 'TOR_NOT_FOUND', `No TOR exists with id: ${projectId}`);
        const tor = normalizeTor(await hydrateProjectCompatibility(project));
        if (!hasExtractedFacts(tor)) {
            return error(409, 'TOR_NOT_EXTRACTED', 'This TOR has no extracted summary, scope, qualifications, or technology yet.');
        }
        const hit = takeProposalDraftSlot(userId);
        if (!hit.allowed) {
            return error(429, 'PROPOSAL_DRAFT_RATE_LIMITED',
                `Proposal draft limit reached. Try again in ${hit.retryAfterSeconds} seconds.`,
                rateLimitHeaders(hit));
        }
        const { job, reused } = await enqueueProposalDraft({ projectId, ownerId: userId });
        logProposalEvent({ event: reused ? 'reused' : 'enqueued', jobId: job._id, status: job.status });
        return NextResponse.json({
            status: 'accepted',
            jobId: String(job._id),
            jobStatus: job.status,
            reused: Boolean(reused),
        }, { status: 202 });
    } catch {
        logProposalEvent({ event: 'enqueue_failed', status: 'failed', code: 'PROPOSAL_DRAFT_ENQUEUE_FAILED' });
        return error(500, 'PROPOSAL_DRAFT_ENQUEUE_FAILED', 'The proposal draft could not be queued.');
    }
}

/** GET /api/tors/{id}/proposal-draft?jobId= — the caller's own job only. */
async function handleGET(request, { params }) {
    const { id } = await params;
    const projectId = typeof id === 'string' ? id.trim() : '';
    const jobId = new URL(request.url).searchParams.get('jobId') || '';
    if (!projectId) return error(400, 'INVALID_TOR_ID', 'TOR id is required');
    if (!/^[a-f0-9]{24}$/i.test(jobId)) return error(400, 'INVALID_JOB_ID', 'jobId must be the queued proposal draft id');
    const userId = await ownerId(request);
    if (!userId) return error(401, 'UNAUTHORIZED', 'Authentication required');

    try {
        await connectDB();
        const job = await ProcessingJob.findOne(proposalDraftJobFilter({
            projectId, jobId, ownerId: userId,
        })).lean();
        if (!job) return error(404, 'PROPOSAL_DRAFT_NOT_FOUND', 'No proposal draft job exists for this TOR');
        const body = {
            jobId: String(job._id),
            status: job.status,
            error: job.status === 'failed' ? (job.error || null) : null,
        };
        if (job.status === 'completed' && job.result?.draft) {
            const draft = presentProposalDraft(job.result.draft);
            body.draft = draft;
            body.warning = draft.warning;
            body.model = job.result.model || draft.model;
            body.prompt_version = job.result.prompt_version || draft.prompt_version;
        }
        return NextResponse.json(body);
    } catch {
        logProposalEvent({ event: 'read_failed', status: 'failed', code: 'PROPOSAL_DRAFT_READ_FAILED' });
        return error(500, 'PROPOSAL_DRAFT_READ_FAILED', 'The proposal draft could not be read.');
    }
}

export const POST = withRouteSecurity(handlePOST, '/api/tors/[id]/proposal-draft', 'POST');
export const GET = withRouteSecurity(handleGET, '/api/tors/[id]/proposal-draft', 'GET');
