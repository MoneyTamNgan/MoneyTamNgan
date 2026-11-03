import { SignJWT, jwtVerify } from 'jose';

/**
 * Session helpers shared by the auth route handlers (Node runtime) and
 * `middleware.js` (Edge runtime). `jose` works in both, unlike `jsonwebtoken`.
 */

export const SESSION_COOKIE = 'mtn_session';
export const OAUTH_STATE_COOKIE = 'mtn_oauth_state';

const SESSION_MAX_AGE = 60 * 60 * 24; // 24h, in seconds
export const ROLE_SCOPES = Object.freeze({
    user: ['tor:read', 'profile:read', 'profile:write', 'session:write', 'notifications:test'],
    admin: ['tor:read', 'profile:read', 'profile:write', 'session:write', 'notifications:test',
        'tor:write', 'admin:read', 'admin:write', 'pipeline:read', 'pipeline:trigger', 'notifications:send'],
    pipeline: ['pipeline:read', 'pipeline:trigger'],
});

export function hasScope(session, scope) {
    return Boolean(session?.sub && ROLE_SCOPES[session.role]?.includes(scope)
        && Array.isArray(session.scopes) && session.scopes.includes(scope));
}

function secretKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    return new TextEncoder().encode(secret);
}

/** Sign a session token. `payload` is typically { sub, email, role }. */
export async function signSession(payload) {
    const role = payload.role || 'user';
    if (!ROLE_SCOPES[role]) throw new TypeError('Unknown session role');
    const scopes = payload.scopes ?? ROLE_SCOPES[role];
    if (!Array.isArray(scopes) || scopes.some(scope => !ROLE_SCOPES[role].includes(scope))) throw new TypeError('Scope is not permitted for this role');
    return new SignJWT({ ...payload, role, scopes: [...new Set(scopes)], auth_version: 2 })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_MAX_AGE}s`)
        .sign(secretKey());
}

/** Verify a session token. Returns the payload, or null if missing/invalid/expired. */
export async function verifySession(token) {
    if (!token) return null;
    try {
        const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
        if (payload.auth_version !== 2 || typeof payload.sub !== 'string' || !payload.sub
            || !ROLE_SCOPES[payload.role] || !Array.isArray(payload.scopes)
            || payload.scopes.some(scope => !ROLE_SCOPES[payload.role].includes(scope))) return null;
        return payload;
    } catch {
        return null;
    }
}

/** Cookie options for the session cookie. */
export function sessionCookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_MAX_AGE,
    };
}

/**
 * Check if an email address is listed in the ADMIN_EMAILS environment variable.
 * Expects a comma-separated list of emails. Case-insensitive and trimmed.
 */
export function isConfiguredAdmin(email) {
    if (!email || typeof email !== 'string') return false;
    const configured = process.env.ADMIN_EMAILS || '';
    const adminEmails = configured
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    return adminEmails.includes(email.trim().toLowerCase());
}
