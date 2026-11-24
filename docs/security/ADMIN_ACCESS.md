# Admin access

Admin access supports FR-1.1.1 and FR-1.2.2. It is not a separate SRS functional requirement. See [traceability.md](../traceability.md).

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

## Extra conditions: allowed addresses and an access code (optional, off by default)
Both add to the admin role; neither makes anyone an admin. To get into `/admin` and `/api/admin/*` an admin account must pass, in order:
1. **Address check** when `ADMIN_IP_ALLOWLIST` is set (comma-separated: IPv4, IPv4 CIDR such as `10.0.0.0/24`, one IPv6 address, or `direct`). From any other address the answer is 403 `ADMIN_IP_NOT_ALLOWED`.
2. **Sign-in** with an account whose role is `admin`.
3. **Access code** when `ADMIN_ACCESS_CODE_HASH` is set (SHA-256 hex of the code). The admin enters the code on `/admin/unlock` (or `POST /api/admin/unlock`). A correct code sets a 30 minute cookie tied to that account and that address; without it admin pages redirect to the unlock page and admin APIs answer 403 `ADMIN_CODE_REQUIRED`. At most 5 tries per 15 minutes per account and address; every try is written to the auth audit log.

Make a code and its hash (keep the code, put only the hash in `.env`):
```
node -e "const c=require('crypto');const code=c.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-');console.log(code, c.createHash('sha256').update(code).digest('hex'))"
```
The code is compared in capital letters: whoever enters it can type small letters, but the hash must be made from the capital-letter form (the command above already does this).

How the address is read and what that means:
- The address is the **last** `X-Forwarded-For` entry, which is the one the nearest proxy wrote; a caller cannot add an entry after it. No header at all counts as `direct`.
- That is only safe if the app can be reached **through the proxy only**. Behind Tailscale Serve the real tailnet address is written by Tailscale. Bind the app port to `127.0.0.1` (for example `ports: ["127.0.0.1:3000:3000"]`) or block it with a firewall, otherwise a caller who goes straight to the port can send any header. `direct` means "no proxy header", so only list it when the port is bound to localhost.
- Public addresses are a poor choice: machines on the same network share one. On a tailnet use the Tailscale addresses (`100.x.y.z`).
- A set but unusable value does not switch the gate off: an allowlist with no valid entry denies everyone, and a code hash that is not 64 hex characters makes unlocking fail with 503.
- To turn it off, empty both variables and restart the app.

## Not done yet (possible next steps)
- An approval step so a second person must confirm each grant.
- An admin-only screen with a reason field, instead of a script.
- Time-limited admin rights, and multi-factor sign-in for admins.
