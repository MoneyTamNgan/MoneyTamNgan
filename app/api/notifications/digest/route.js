import { withRouteSecurity } from "@/lib/route-security";
/**
 * POST /api/notifications/digest
 *
 * Sends the daily digest to all DAILY_DIGEST users.
 * Should be called by a cron job / scheduled task.
 *
 * Protected by a shared secret header:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Dispatches persisted pending matches; request bodies cannot inject projects.
 */
import { NextResponse } from 'next/server';
import { sendDailyDigest } from '@/lib/services/notification-service';

async function handlePOST() {
    // Dispatch only persisted new-project matches. Never rescan an arbitrary recent-project window.
    const result = await sendDailyDigest();
    return NextResponse.json({ status: 'success', ...result });
}
async function handleGET() {
    const result = await sendDailyDigest();
    return NextResponse.json({ status: 'success', ...result });
}

export const POST = withRouteSecurity(handlePOST, "/api/notifications/digest", "POST");
export const GET = withRouteSecurity(handleGET, "/api/notifications/digest", "GET");
