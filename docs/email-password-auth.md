# Email/password registration and login

Implemented on `feat/email-password-auth`, branched from `develop-api_database`.

## User flow

The home page keeps Google sign-in and now connects its email/password form to the real login endpoint. The new **สร้างบัญชี** button opens registration with email, password and password confirmation. No name is required. Registration signs in immediately, as requested for local use. Both methods issue the same HttpOnly, SameSite=Lax scoped JWT cookie and use the existing dashboard/profile/logout flow.

Start with `npm run dev`, open `http://localhost:3000`, select สร้างบัญชี, and use a password of 15–128 characters. No new dependency, API key or environment setting is needed; the existing MONGODB_URI and JWT_SECRET are required. Restart an already-running app after applying the changes.

## API and storage

- `POST /api/auth/register`: JSON `{email, password, username?, name?, next?}` → 201 with `{user:{id,email,username,name,role}, redirectTo}` and a session cookie. Optional name remains supported for API compatibility; the page does not request it.
- `POST /api/auth/login`: JSON `{email, password, next?}` → 200 with the same response/cookie shape.
- Both routes enforce the existing Origin whitelist in Proxy and in the handler guard. Browser fetch supplies the same-origin Origin automatically. CLI requests must provide an approved Origin.
- Email is trimmed/lowercased; lookups also recognize older mixed-case Google emails. New writes use the existing unique email index, and duplicate-key races return 409.
- MongoDB location: the configured database (`moneytamngan` by default), `users` collection, optional `passwordHash` field. Existing Google records need no password migration.
- `passwordHash` uses Node's asynchronous scrypt, independent 16-byte random salts, N=131072, r=8, p=1 and a 64-byte derived key. The version/cost/salt/hash are stored together. Verification uses timingSafeEqual. This follows the [OWASP scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Hashes are excluded from normal Mongoose queries and document JSON/object serialization. Public responses use explicit field allowlists. Plaintext passwords and hashes are never logged or added to JWTs.
- Registration ignores client-supplied role/scopes/provider IDs and always creates role=user. Unverified password registrations are not promoted by ADMIN_EMAILS.
- `next` destinations are restricted to same-origin paths, including in the Google callback.

## Username (issue #108)

`users.username` is optional, lowercase, 3–30 characters (`a-z 0-9 . _ -`, starting and ending with a letter or digit) and unique through the partial index `uniq_user_username` (only documents that have a string username are indexed). Reserved names such as `admin` and `root` are rejected. Registration stores the supplied username (400 `INVALID_USERNAME`, 409 `USERNAME_TAKEN`) or derives one from the email local part. **Login is still by email**; the username is a stored handle, not yet a login identifier.

Existing users need a one-off backfill. It is a dry run by default:

```bash
npm run db:migrate-users            # preview, writes nothing
npm run db:migrate-users -- --apply # fill missing usernames and create the index
```

It only fills users that have no username, never changes or reuses an existing one, never reads password hashes, and is safe to re-run. Google sign-ups created after the migration have no username until it is run again.

## Provider safety

An email already registered through Google cannot acquire a password through the public registration endpoint. The Google callback requires Google's verified_email=true and refuses to link a password account merely because the email matches. Its upsert also excludes password accounts to guard races. Existing Google admin allowlist behavior remains available for verified Google users.

Sign in through the original method when an email already exists. Authenticated account linking, setting a password on an existing Google account, email verification, password reset and changing a password are outside this version. Because new email accounts are not verified, this local implementation does not prove ownership of a mailbox.

## Abuse controls and limitations

Registration/login share limits of 30 requests per client address and 10 valid-format attempts per normalized email in 15 minutes. Invalid credentials for absent, Google-only and wrong-password accounts share one 401 message; absent accounts still execute a dummy KDF. Payloads are bounded at 8 KiB and KDF concurrency is capped at two to bound memory consumption. Busy/unavailable services return a generic 503; rate-limited responses include Retry-After.

Counters live in process memory and reset on restart; a multi-instance deployment needs a shared limiter. Client IP handling follows the existing trusted forwarding-header convention and requires a properly configured reverse proxy in deployment. Email verification, recovery and shared abuse controls should be added before public deployment. Session lifetime remains the existing 24 hours; the old nonfunctional remember-me/forgot-password placeholders were removed.

## Verification

- `npm test`: 264 passed.
- `npm run test:vitest`: 233 passed, including real scrypt checks, register/login/session flow, user-only registration, duplicate races, Google-only account protection, body/origin limits, rate limits, serialization protection and verified Google callback handling.
- Production build passed.
- `node scripts/test-password-auth-http.js`: passed against a uniquely named temporary Atlas database and its own localhost server. Verified actual hash persistence, excluded hash queries, registration, duplicate rejection, correct/wrong password login, the same user ID, profile access, denied admin access, foreign-origin denial, preserved Google redirect and logout. Only its own test database was removed afterward; production users were untouched.
- Chrome UI inspection confirmed the login page and create-account toggle expose the registration fields. A real Google consent/sign-in interaction was not performed; provider responses are mocked in regression tests.

The reusable HTTP test starts port 3118, requires a prior `npm run build`, uses the existing MongoDB connection configuration, and creates/removes only its randomly named `mtn_auth_test_*` database. It does not call Vertex, scrape documents or send email.
