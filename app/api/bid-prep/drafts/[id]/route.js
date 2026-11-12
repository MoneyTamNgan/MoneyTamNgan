import connectDB from '@/lib/db';
import { getDraft, removeDraft, updateDraft } from '@/lib/bid-prep/drafts';
import { bidPrepError, readJson, withBidPrep } from '@/lib/bid-prep/security';

export const runtime = 'nodejs';

function send(result) {
    if (result.code) return bidPrepError(result.code, result.message, result.status);
    return Response.json(result.body, { status: result.status });
}

async function idFrom(context) {
    const params = await context?.params;
    return params?.id;
}

async function handleGET(_request, context, { userId }) {
    await connectDB();
    return send(await getDraft(userId, await idFrom(context)));
}

async function handlePATCH(request, context, { userId }) {
    const parsed = await readJson(request, { maxBytes: 128 * 1024 });
    if (parsed.error) return bidPrepError(parsed.error.code, parsed.error.message, parsed.error.status);
    await connectDB();
    return send(await updateDraft(userId, await idFrom(context), parsed.value));
}

async function handleDELETE(_request, context, { userId }) {
    await connectDB();
    return send(await removeDraft(userId, await idFrom(context)));
}

const item = '/api/bid-prep/drafts/[id]';
export const GET = withBidPrep(handleGET, item, 'GET', 'read');
export const PATCH = withBidPrep(handlePATCH, item, 'PATCH', 'write');
export const DELETE = withBidPrep(handleDELETE, item, 'DELETE', 'write');
