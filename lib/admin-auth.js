import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, verifySession } from './auth.js';

/** Operator bearer authentication uses the existing configured pipeline token,
 * never an arbitrary bearer string or a browser-supplied role header. */
export function isPipelineAuthorized(request) {
    const configured = process.env.PIPELINE_ADMIN_TOKEN || '';
    const supplied = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const expectedBytes = Buffer.from(configured), suppliedBytes = Buffer.from(supplied);
    return configured.length >= 32 && expectedBytes.length === suppliedBytes.length
        && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function authorizeAdminRequest(request) {
    if (isPipelineAuthorized(request)) return { authorized: true, method: 'bearer' };
    let token = request.cookies?.get(SESSION_COOKIE)?.value;
    if (!token) {
        const cookie = request.headers.get('cookie')?.split(';').map(item => item.trim())
            .find(item => item.startsWith(`${SESSION_COOKIE}=`));
        try { token = cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : undefined; }
        catch { token = undefined; }
    }
    const session = await verifySession(token);
    if (!session) return { authorized: false, status: 401, code: 'UNAUTHORIZED', message: 'Admin authentication required' };
    if (session.role !== 'admin') return { authorized: false, status: 403, code: 'FORBIDDEN', message: 'Admin role required' };
    return { authorized: true, method: 'session' };
}
