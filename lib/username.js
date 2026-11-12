// Username rules shared by the User model, registration and the backfill script.
// Usernames are stored lowercase so the unique index is case-insensitive in effect.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/;

// Names that would look like built-in or privileged accounts (ASVS V6.3.2).
export const RESERVED_USERNAMES = new Set([
    'admin', 'administrator', 'root', 'system', 'support', 'security', 'moderator',
    'superuser', 'staff', 'api', 'null', 'undefined', 'moneytamngan',
]);

/** Returns the normalized username, or null when it is not acceptable. */
export function normalizeUsername(value) {
    if (typeof value !== 'string') return null;
    const username = value.trim().toLowerCase();
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return null;
    if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(username)) return null;
    return username;
}

function sanitize(base) {
    const cleaned = String(base ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/[._-]{2,}/g, '-')
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
    return cleaned;
}

/**
 * Builds a valid username from an email's local part. `taken` is a Set of
 * lowercase usernames that are already in use; the result is not in it.
 * The caller is responsible for adding the result to `taken`.
 */
export function deriveUsername(email, taken = new Set()) {
    const local = typeof email === 'string' ? email.split('@')[0] : '';
    let base = sanitize(local).slice(0, USERNAME_MAX - 5);
    if (base.length < USERNAME_MIN) base = sanitize(`user-${base}`).slice(0, USERNAME_MAX - 5);
    let candidate = base;
    let suffix = 1;
    while (!normalizeUsername(candidate) || taken.has(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }
    return candidate;
}

/**
 * Plans a backfill for users that have no username. Pure: it reads `users`
 * ({ _id, email, username? }) and returns [{ id, username }] in input order.
 * Existing usernames are never changed and never reused.
 */
export function planUsernameBackfill(users) {
    const taken = new Set();
    for (const user of users) {
        if (typeof user.username === 'string' && user.username) taken.add(user.username.toLowerCase());
    }
    const plan = [];
    for (const user of users) {
        if (typeof user.username === 'string' && user.username) continue;
        const username = deriveUsername(user.email, taken);
        taken.add(username);
        plan.push({ id: user._id, username });
    }
    return plan;
}
