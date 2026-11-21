import { withRouteSecurity } from "@/lib/route-security";
/**
 * POST /api/notifications/test
 *
 * Sends a test match-notification email to the currently authenticated user.
 * Useful for verifying the email template and selected SMTP/Resend transport.
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

const MAX_BODY_BYTES = 16384;
const MAX_MATCHES = 20;

function validateMatchesArray(raw) {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_MATCHES) {
        return { error: { code: 'INVALID_MATCHES', message: 'matches must be an array of 1 to 20 items' } };
    }
    const cleaned = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return { error: { code: 'INVALID_MATCHES', message: 'Each match item requires valid torId, title, agency, budget, and matchScore' } };
        }
        const { torId, title, agency, budget, matchScore } = item;
        if (
            typeof torId !== 'string' || !torId.trim() || torId.length > 64
            || typeof title !== 'string' || !title.trim() || title.length > 300
            || typeof agency !== 'string' || agency.length > 200
            || typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0 || budget > 1e15
            || typeof matchScore !== 'number' || !Number.isFinite(matchScore) || matchScore < 0 || matchScore > 100
        ) {
            return { error: { code: 'INVALID_MATCHES', message: 'Each match item requires valid torId, title, agency, budget, and matchScore' } };
        }
        cleaned.push({
            torId: torId.trim(),
            title: title.trim(),
            agency,
            budget,
            matchScore,
        });
    }
    return { matches: cleaned };
}

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

    // ── Build and validate test payload ───────────────────────────────────────
    let body = {};
    if (typeof req.text === 'function') {
        const rawText = await req.text().catch(() => '');
        if (Buffer.byteLength(rawText, 'utf8') > MAX_BODY_BYTES) {
            return NextResponse.json(
                { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds 16 KiB limit' } },
                { status: 413 }
            );
        }
        if (rawText.trim()) {
            try {
                body = JSON.parse(rawText);
            } catch {
                return NextResponse.json(
                    { error: { code: 'INVALID_BODY', message: 'Request body must be valid JSON' } },
                    { status: 400 }
                );
            }
        }
    } else if (typeof req.json === 'function') {
        body = await req.json().catch(() => ({}));
        if (body && Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
            return NextResponse.json(
                { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload exceeds 16 KiB limit' } },
                { status: 413 }
            );
        }
    }

    if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
        return NextResponse.json(
            { error: { code: 'INVALID_BODY', message: 'Request body must be a JSON object' } },
            { status: 400 }
        );
    }

    let matches = null;
    if (body && body.matches !== undefined && body.matches !== null) {
        const validated = validateMatchesArray(body.matches);
        if (validated.error) {
            return NextResponse.json({ error: validated.error }, { status: 400 });
        }
        matches = validated.matches;
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
            { error: 'Failed to send email. Check email transport configuration and server logs.' },
            { status: 500 }
        );
    }

    return NextResponse.json({ status: 'success', emailId: result.id, sentTo: user.email });
}

export const POST = withRouteSecurity(handlePOST, "/api/notifications/test", "POST");
