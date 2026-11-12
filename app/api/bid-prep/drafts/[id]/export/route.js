import { NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import { exportDraft } from '@/lib/bid-prep/drafts';
import { bidPrepError, logBidPrepAudit, withBidPrep } from '@/lib/bid-prep/security';

export const runtime = 'nodejs';

async function handlePOST(request, context, { userId }) {
    await connectDB();
    const params = await context?.params;
    const result = await exportDraft(userId, params?.id);
    if (result.code) return bidPrepError(result.code, result.message, result.status);
    logBidPrepAudit(request, result.audit.event, { userId, draftId: result.audit.draftId, projectId: result.audit.projectId });
    return new NextResponse(result.file, {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="${result.filename}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

export const POST = withBidPrep(handlePOST, '/api/bid-prep/drafts/[id]/export', 'POST', 'export');
