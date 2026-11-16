import { verifySession } from './auth.js';

/**
 * ASVS V7.4.2: a session must stop working as soon as its account is disabled
 * or deleted, even though the JWT itself is still valid for up to 24 hours.
 *
 * Every authenticated request does one `findById` on the primary key with only
 * the `disabled` field selected. There is no cache on purpose, so revocation is
 * immediate. If the lookup fails the session is refused (fail closed); routes
 * that are public still serve the request as a guest.
 */
const OBJECT_ID = /^[a-f0-9]{24}$/i;

async function defaultLookup(sub) {
    // Loaded on demand so importing this module never needs a database.
    const [{ default: connectDB }, { default: User }] = await Promise.all([import('./db.js'), import('../models/User.js')]);
    await connectDB();
    const user = await User.findById(sub).select('disabled').lean();
    return user ? { exists: true, disabled: user.disabled === true } : { exists: false, disabled: false };
}

let lookup = defaultLookup;

/** Test hook: replace the account lookup. Call with no argument to restore it. */
export function setAccountLookup(fn) { lookup = fn || defaultLookup; }

/**
 * True when the session may be used. Sessions whose `sub` is not a MongoDB
 * ObjectId were not issued by our sign-in flows (which always use the user's
 * `_id`), so there is no account record to check.
 */
export async function sessionAccountActive(session) {
    if (!session?.sub || !OBJECT_ID.test(session.sub)) return true;
    try {
        const account = await lookup(session.sub);
        return account.exists === true && account.disabled !== true;
    } catch {
        return false;
    }
}

/** verifySession plus the account check; null if the token is bad or the account is not active. */
export async function verifyActiveSession(token) {
    const session = await verifySession(token);
    return session && await sessionAccountActive(session) ? session : null;
}
