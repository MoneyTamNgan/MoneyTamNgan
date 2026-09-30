import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { OAUTH_STATE_COOKIE } from '@/lib/auth';

/**
 * GET /api/auth/google/login
 *
 * Start the Google OAuth authorization-code flow: set a short-lived `state`
 * cookie (CSRF guard) and redirect the browser to Google's consent screen.
 * Google returns to NEXT_PUBLIC_REDIRECT_URI (the /callback route).
 */
export async function GET(request) {
    const state = crypto.randomUUID();

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', process.env.NEXT_PUBLIC_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    // Preserve where the user was headed (set by middleware as ?next=...).
    const next = new URL(request.url).searchParams.get('next');

    const cookieStore = await cookies();
    cookieStore.set(OAUTH_STATE_COOKIE, `${state}|${next || ''}`, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 600, // 10 minutes
    });

    return NextResponse.redirect(authUrl.toString());
}
