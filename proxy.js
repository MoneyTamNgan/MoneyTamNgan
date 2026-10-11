import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth';
import { timingSafeEqual } from 'node:crypto';

/**
 * Gate the signed-in area behind a valid session. Unauthenticated requests are
 * redirected to the login page ("/") with a ?next= hint so the callback can
 * send them back where they were headed.
 *
 * (Next 16 renamed the "middleware" convention to "proxy"; same API.)
 */
export async function proxy(request) {
    const pathname = request.nextUrl.pathname;
    const isApi = pathname.startsWith('/api/');
    const mutates = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (isApi && !mutates && !pathname.startsWith('/api/admin/')) return NextResponse.next();
    if (isApi) {
        const configured = process.env.PIPELINE_ADMIN_TOKEN || '';
        const supplied = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
        const expectedBytes = Buffer.from(configured), suppliedBytes = Buffer.from(supplied);
        if (configured.length >= 32 && expectedBytes.length === suppliedBytes.length
            && timingSafeEqual(expectedBytes, suppliedBytes)) return NextResponse.next();
    }
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);

    if (isApi) {
        if (!session) return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Admin authentication required' } }, { status: 401 });
        if (session.role !== 'admin') return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Admin role required' } }, { status: 403 });
        if (mutates) {
            const origin = request.headers.get('origin');
            const expectedOrigin = process.env.APP_ORIGIN || new URL(request.url).origin;
            if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== expectedOrigin)) {
                return NextResponse.json({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin mutation denied' } }, { status: 403 });
            }
        }
        return NextResponse.next();
    }

    if (!session) {
        const loginUrl = new URL('/', request.url);
        loginUrl.searchParams.set('next', request.nextUrl.pathname);
        return NextResponse.redirect(loginUrl);
    }
    if (pathname.startsWith('/admin') && session.role !== 'admin') {
        return new NextResponse('Admin role required', { status: 403 });
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/admin/:path*',
        '/dashboard/:path*',
        '/profile/:path*',
        '/analytics/:path*',
        '/tors/:path*',
        '/api/admin/:path*',
        '/api/ingestion/:path*',
        '/api/processing/:path*',
        '/api/scraping/:path*',
        '/api/projects/:id/classification',
    ],
};
