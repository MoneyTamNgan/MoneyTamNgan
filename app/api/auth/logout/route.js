import { withRouteSecurity } from "@/lib/route-security";
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionCookieOptions, verifySession } from '@/lib/auth';
import { invalidateUserSessions, revokeSessionToken } from '@/lib/account-status';
import { logAuthAudit } from '@/lib/auth-audit';

function extractLogoutToken(request, cookieStore) {
    const bearer = request?.headers?.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (bearer) return bearer;
    const reqCookie = request?.cookies?.get?.(SESSION_COOKIE)?.value;
    if (reqCookie) return reqCookie;
    const rawCookieHeader = request?.headers?.get('cookie');
    if (rawCookieHeader) {
        const part = rawCookieHeader.split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`));
        if (part) {
            try { return decodeURIComponent(part.slice(SESSION_COOKIE.length + 1)); } catch { return null; }
        }
    }
    return cookieStore?.get?.(SESSION_COOKIE)?.value || null;
}

/** POST /api/auth/logout — clear session cookie and revoke the presented JWT. */
async function handlePOST(request) {
    let cookieStore = null;
    try {
        cookieStore = await cookies();
    } catch {
        // Direct unit tests outside a Next request context rely on request headers/cookies.
    }
    const token = extractLogoutToken(request, cookieStore);
    const session = await verifySession(token);

    if (session) {
        revokeSessionToken(token, session);
        await invalidateUserSessions(session.sub);
    }

    logAuthAudit(
        request,
        'auth_logout',
        session ? 'session_revoked' : 'guest_logout',
        session?.sub ? { userId: String(session.sub) } : undefined
    );

    if (cookieStore) cookieStore.delete(SESSION_COOKIE);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
    return response;
}

export const POST = withRouteSecurity(handlePOST, "/api/auth/logout", "POST");
