import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { connectToDatabase } from '@/lib/mongodb';
import { User } from '@/models/User';
import {
    SESSION_COOKIE,
    OAUTH_STATE_COOKIE,
    signSession,
    sessionCookieOptions,
} from '@/lib/auth';

/**
 * GET /api/auth/google/callback
 *
 * Google redirects here with `?code` and `?state`. We verify `state` against
 * the cookie set by /login, exchange the code for tokens, upsert the user,
 * then set an httpOnly session cookie and redirect into the app.
 */
export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    const cookieStore = await cookies();
    const stateCookie = cookieStore.get(OAUTH_STATE_COOKIE)?.value || '';
    const [expectedState, next] = stateCookie.split('|');
    cookieStore.delete(OAUTH_STATE_COOKIE);

    if (!code) {
        return NextResponse.json({ error: 'Authorization code is missing' }, { status: 400 });
    }
    if (!state || !expectedState || state !== expectedState) {
        return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
    }

    try {
        // 1. Exchange the authorization code for Google tokens.
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.NEXT_PUBLIC_REDIRECT_URI,
            }),
        });
        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            return NextResponse.json(
                { error: 'Token exchange failed', details: tokenData },
                { status: 400 }
            );
        }

        // 2. Look up the Google profile.
        const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const googleUser = await userResponse.json();
        if (!googleUser?.email) {
            return NextResponse.json({ error: 'Could not read Google profile' }, { status: 400 });
        }

        // 3. Upsert the user.
        await connectToDatabase();
        const user = await User.findOneAndUpdate(
            { email: googleUser.email },
            {
                $set: {
                    name: googleUser.name,
                    googleId: googleUser.id,
                    picture: googleUser.picture,
                    updatedAt: new Date(),
                },
            },
            { upsert: true, new: true }
        );

        // 4. Issue the session cookie and redirect into the app.
        const token = await signSession({
            sub: user._id.toString(),
            email: user.email,
            role: user.role,
        });

        const destination = next && next.startsWith('/') ? next : '/dashboard';
        const response = NextResponse.redirect(new URL(destination, request.url));
        response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
        return response;
    } catch (error) {
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
