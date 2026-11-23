/**
 * Grant or revoke the admin role for one account.
 *
 * The role is carried in the signed session token, so a role change must also end the
 * account's existing sessions: session_version is bumped (the same mechanism logout
 * uses, see lib/account-status.js). The person then signs in again and gets a token
 * with the new role. A demoted admin loses access at once instead of at token expiry.
 *
 * `User` is the Mongoose model (or a stand-in with findOne and findOneAndUpdate).
 * `record` receives one audit entry per real change.
 */
export const ROLES = Object.freeze(['user', 'admin']);

export async function changeUserRole({ User, email, role, actor = 'unknown', now = new Date(), record = async () => {} }) {
    if (!ROLES.includes(role)) throw new RangeError(`role must be one of ${ROLES.join(', ')}`);
    const normalized = String(email ?? '').trim().toLowerCase();
    if (!normalized) throw new RangeError('email is required');

    const existing = await User.findOne({ email: normalized }).select('role name email');
    if (!existing) return { found: false, changed: false };

    const previousRole = existing.role ?? 'user';
    if (previousRole === role) return { found: true, changed: false, user: existing, previousRole };

    const user = await User.findOneAndUpdate(
        { _id: existing._id },
        { $set: { role, updatedAt: now }, $inc: { session_version: 1 } },
        // strict: false keeps the session_version bump even if this process loaded an older
        // User model without that field; Mongoose would otherwise drop it without any error.
        { returnDocument: 'after', strict: false },
    );
    await record({
        event: 'role_changed',
        userId: String(existing._id),
        email: normalized,
        from: previousRole,
        to: role,
        actor: String(actor).slice(0, 128),
        at: now.toISOString(),
    });
    return { found: true, changed: true, user, previousRole };
}
