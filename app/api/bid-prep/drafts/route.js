import connectDB from '@/lib/db';
import { createDraft, listDrafts } from '@/lib/bid-prep/drafts';
import { bidPrepError, logBidPrepAudit, readJson, withBidPrep } from '@/lib/bid-prep/security';

export const runtime = 'nodejs';

function send(result) {
    if (result.code) return bidPrepError(result.code, result.message, result.status);
    return Response.json(result.body, { status: result.status });
}

async function handleGET(_request, _context, { userId }) {
    await connectDB();
    return send(await listDrafts(userId));
}

async function handlePOST(request, _context, { userId }) {
    const parsed = await readJson(request, { maxBytes: 128 * 1024 });
    if (parsed.error) return bidPrepError(parsed.error.code, parsed.error.message, parsed.error.status);
    await connectDB();
    const result = await createDraft(userId, parsed.value);
    if (result.audit) logBidPrepAudit(request, result.audit.event, { userId, draftId: result.audit.draftId, projectId: result.audit.projectId });
    return send(result);
}

export const GET = withBidPrep(handleGET, '/api/bid-prep/drafts', 'GET', 'read');
export const POST = withBidPrep(handlePOST, '/api/bid-prep/drafts', 'POST', 'draft-create');
