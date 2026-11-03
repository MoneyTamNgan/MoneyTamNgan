# HTTP security, CORS and permission scopes

Date: 2026-11-03. Branch: `develop-api_database`.

## Result

Implemented all five response headers, exact-origin CORS, and signed role-bounded permission scopes enforced in Proxy and independently inside API route handlers. Automated and live HTTP verification passed. The requested visual Chrome DevTools response-header inspection remains pending: Network opened, but native browser control could not select a captured response reliably. This report does not count that visual check as passed.

The user selected localhost only. With APP_ORIGIN and CORS_ALLOWED_ORIGINS unset, allowed browser origins are:

- `http://localhost:3000`
- `http://127.0.0.1:3000`

No database migration or extraction/Vertex processing change is part of this work. Changes are local and have not been committed, pushed, or merged.

## Headers

`next.config.js` sets the baseline headers, while `proxy.js` supplies a fresh CSP nonce for each rendered request. Route guards also add fallback headers when invoked independently.

| Header | Value / behavior |
| --- | --- |
| Content-Security-Policy | self by default; nonce-based scripts with strict-dynamic; object-src none; frame-ancestors none; base-uri/form-action self |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Frame-Options | `DENY` |
| X-Content-Type-Options | `nosniff` |
| Referrer-Policy | `strict-origin-when-cross-origin` |

Production scripts have neither unsafe-inline nor unsafe-eval. Development permits unsafe-eval for Next development tooling. Inline styles remain permitted for existing React styling/chart compatibility. Google profile images are permitted from lh3.googleusercontent.com. No external script origin was added.

The root layout uses request-time rendering so Next can attach the nonce to framework/hydration scripts. HTML responses are private/no-store; this trades static-page caching for nonce-based CSP. Live checks verified every script tag in the root HTML carried the same nonce as its response policy, and consecutive requests received different nonces.

HSTS is sent on localhost, but HTTP cannot demonstrate HSTS enforcement. HTTPS deployment and browser enforcement remain untested. Insecure-request upgrades are enabled only when an explicit HTTPS production APP_ORIGIN is configured.

## CORS and CSRF boundaries

- Configuration accepts exact origins; wildcard, null, credentials, paths, query strings and non-loopback HTTP origins are rejected.
- Proxy validates origins and preflight methods/headers. next.config.js adds conditional exact-origin CORS headers; handlers enforce the same shared policy.
- Browser state-changing requests require an approved Origin, including authenticated requests. Cookies alone do not bypass this check.
- Authenticated machine bearer requests can omit Origin when Sec-Fetch-Site is absent/none. A supplied disallowed Origin is still rejected.
- The legacy GET digest sends notifications, so it receives mutation-origin protection too.
- Preflights can run without authentication. Allowed headers are Content-Type and Authorization; credentials are allowed only with an exact approved origin. Vary includes Origin.
- No trust is derived from the request Host header. Rate limiting remains enabled for public API reads.

## Permissions

JWTs now contain `auth_version: 2` and a signed `scopes` array. Issuance and verification reject scopes outside the role's allowed list; callers can request a narrower subset. Client role/scope headers cannot grant access. Explicit bearer authentication takes precedence over cookies, including inside identity-sensitive handlers.

| Operation | Required permission |
| --- | --- |
| Public TOR, project and analytics reads | Guests allowed; authenticated sessions require tor:read |
| Read/update own profile | profile:read / profile:write; identity remains the signed-in owner |
| Admin/review reads | Admin role + admin:read |
| Admin keywords/classification operations | Admin role + admin:write, or tor:write for TOR overrides |
| Pipeline status / triggers | pipeline:read / pipeline:trigger |
| Test notification | notifications:test for the signed-in recipient |
| Digest notification | Admin + notifications:send, or the configured cron credential |
| Database diagnostic | Admin + admin:read |

All 33 route modules use the shared route guard; the profile alias reuses guarded profile handlers. This protects handlers even if Proxy is not invoked. Domain handlers still perform their existing validation and ownership checks. Missing/invalid credentials return 401; authenticated callers lacking permissions return 403.

The static PIPELINE_ADMIN_TOKEN must be at least 32 characters and now grants only pipeline reads/triggers. It cannot read admin review queues or change classifications/profiles. CRON_SECRET is limited to notifications; query-string secrets and an absent secret no longer authorize digest sending. Neither credential is exposed to the browser.

## Compatibility and operator actions

1. Restart the Next app after applying these changes, including after editing CORS origins.
2. Sign in again. Existing JWTs without version-2 signed scopes are rejected on protected routes.
3. Existing scheduler pipeline credentials continue to authorize pipeline operations. The GitHub ingestion workflow's status request now also supplies its bearer credential.
4. Admin review CLI callers must use a signed scoped admin JWT instead of PIPELINE_ADMIN_TOKEN. Admin browser sessions handle their cookie normally.
5. For local work, leave APP_ORIGIN/CORS_ALLOWED_ORIGINS unset or configure the exact loopback origin. No production origin is required now. Production-origin configuration is still required before deployment elsewhere.

OAuth provider sign-in itself was not completed during this verification. Existing Google callback/state logic is preserved; newly issued sessions receive role-appropriate scopes.

## Verification evidence

| Check | Result |
| --- | --- |
| `npm test` | 238 passed, 0 failed |
| `npm run test:vitest` | 213 passed across 30 files, 0 failed |
| `npm run build` | Passed; pages render dynamically |
| `git diff --check` | Passed |
| Live five headers, fresh nonce, HTML nonce matching | Passed |
| Approved / wildcard / null / foreign-origin preflights | Passed: 204 / 403 / 403 / 403 |
| Anonymous mutation, insufficient scopes, pipeline/admin separation | Passed |
| Real pipeline credential read-only status access | Passed |
| Fixture TOR list/detail/summary/anomalies, project, review/status and admin/analytics/detail/document pages | Passed |
| Visual DevTools Network response-header check | Pending manual confirmation |

New tests cover direct-handler authorization, legacy-session rejection, role/scope escalation, profile ownership, mixed bearer/cookie identity, missing/foreign mutation origins, preflight rules, bounded pipeline/cron credentials and guard registration across every API module.

The live server ran on port 3117 with an explicit local test origin, a temporary test JWT secret and the existing isolated `moneytamngan_e2e_oct25_mi1gPA` fixture database. It was stopped after verification. No ingestion, email sending, paid Vertex calls or production-record mutations were triggered. The user's port-3000 app, workers and scheduler were not restarted or stopped.

Reusable read-only security smoke check (JWT_SECRET must match the running server):

```sh
node scripts/test-http-security.js http://localhost:3000
```

The script reads status if PIPELINE_ADMIN_TOKEN is configured, and tests denied mutation requests; it never submits an authorized trigger.

## Finish the browser check

1. Restart your local app and open `http://localhost:3000` in Chrome.
2. Open DevTools, select Network, then reload the page.
3. Select the root document request, open Headers and expand Response Headers.
4. Confirm the five headers above, including a nonce-bearing CSP. Reload and confirm the nonce changes.
5. Check Console for CSP script violations; normal unauthenticated `/api/auth/me` 401 responses are expected before login.

HTTP localhost will not prove HTTPS/HSTS behavior. A production HTTPS smoke check is a later deployment requirement.

## Remaining limitations

- The visual browser check above is incomplete; live HTTP header verification passed independently.
- Existing dependency-audit findings (previous audit: 15, including a critical Next finding) are outside this patch and remain unresolved. These changes are not a claim of complete application security.
- Inline style permission, dynamic-rendering cost, and re-login after token format changes are deliberate tradeoffs.
- CORS constrains browsers; authorization is the boundary for non-browser clients. Background worker/scheduler database access remains server-side and does not acquire permissions from browser headers.
