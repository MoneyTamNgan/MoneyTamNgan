import { withRouteSecurity } from "@/lib/route-security";
/**
 * POST /api/notifications/test
 *
 * Sends a test match-notification email to the currently authenticated user.
 * Useful for verifying the email template and Resend integration.
 *
 * Body (optional JSON):
 *   { "matches": [{ "torId", "title", "agency", "budget", "matchScore" }] }
 *   Omit `matches` to receive a sample payload.
 */
import { NextResponse } from 'next/server';
import { requestPrincipal } from '@/lib/request-authorization';
import connectDB from '@/lib/db';
import { User } from '@/models/User';
import { sendMatchNotificationEmail } from '@/lib/email';

async function handlePOST(req) {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const session = (await requestPrincipal(req))?.session;
    if (!session?.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();
    const user = await User.findById(session.sub).lean();
    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // ── Build test payload ────────────────────────────────────────────────────
    let matches;
    try {
        const body = await req.json().catch(() => ({}));
        matches = Array.isArray(body.matches) ? body.matches : null;
    } catch {
        matches = null;
    }

    if (!matches) {
        matches = [
            {
                torId: 'TEST-001',
                title: 'โครงการพัฒนาระบบ ERP สำหรับหน่วยงานภาครัฐ',
                agency: 'กรมบัญชีกลาง',
                budget: 5000000,
                matchScore: 85,
            },
            {
                torId: 'TEST-002',
                title: 'จัดหาและติดตั้งระบบ iPaaS เชื่อมต่อหน่วยงาน',
                agency: 'สำนักงาน ก.พ.ร.',
                budget: 2500000,
                matchScore: 72,
            },
        ];
    }

    // ── Send ──────────────────────────────────────────────────────────────────
    const result = await sendMatchNotificationEmail({
        to: user.email,
        userName: user.name || user.company_name || '',
        matches,
    });

    if (!result) {
        return NextResponse.json(
            { error: 'Failed to send email. Check RESEND_API_KEY and server logs.' },
            { status: 500 }
        );
    }

    return NextResponse.json({ status: 'success', emailId: result.id, sentTo: user.email });
}

export const POST = withRouteSecurity(handlePOST, "/api/notifications/test", "POST");
