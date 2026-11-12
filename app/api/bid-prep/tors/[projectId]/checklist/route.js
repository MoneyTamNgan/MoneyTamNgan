import connectDB from '@/lib/db';
import { checklistForUser } from '@/lib/bid-prep/checklist';
import { bidPrepError, withBidPrep } from '@/lib/bid-prep/security';

export const runtime = 'nodejs';

async function handleGET(_request, context, { userId }) {
    await connectDB();
    const params = await context?.params;
    const result = await checklistForUser(userId, params?.projectId);
    if (result.code) return bidPrepError(result.code, result.message, result.status);
    return Response.json(result.body, { status: 200 });
}

export const GET = withBidPrep(handleGET, '/api/bid-prep/tors/[projectId]/checklist', 'GET', 'read');
