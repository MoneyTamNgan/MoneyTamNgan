# Admin access

Who can be an administrator, how the role is granted and revoked, and what to keep an eye on.

## What an admin can do
- Open the admin console (`/admin`) and the `/api/admin/*` endpoints.
- Run and control the ingestion pipeline and the worker (this uses time, AI quota and network).
- Change how a TOR is classified (visible to every user).

A normal account gets `403` on these. Everything else is deny-by-default (`lib/request-authorization.js`, `proxy.js`).

## How the role is granted
1. **Normal sign-up never gives admin.** Every new account has role `user`. There is no screen where a user, or an admin, can change a role.
2. **Script, run by someone with access to the database** (the only way to change a role):
   ```
   node scripts/promote-admin.js person@example.com            # grant
   node scripts/promote-admin.js person@example.com --demote   # revoke
   ```
   On the demo machine run it inside the app container, for example
   `docker compose -f docker-compose.yml -f docker-compose.real-db.yml run --rm --no-deps --entrypoint node app scripts/promote-admin.js <email>`.
3. **Optional: `ADMIN_EMAILS`** (comma-separated list in `.env`). A person who signs in with **Google** and whose verified email is on the list becomes admin at login (`lib/auth.js`, `app/api/auth/google/callback/route.js`). It does not apply to email and password accounts. Leave it empty unless you mean it, and remember that removing a name from the list does not remove an existing admin role.

## What happens when the role changes
- The role is stored in the signed session cookie, so the script also raises the account's `session_version` (the same thing logout does). The person's current sessions stop working at once and they must sign in again. This applies to both grant and revoke, so a removed admin loses access immediately.
- Every real change is written as one JSON line on the console and as a document in the `role_change_audit` collection: who (`actor` = operating-system user and host that ran the script), which account, old role, new role, time. Asking for the role an account already has changes and records nothing.

## Practice we follow
- Give the role to the fewest people who need it, and only while they need it.
- Keep at least two admins, so one lost account does not lock the team out. Keep one documented emergency account (strong password, not used day to day, every use noted).
- Review the admin list before each release: `db.users.find({ role: "admin" }, { email: 1 })`, and read `role_change_audit` for changes you do not recognise.
- When someone leaves the team, revoke with `--demote` the same day (this also ends their sessions).

## Not done yet (possible next steps)
- An approval step so a second person must confirm each grant.
- An admin-only screen with a reason field, instead of a script.
- Limiting admin pages to an allowed IP range (`ADMIN_IP_ALLOWLIST`) and a short-lived admin code as a second step. An IP list alone is weak behind shared networks or changing addresses, and a shared code cannot show who did what, so treat both as extra layers on top of the role, not a replacement.
- Time-limited admin rights, and multi-factor sign-in for admins.

Background: OWASP Authorization Cheat Sheet (least privilege, review of permissions), NIST SP 800-53 AC-5 and AC-6.
