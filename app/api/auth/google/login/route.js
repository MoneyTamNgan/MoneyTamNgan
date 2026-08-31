import { NextResponse } from 'next/server';

export async function GET() {
    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

    googleAuthUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    googleAuthUrl.searchParams.set('redirect_uri', process.env.NEXT_PUBLIC_REDIRECT_URI);
    googleAuthUrl.searchParams.set('response_type', 'code');
    googleAuthUrl.searchParams.set('scope', 'openid email profile');
    googleAuthUrl.searchParams.set('access_type', 'offline');
    googleAuthUrl.searchParams.set('prompt', 'consent');

    return NextResponse.json({
        status: 'success',
        authorization_url: googleAuthUrl.toString(),
    });
}