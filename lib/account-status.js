import { verifySession } from './auth.js';

/**
 * ASVS V7.4.1 & V7.4.2: a session must stop working immediately on logout
 * (even if the JWT was copied) or as soon as its account is disabled or deleted.
 *
 * Every authenticated request checks process-local revocations and does one
 * `findById` on the primary key with only `disabled` and `session_version`
 * selected. If the lookup fails the session is refused (fail closed); routes
 * that are public still serve the request as a guest.
 */
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_REVOKED_ENTRIES = 10000;
const revokedTokens = new Set();

function recordRevokedKey(key) {
    if (!key) return;
    if (revokedTokens.size >= MAX_REVOKED_ENTRIES) {
        const oldest = revokedTokens.values().next().value;
        if (oldest !== undefined) revokedTokens.delete(oldest);
    }
    revokedTokens.add(key);
}

export function revokeSessionToken(token, session) {
    if (typeof token === 'string' && token) recordRevokedKey(token);
    if (typeof session?.jti === 'string' && session.jti) recordRevokedKey(session.jti);
}

export function clearRevokedSessions() {
    revokedTokens.clear();
}

async function defaultLookup(sub) {
    // Loaded on demand so importing this module never needs a database.
    const [{ default: connectDB }, { default: User }] = await Promise.all([import('./db.js'), import('../models/User.js')]);
    await connectDB();
    const user = await User.findById(sub).select('disabled session_version').lean();
    return user
        ? { exists: true, disabled: user.disabled === true, sessionVersion: user.session_version ?? 0 }
        : { exists: false, disabled: false, sessionVersion: 0 };
}

let lookup = defaultLookup;
let bumpHook = null;

/** Test hook: replace the account lookup. Call with no argument to restore it. */
export function setAccountLookup(fn, onInvalidate = null) {
    lookup = fn || defaultLookup;
    bumpHook = fn ? onInvalidate : null;
    if (!fn) clearRevokedSessions();
}

/** Increment DB session_version on logout so copied JWTs fail across instances. */
export async function invalidateUserSessions(sub) {
    if (!sub || !OBJECT_ID.test(sub)) return;
    if (typeof bumpHook === 'function') {
        await bumpHook(sub);
        return;
    }
    if (lookup !== defaultLookup) return;
    try {
        const [{ default: connectDB }, { User }] = await Promise.all([import('./db.js'), import('../models/User.js')]);
        await connectDB();
        await User.updateOne({ _id: sub }, { $inc: { session_version: 1 } });
    } catch {
        // Process-local token revocation remains active even if DB is unavailable.
    }
}

/**
 * True when the session may be used. Checks token-level revocations first, then
 * verifies DB status and `session_version` for MongoDB ObjectId subjects.
 */
export async function sessionAccountActive(session, rawToken) {
    if ((rawToken && revokedTokens.has(rawToken)) || (session?.jti && revokedTokens.has(session.jti))) {
        return false;
    }
    if (!session?.sub || !OBJECT_ID.test(session.sub)) return true;
    try {
        const account = await lookup(session.sub);
        if (account.exists !== true || account.disabled === true) return false;
        if (typeof account.sessionVersion === 'number' && (session.sv ?? 0) !== account.sessionVersion) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/** verifySession plus revocation & account check; null if invalid, revoked, or inactive. */
export async function verifyActiveSession(token) {
    const session = await verifySession(token);
    return session && await sessionAccountActive(session, token) ? session : null;
}
