# RBAC access specification

Implementation baseline: `origin/develop` as checked on 2026-11-16. Evidence for [#192](https://github.com/MoneyTamNgan/MoneyTamNgan/issues/192), ASVS V8.1.1. This describes implemented routes, not the planned endpoints in OpenAPI. See [input validation and OpenAPI gaps](../API_VALIDATION.md).

## Enforcement and identity

[Proxy](../../proxy.js) and every exported handler independently use [permissionFor / authorizeScopeRequest](../../lib/request-authorization.js) through [withRouteSecurity](../../lib/route-security.js). BidPrep adds [withBidPrep](../../lib/bid-prep/security.js); `/api/profile` re-exports the guarded `/api/profiles` handlers. Client role/scope headers are never trusted.

A [session JWT](../../lib/auth.js) must verify HS256, expiry, `auth_version: 2`, a nonempty string `sub`, a recognized role and role-bounded scopes. Authentication accepts `mtn_session` or an explicit `Authorization: Bearer <JWT>`. An Authorization header takes precedence over the cookie, including when invalid. A narrower JWT needs the scope in the table even if its role normally has it. Scope grants cannot elevate a user to admin.

| Role | Maximum session scopes |
| --- | --- |
| Guest | None; public routes only |
| user | `tor:read`, `profile:read`, `profile:write`, `session:write`, `notifications:test` |
| admin | All user scopes plus `tor:write`, `admin:read`, `admin:write`, `pipeline:read`, `pipeline:trigger`, `notifications:send` |
| pipeline JWT role | `pipeline:read`, `pipeline:trigger`; no admin or profile access |

The matrix assumes valid full-scope sessions, allowed Origin and valid input. “Allow” means authorization succeeds, not that the operation must return 200. Each row links the real handler. The **M** evidence link on every row exercises that exact method/path for guest, user and admin through both Proxy and an independent handler guard; it also tests a reduced-scope admin. [S](../../tests/security/scopes-cors-headers.test.js) checks every route uses a guard, including the profile alias, and tests forged/expired credentials, machine credentials and Origin rules. These are guard tests; handler-specific and ownership evidence follows the matrix.

## Implemented method matrix

| Method | Route / handler enforcement | Guest | user | admin | Required scope / role | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| GET | [/api/admin/classification/queue](../../app/api/admin/classification/queue/route.js) | 401 | 403 | Allow | `admin:read` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/admin/classification/run](../../app/api/admin/classification/run/route.js) | 401 | 403 | Allow | `admin:write` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/admin/unlock](../../app/api/admin/unlock/route.js) | 401 | 403 | Allow | `admin:read` + admin role, and an allowed address when `ADMIN_IP_ALLOWLIST` is set | [U](../../tests/unit/admin-gate.test.js) |
| GET | [/api/admin/keywords](../../app/api/admin/keywords/route.js) | 401 | 403 | Allow | `admin:read` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| PUT | [/api/admin/keywords](../../app/api/admin/keywords/route.js) | 401 | 403 | Allow | `admin:write` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/admin/pipeline/status](../../app/api/admin/pipeline/status/route.js) | 401 | 403 | Allow | `admin:read` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| DELETE | [/api/admin/pipeline/status](../../app/api/admin/pipeline/status/route.js) | 401 | 403 | Allow | `admin:write` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/admin/pipeline/trigger](../../app/api/admin/pipeline/trigger/route.js) | 401 | 403 | Allow | `admin:write` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| PATCH | [/api/admin/tors/[id]/classification](../../app/api/admin/tors/[id]/classification/route.js) | 401 | 403 | Allow | `tor:write` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/admin/tors/[id]/classification](../../app/api/admin/tors/[id]/classification/route.js) | 401 | 403 | Allow | `admin:read` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/analytics/export](../../app/api/analytics/export/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/analytics/overview/export](../../app/api/analytics/overview/export/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/analytics/overview](../../app/api/analytics/overview/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/analytics/search](../../app/api/analytics/search/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/auth/google/callback](../../app/api/auth/google/callback/route.js) | Allow | Allow | Allow | None | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/auth/google/login](../../app/api/auth/google/login/route.js) | Allow | Allow | Allow | None | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/auth/google/start](../../app/api/auth/google/start/route.js) | Allow | Allow | Allow | None | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/auth/login](../../app/api/auth/login/route.js) | Allow | Allow | Allow | None | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/auth/logout](../../app/api/auth/logout/route.js) | Allow | Allow | Allow | None | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/auth/me](../../app/api/auth/me/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/auth/register](../../app/api/auth/register/route.js) | Allow | Allow | Allow | None | [M](../../tests/security/rbac-route-matrix.test.js) |
| DELETE | [/api/bid-prep/data](../../app/api/bid-prep/data/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/bid-prep/drafts/[id]/export](../../app/api/bid-prep/drafts/[id]/export/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/bid-prep/drafts/[id]](../../app/api/bid-prep/drafts/[id]/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| PATCH | [/api/bid-prep/drafts/[id]](../../app/api/bid-prep/drafts/[id]/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| DELETE | [/api/bid-prep/drafts/[id]](../../app/api/bid-prep/drafts/[id]/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/bid-prep/drafts](../../app/api/bid-prep/drafts/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/bid-prep/drafts](../../app/api/bid-prep/drafts/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/bid-prep/tors/[projectId]/checklist](../../app/api/bid-prep/tors/[projectId]/checklist/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| PATCH | [/api/bid-prep/tors/[projectId]/checklist](../../app/api/bid-prep/tors/[projectId]/checklist/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/health](../../app/api/health/route.js) | Allow | Allow | Allow | None | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/ingestion/status](../../app/api/ingestion/status/route.js) | 401 | 403 | Allow | `pipeline:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/ingestion/trigger](../../app/api/ingestion/trigger/route.js) | 401 | 403 | Allow | `pipeline:trigger` | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/notifications/digest](../../app/api/notifications/digest/route.js) | 401 | 403 | Allow | `notifications:send` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/notifications/digest](../../app/api/notifications/digest/route.js) | 401 | 403 | Allow | `notifications:send` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/notifications/test](../../app/api/notifications/test/route.js) | 401 | Allow | Allow | `notifications:test` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/processing/review](../../app/api/processing/review/route.js) | 401 | 403 | Allow | `admin:read` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/processing/status](../../app/api/processing/status/route.js) | 401 | 403 | Allow | `pipeline:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/processing/trigger](../../app/api/processing/trigger/route.js) | 401 | 403 | Allow | `pipeline:trigger` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/profile](../../app/api/profile/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| PATCH | [/api/profile](../../app/api/profile/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| PUT | [/api/profile](../../app/api/profile/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| DELETE | [/api/profile](../../app/api/profile/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/profiles](../../app/api/profiles/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| PATCH | [/api/profiles](../../app/api/profiles/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| PUT | [/api/profiles](../../app/api/profiles/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| DELETE | [/api/profiles](../../app/api/profiles/route.js) | 401 | Allow | Allow | `profile:write` | [M](../../tests/security/rbac-route-matrix.test.js) |
| PATCH | [/api/projects/[id]/classification](../../app/api/projects/[id]/classification/route.js) | 401 | 403 | Allow | `tor:write` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/projects/[id]](../../app/api/projects/[id]/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/projects](../../app/api/projects/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/scraping/status](../../app/api/scraping/status/route.js) | 401 | 403 | Allow | `pipeline:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/scraping/trigger](../../app/api/scraping/trigger/route.js) | 401 | 403 | Allow | `pipeline:trigger` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/test-db](../../app/api/test-db/route.js) | 401 | 403 | Allow | `admin:read` + admin role | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/tors/[id]/anomalies](../../app/api/tors/[id]/anomalies/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| POST | [/api/tors/[id]/proposal-draft](../../app/api/tors/[id]/proposal-draft/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/tors/[id]/proposal-draft](../../app/api/tors/[id]/proposal-draft/route.js) | 401 | Allow | Allow | `profile:read` | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/tors/[id]](../../app/api/tors/[id]/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/tors/[id]/summary](../../app/api/tors/[id]/summary/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/tors/facets](../../app/api/tors/facets/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |
| GET | [/api/tors](../../app/api/tors/route.js) | Allow | Allow | Allow | `tor:read` (optional identity on public read) | [M](../../tests/security/rbac-route-matrix.test.js) |

## Ownership and machine principals

| Resource | Rule enforced after scope authorization | Implementation | Proving test |
| --- | --- | --- | --- |
| Profile and account delete, including singular alias | Target is `principal.session.sub`; body/query IDs and role fields cannot change the owner. Admin also accesses only their own profile through these routes. | [profiles](../../app/api/profiles/route.js), [allowlist](../../lib/profile-validation.js) | [scoped profile](../../tests/integration/scoped-profile-route.integration.test.js), [company profile](../../tests/integration/company-profile.integration.test.js) |
| Draft list/create/read/update/delete/export | Owner assigned from `session.sub`; reads and mutations query both `_id` and `userId`. Invalid or foreign draft returns 404 `DRAFT_NOT_FOUND`; admin has no cross-user bypass. | [draft service](../../lib/bid-prep/drafts.js), [atomic quota](../../lib/bid-prep/draft-store.js) | [BidPrep access](../../tests/security/bid-prep-access.test.js), [editor/export](../../tests/integration/bid-draft-editor-export.integration.test.js) |
| Company-data delete | Clears only caller's company fields and drafts; preserves account and other users. | [deletion](../../lib/bid-prep/deletion.js) | [privacy](../../tests/security/bid-prep-privacy.test.js) |
| Checklist | TOR is catalog data; contractor profile always comes from caller's `sub`. | [checklist](../../lib/bid-prep/checklist.js) | [BidPrep access](../../tests/security/bid-prep-access.test.js) |
| Proposal generation/polling | Job owner derives from `sub`; polling includes owner, project and job ID. Another owner's job is 404. POST currently requires **profile:read**, not profile:write. | [proposal route](../../app/api/tors/[id]/proposal-draft/route.js), [job filter](../../lib/proposal/draft.js) | [proposal route](../../tests/unit/proposal-draft-route.test.js) |
| Global TOR classification and pipeline | Admin TOR writes use `tor:write`; admin control mutations use `admin:write`. These operate on shared catalog state, not user-owned drafts. | [override](../../lib/classification-override.js), [pipeline control](../../app/api/admin/pipeline/trigger/route.js) | [override](../../tests/unit/classification-override-route.test.js), [admin pipeline](../../tests/integration/admin-pipeline.integration.test.js) |
| Test email | Recipient loaded from caller's User record, never body-supplied recipient. | [test notification](../../app/api/notifications/test/route.js) | [notification route](../../tests/integration/notifications-test-route.integration.test.js) |

[Machine credential validation](../../lib/pipeline-auth.js) is server-side and uses sufficiently long configured secrets. These are distinct from user JWT sessions:

- `PIPELINE_ADMIN_TOKEN` permits only `pipeline:read`/`pipeline:trigger` on `/api/ingestion/*`, `/api/processing/*` (except review), `/api/scraping/*`. It does **not** authorize `/api/admin/pipeline/*`, profile, TOR writes, or public TOR reads with a supplied token. Despite its historical name, it is not an admin credential.
- `CRON_SECRET` permits only `notifications:send` on digest (GET and POST); the cron principal is the explicit exception to the admin-session requirement. Query-string secrets are not accepted.
- A signed pipeline-role JWT has only pipeline scopes. It does not pass an admin role check.
- [Tests](../../tests/security/scopes-cors-headers.test.js) verify these boundaries. Additional [pipeline integration](../../tests/integration/admin-pipeline.integration.test.js) verifies actual trigger 401/403/409/202 behavior.

## Denials, browser requests and unsupported methods

- Protected API without credentials, or with invalid/expired credentials: **401** `UNAUTHORIZED`. Valid principal without role/scope: **403** `INSUFFICIENT_SCOPE`. Wrong Origin: **403** `FORBIDDEN_ORIGIN`. Legacy handler errors can have a string `error` instead of the guard envelope.
- A public route allows absent credentials; an invalid explicit Authorization header produces 401, and a valid but insufficiently scoped principal can produce 403. A stale cookie alone can fall back to guest on a public read. Public does not mean “ignore supplied Bearer credentials.”
- Ownership denials deliberately use **404** to avoid disclosing another user's resources. Unknown records also return 404. `/api/auth/me` returns 401 when its backing User no longer exists.
- Browser mutations require an exact allowed Origin. Default local origins are `http://localhost:3000` and `http://127.0.0.1:3000`; wildcard, `null`, unlisted origins and wildcard configuration are rejected. Explicit machine credentials may omit Origin only for non-browser fetch metadata; a supplied bad Origin is still denied. Digest GET and proposal POST are treated as mutations for this check. See [origin policy](../../lib/security-policy.js) and [S tests](../../tests/security/scopes-cors-headers.test.js).
- OPTIONS preflight is handled before authentication: 204 for allowed origin/method/headers, otherwise 403. It does not invoke the business handler. HEAD is not a separate business export here; framework GET handling and Proxy's read-method policy apply. Methods not exported are unsupported (normally 405 after Proxy); an authorization denial may precede that response. Unknown API mutations fail closed with admin:write; this does not create an endpoint.
- Protected pages `/profile` and `/admin` redirect anonymous browsers to `/`; authenticated page access needs `profile:read` or `admin:read` respectively. See [Proxy tests](../../tests/security/proxy.test.js). This page gate does not replace API ownership checks.
- Rate limits can return 429 after authorization. Auth, BidPrep and public-read limits are separate. Private API responses are `private, no-store`; no password hashes or Google IDs are returned by profile serializers.

## Verification and release evidence

Run `npm run test:vitest -- tests/security/rbac-route-matrix.test.js tests/security/scopes-cors-headers.test.js tests/security/bid-prep-access.test.js tests/integration/scoped-profile-route.integration.test.js` and `node scripts/audit-api-documentation.js`.

Manual check: request `/api/admin/pipeline/status` anonymously (401), with a user session (403), and an admin session (200 when the database is available). Open another user's draft with your own session and confirm 404. Use localhost's exact Origin for cookie-authenticated mutations; do not paste real JWTs into evidence.

ASVS V8.1.1 completion is gated on a non-author review and merge into develop. The ASVS sheet must link #192 and the merged file/PR before its row is marked DONE. CI and review evidence belongs in the PR; this specification alone does not claim every handler has a live database test.
