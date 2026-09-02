import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';

/**
 * Gate the admin area behind a valid session. Unauthenticated requests are
 * redirected to the login page ("/") with a ?next= hint so the callback can
 * send them back where they were headed.
 *
 * (Next 16 renamed the "middleware" convention to "proxy"; same API.)
 */
export async function proxy(request) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);

    if (!session) {
        const loginUrl = new URL('/', request.url);
        loginUrl.searchParams.set('next', request.nextUrl.pathname);
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/admin/:path*'],
};
