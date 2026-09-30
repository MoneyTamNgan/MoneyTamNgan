import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth';

/** POST /api/auth/logout — clear the session cookie. */
export async function POST() {
    (await cookies()).delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
}
