import connectDB from '@/lib/db';
import { checklistForUser, updateChecklistStatus } from '@/lib/bid-prep/checklist';
import { bidPrepError, readJson, withBidPrep } from '@/lib/bid-prep/security';

export const runtime = 'nodejs';

async function handleGET(_request, context, { userId }) {
    await connectDB();
    const params = await context?.params;
    const result = await checklistForUser(userId, params?.projectId);
    if (result.code) return bidPrepError(result.code, result.message, result.status);
    return Response.json(result.body, { status: 200 });
}

export const GET = withBidPrep(handleGET, '/api/bid-prep/tors/[projectId]/checklist', 'GET', 'read');

async function handlePATCH(request, context, { userId }) {
    const { value, error } = await readJson(request, { maxBytes: 1024 });
    if (error) return bidPrepError(error.code, error.message, error.status);
    const { projectId } = await context.params;
    await connectDB();
    const result = await updateChecklistStatus(userId, projectId, value);
    if (result.code) return bidPrepError(result.code, result.message, result.status);
    return Response.json(result.body, { status: 200 });
}

export const PATCH = withBidPrep(handlePATCH, '/api/bid-prep/tors/[projectId]/checklist', 'PATCH', 'write');
