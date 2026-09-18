import { SignJWT, jwtVerify } from 'jose';

/**
 * Session helpers shared by the auth route handlers (Node runtime) and
 * `middleware.js` (Edge runtime). `jose` works in both, unlike `jsonwebtoken`.
 */

export const SESSION_COOKIE = 'mtn_session';
export const OAUTH_STATE_COOKIE = 'mtn_oauth_state';

const SESSION_MAX_AGE = 60 * 60 * 24; // 24h, in seconds

function secretKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    return new TextEncoder().encode(secret);
}

/** Sign a session token. `payload` is typically { sub, email, role }. */
export async function signSession(payload) {
    return new SignJWT(payload)
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
