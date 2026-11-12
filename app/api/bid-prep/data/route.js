import connectDB from '@/lib/db';
import { deleteCompanyBidData } from '@/lib/bid-prep/deletion';
import { DELETE_COMPANY_DATA_CONFIRMATION } from '@/lib/bid-prep/notices';
import { bidPrepError, logBidPrepAudit, readJson, withBidPrep } from '@/lib/bid-prep/security';

export const runtime = 'nodejs';

async function handleDELETE(request, _context, { userId }) {
    const parsed = await readJson(request, { maxBytes: 4096 });
    if (parsed.error) return bidPrepError(parsed.error.code, parsed.error.message, parsed.error.status);
    if (parsed.value.confirm !== DELETE_COMPANY_DATA_CONFIRMATION) {
        return bidPrepError('CONFIRMATION_REQUIRED', 'Confirmation is required.', 400);
    }
    await connectDB();
    const result = await deleteCompanyBidData(userId);
    if (!result.ok) return bidPrepError(result.code, result.message, result.status);
    logBidPrepAudit(request, 'bid_prep_data_deleted', { userId, scope: 'company', draftsDeleted: result.draftsDeleted });
    return Response.json({ status: 'deleted', draftsDeleted: result.draftsDeleted }, { status: 200 });
}

export const DELETE = withBidPrep(handleDELETE, '/api/bid-prep/data', 'DELETE', 'delete');
