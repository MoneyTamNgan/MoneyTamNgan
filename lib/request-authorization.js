import { SESSION_COOKIE, verifySession, hasScope } from './auth.js';
import { isPipelineAuthorized, isCronAuthorized } from './pipeline-auth.js';

export async function requestPrincipal(request) {
    const authorization = request?.headers?.get('authorization');
    if (authorization) {
        if (isPipelineAuthorized(request)) return { kind: 'pipeline', scopes: ['pipeline:read', 'pipeline:trigger'] };
        if (isCronAuthorized(request)) return { kind: 'cron', scopes: ['notifications:send'] };
        const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
        const session = await verifySession(token);
        return session ? { kind: 'bearer', session } : null;
    }
    let token = request?.cookies?.get(SESSION_COOKIE)?.value;
    if (!token) {
        const part = request?.headers?.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`));
        try { token = part ? decodeURIComponent(part.slice(SESSION_COOKIE.length + 1)) : undefined; } catch { return null; }
    }
    const session = await verifySession(token);
    return session ? { kind: 'cookie', session } : null;
}

export function permissionFor(path, method = 'GET') {
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (['/api/auth/google/login', '/api/auth/google/callback', '/api/auth/login', '/api/auth/register', '/api/health'].includes(path)) return { public: true };
    if (path === '/api/auth/me') return { scope: 'profile:read' };
    if (path === '/api/auth/logout') return { public: true }; // idempotent cookie clear; Origin still required
    if (['/api/profile', '/api/profiles'].includes(path)) return { scope: read ? 'profile:read' : 'profile:write' };
    if (path === '/api/notifications/test') return { scope: 'notifications:test' };
    if (path === '/api/notifications/digest') return { scope: 'notifications:send', admin: true, mutation: true };
    if (path === '/api/test-db') return { scope: 'admin:read', admin: true };
    if (path.startsWith('/api/admin/') || path === '/api/processing/review') return {
        scope: read ? 'admin:read' : path.includes('/tors/') ? 'tor:write' : 'admin:write', admin: true,
    };
    if (/^\/api\/projects\/[^/]+\/classification$/.test(path)) return { scope: 'tor:write', admin: true };
    if (/^\/api\/(processing|ingestion|scraping)\//.test(path)) return { scope: read ? 'pipeline:read' : 'pipeline:trigger' };
    if (read && /^\/api\/(tors|projects|analytics)(\/|$)/.test(path)) return { scope: 'tor:read', public: true };
    return { scope: 'admin:write', admin: true }; // unknown mutations fail closed
}

export function principalAllowed(principal, permission) {
    if (!principal) return Boolean(permission.public);
    if (!permission.scope) return true;
    if (principal.kind === 'pipeline') return !permission.admin && principal.scopes.includes(permission.scope);
    if (principal.kind === 'cron') return permission.scope === 'notifications:send';
    return (!permission.admin || principal.session?.role === 'admin') && hasScope(principal.session, permission.scope);
}

export async function authorizeScopeRequest(request, permission) {
    const principal = await requestPrincipal(request);
    const credentials = request?.headers?.get('authorization') || request?.cookies?.get(SESSION_COOKIE)?.value
        || request?.headers?.get('cookie')?.includes(`${SESSION_COOKIE}=`);
    if (!principal && credentials && (!permission.public || request?.headers?.get('authorization'))) return { authorized: false, status: 401, code: 'UNAUTHORIZED', message: 'Session expired or invalid; sign in again' };
    if (!principalAllowed(principal, permission)) return { authorized: false, status: principal ? 403 : 401,
        code: principal ? 'INSUFFICIENT_SCOPE' : 'UNAUTHORIZED', message: principal ? 'Required permission is missing' : 'Authentication required' };
    return { authorized: true, principal };
}
