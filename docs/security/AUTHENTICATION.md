# Authentication and anti-automation controls (ASVS V6.1.1, #184)

How the application slows down credential stuffing, brute force and other automated abuse. Every number below is read from the code; the file that sets it is named next to it.

## Sign-in methods

| Method | Route | Credential check |
|---|---|---|
| Email or username and password | `POST /api/auth/login`, `POST /api/auth/register` | scrypt (N=131072, r=8, p=1, random 16-byte salt), `timingSafeEqual`, 15 to 128 characters (`lib/password-auth.js`) |
| Google OAuth 2.0 (authorization code) | `/api/auth/google/start`, `/login`, `/callback` | Google verifies the user; the callback requires `verified_email=true` and a one-time `state` nonce (`lib/oauth-security.js`) |

Both end in the same HttpOnly, SameSite=Lax session cookie (JWT, 24 hours, `Secure` in production; `lib/auth.js`). Details of the password flow: [email-password-auth.md](../email-password-auth.md).

Google sign-in means the application never sees or stores the user's Google password. Brute force against that password, password reuse, and multi-factor authentication are handled by Google; the application only receives the result. The application cannot require MFA for a Google account, and email/password accounts have no MFA.

## Rate-limiting design

One small limiter is used everywhere (`lib/rate-limit.js`):

- **Algorithm:** fixed window. The first request for a key opens a window; each request adds one; the request that takes the count above the limit is refused until the window ends.
- **Keys:** the client address for guests, the user id for signed-in users, a SHA-256 of the account for sign-in attempts (so raw email addresses are not kept in memory).
- **Client address:** the first value of `X-Forwarded-For`, then `X-Real-IP`, otherwise one shared bucket named `unknown`. The deployment must sit behind a reverse proxy that sets these headers, otherwise all guests share one limit.
- **Storage:** process memory, swept when windows expire. Counters reset on restart, and with several instances each one counts on its own.

### Limits per endpoint

| Where | Key | Limit | Window | File |
|---|---|---|---|---|
| Public read API (guest) | client address | 60 (`RATE_LIMIT_GUEST_PER_MINUTE`) | 1 minute | `proxy.js`, `lib/rate-limit.js` |
| Public read API (signed in) | user id | 300 (`RATE_LIMIT_USER_PER_MINUTE`) | 1 minute | `proxy.js`, `lib/rate-limit.js` |
| Login and register, any request | client address | 30 | 15 minutes | `lib/password-auth.js` |
| Login and register, per identifier | hash of the email, or of `username:<name>` | 10 | 15 minutes | `lib/password-auth.js` |
| Login, per resolved account | hash of the account id | 10 (shared by email and username attempts) | 15 minutes | `lib/password-auth-handler.js` |
| Google OAuth start | client address | 5 | 15 minutes | `lib/oauth-security.js` |
| Google OAuth callback | client address | 5 | 15 minutes | `lib/oauth-security.js` |
| BidPrep draft create, export, delete | user id | 5 drafts per hour by default, with hourly export and delete caps and a per-minute cap | 1 hour / 1 minute | `lib/bid-prep/security.js` |

The identifier limit and the account limit are separate on purpose: alternating between an email and a username for the same account does not give an attacker two budgets. A login for an unknown identifier still runs the password hash against a dummy record, and unknown, Google-only and wrong-password cases return the same 401 message, so response content and timing do not reveal which accounts exist.

Admin and pipeline routes are not covered by the guest limiter; they require a role or a scoped token (see [RBAC_SPEC.md](RBAC_SPEC.md)).

## What a blocked client sees

| Case | Status | Body | Headers |
|---|---|---|---|
| Public read API over the limit | 429 | `{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Try again in N seconds." } }` | `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` |
| Login or register over the limit | 429 | `{ "error": { "code": "RATE_LIMITED", "message": "ลองใหม่ภายหลัง มีคำขอมากเกินไป" } }` | same four headers |
| Google OAuth over the limit (API client) | 429 | `{ "error": { "code": "RATE_LIMITED", ... } }` | same headers, `Cache-Control: no-store` |
| Google OAuth over the limit (browser) | 429 | a small HTML page that redirects to `/?auth_wait_until=<epoch ms>` so the login popup can show the time left | same headers |
| BidPrep over the limit | 429 | `RATE_LIMITED` error envelope | same headers |

`Retry-After` is in seconds and is at least 1. `X-RateLimit-Reset` is the window end in Unix seconds. Refused Google attempts are written to the auth audit log (`oauth_rate_limited`).

## Other controls that limit automation

- Request bodies on login and register are bounded to 8 KiB and must be `application/json` (415 otherwise).
- Password hashing concurrency is capped at two, so a flood of login attempts cannot exhaust memory; when the cap is reached the route answers a generic 503.
- Mutating browser requests need an allowed `Origin` (CSRF), see `lib/security-policy.js`.
- Registration creates `role=user` only and ignores any role or provider id sent by the client.

## Known limitations

- Counters are per process and are not shared across instances (STRIDE TH-13 residual). A shared store such as Redis is needed before running more than one instance.
- No account lockout, CAPTCHA or breached-password check; the controls above only slow attempts down.
- Email accounts are not verified, and there is no password reset or MFA yet. Add them before a public deployment.

## Tests

`tests/integration/password-auth.integration.test.js` (limits and the identical 401), `tests/integration/google-oauth-security.integration.test.js` (OAuth limits and `Retry-After`), `tests/security/bid-prep-access.test.js` (BidPrep limits).
