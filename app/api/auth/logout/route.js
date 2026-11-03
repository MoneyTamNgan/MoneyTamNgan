import { withRouteSecurity } from "@/lib/route-security";
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';

/** POST /api/auth/logout — clear the session cookie. */
async function handlePOST() {
    (await cookies()).delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
}

export const POST = withRouteSecurity(handlePOST, "/api/auth/logout", "POST");
