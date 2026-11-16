# API input validation dictionary

Implementation baseline: `origin/develop` (`40bed4c`), inspected 2026-11-16. Evidence for [#193](https://github.com/MoneyTamNgan/MoneyTamNgan/issues/193), ASVS V2.1.1. This is the **implemented** contract. It does not promise validation merely because OpenAPI declares it. [RBAC_SPEC](security/RBAC_SPEC.md) covers authentication, scopes, ownership and Origin. All paths below include `/api` (OpenAPI uses the `/api` server prefix).

## Reading the rules

- Repeated query keys use the first value (`URLSearchParams.get`); later duplicates are ignored. Query/path values arrive as strings. Shared numeric query parsers use JavaScript `Number`, so numeric strings, including exponent notation, are accepted if the resulting number meets the rule. JSON numeric fields require actual numbers unless coercion is explicitly noted. Missing/empty query values usually default; exceptions are stated.
- “No explicit maximum” means the handler has no application-level field limit; deployment/framework limits may still apply. This is a gap, not an unlimited-input recommendation. Character limits use JavaScript string length unless stated otherwise.
- Unlisted query/body fields are ignored unless explicitly rejected below. There is no universal unknown-field rejection, request-body schema, or global body-size limit in these handlers. A body on a read or a bodyless mutation is unused.
- Unless a row states otherwise, validation errors are HTTP **400** `{error:{code,message}}`. Guard errors are 401/403; missing resources are 404; conflicts 409; rate limits 429. Some older routes use `{error:string}` or `{status:'failed',error:{...}}`; retain these distinctions when testing clients. Storage/upstream failures are not input-validation success.
- [withRouteSecurity](../lib/route-security.js) checks auth and [Origin policy](../lib/security-policy.js) before business handling. `Authorization` must resolve to an allowed principal. Browser mutations require an exact allowlisted Origin; preflight accepts only GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS and Content-Type/Authorization request headers. Bad Origin is 403 `FORBIDDEN_ORIGIN`. No wildcard origins. See [security tests](../tests/security/scopes-cors-headers.test.js).
- JSON parsing differs by route. Profile/BidPrep [readJson](../lib/bid-prep/security.js) requires a Content-Type containing `application/json` (415 `UNSUPPORTED_MEDIA_TYPE`), checks declared and actual UTF-8 body size (413 `PAYLOAD_TOO_LARGE`), rejects malformed JSON (400 `INVALID_JSON`) and null/scalar/array roots (400 `INVALID_BODY`). It reads text before the actual-size check; this is not a streaming memory cap. Password and admin-pipeline handlers use bounded stream readers instead. Older routes may swallow malformed JSON into defaults; see their rows.

## Public TOR search and project reads

Enforcement: [TOR list](../app/api/tors/route.js), [query parsers](../lib/api/query-params.js). Proof: [TOR route integration](../tests/integration/tors-route.integration.test.js), [query parser tests](../tests/unit/query-params.test.js), [search filter tests](../tests/unit/search-filter.test.js).

### GET /api/tors

| Input | Type, default and enforced rule | Invalid result |
| --- | --- | --- |
| `page` | Numeric string → integer 1..9007199254740991; default 1 | `INVALID_PAGE` |
| `limit` | Numeric string → integer 1..100; default 10 | `INVALID_LIMIT` |
| `isSoftware` | Optional exact `true` / `false`; empty ignored | `INVALID_IS_SOFTWARE` |
| `agency`, `status` | Optional strings, exact dept_name/project_status match; no length limit or enum, no trim | No field-level rejection |
| `stage` | Optional `draft`, `official`, `review`, `closed`; empty ignored. Derived from contract-start dates, not bidding status | `INVALID_STAGE` |
| `biddingStatus` | Optional `open`, `closed`, `unknown`; empty ignored | `INVALID_BIDDING_STATUS` |
| `dateFrom`, `dateTo` | Optional strings parseable by `new Date`; date-only upper bound becomes end of UTC day. Must be ordered | `INVALID_DATE_FROM`, `INVALID_DATE_TO`, `INVALID_DATE_RANGE` |
| `budgetMin`, `budgetMax` | Optional finite nonnegative numeric strings, no finite upper cap; min ≤ max | `INVALID_BUDGET_MIN`, `INVALID_BUDGET_MAX`, `INVALID_BUDGET_RANGE` |
| `q` | Optional string; trimmed and **silently sliced to 200 characters**. Thai search escapes regex, numeric IDs use prefix, other text uses MongoDB text search | No overlength error |

The date parser's error message says ISO 8601, but enforcement accepts other JavaScript-parseable formats and normalizes some impossible calendar dates. It is not strict ISO/calendar validation. Pagination uses Number arithmetic; a huge valid page can still fail downstream skip arithmetic. Both limitations also affect routes using these shared parsers.

### GET /api/tors/facets

[Handler](../app/api/tors/facets/route.js), [integration proof](../tests/integration/tors-route.integration.test.js): only `isSoftware` is recognized; absent means all, exact `true`/`false` accepted. **Empty is rejected** with `INVALID_IS_SOFTWARE`, unlike the list. No other filters/pagination are applied.

### GET /api/tors/[id], GET /api/tors/[id]/summary, GET /api/tors/[id]/anomalies

[Detail](../app/api/tors/[id]/route.js), [summary](../app/api/tors/[id]/summary/route.js), [anomalies](../app/api/tors/[id]/anomalies/route.js): `id` must be a string with nonempty trimmed content; no pattern or maximum. Empty gives `INVALID_TOR_ID`; unmatched ID gives 404 `TOR_NOT_FOUND`. No accepted query/body fields. [Detail proof](../tests/integration/tors-id-route.integration.test.js), [response mapping proof](../tests/unit/tor-response.test.js); the latter tests serializers, not live handlers.

### GET /api/projects

[Handler](../app/api/projects/route.js): legacy pagination/filter behavior, deliberately documented separately from `/tors`.

| Input | Actual behavior | Invalid result |
| --- | --- | --- |
| `page` | `parseInt(value) || 1`, clamped to ≥1; accepts numeric prefixes and truncates decimals; no maximum | No explicit 400 |
| `pageSize` | Same parsing, default20, clamped1..100 | No explicit 400 |
| `isSoftware` | Any present nonempty string is converted using `=== 'true'`; other strings mean false | No explicit 400 |
| `agency`, `status` | Exact string match, no maximum/enum/trim | No explicit 400 |
| `dateFrom`, `dateTo` | `new Date`, no validity or ordering checks; dateTo has no end-of-day expansion | Downstream error may be 500 `LIST_PROJECTS_FAILED` |
| `search` | Raw MongoDB regex string, case-insensitive; no escaping or maximum | Invalid regex may fail as 500 `LIST_PROJECTS_FAILED` |

GET /api/projects/[id]: [handler](../app/api/projects/[id]/route.js) uses raw path `id` as project_id; no format/length validation. Missing project: 404 `PROJECT_NOT_FOUND`; lookup failure: 500 `GET_PROJECT_FAILED`. No accepted query/body. These legacy routes lack equivalent strict validation tests; central [RBAC proof](../tests/security/rbac-route-matrix.test.js) only proves access control, not legacy input hardening.

## Public analytics

### GET /api/analytics/search and GET /api/analytics/export

[Search](../app/api/analytics/search/route.js), [export](../app/api/analytics/export/route.js), shared [parseAnalyticsFilter](../lib/analytics.js). Proof: [search/aggregate tests](../tests/unit/analytics.test.js), [export route](../tests/unit/analytics-export-route.test.js).

| Input | Enforced rule | Invalid result |
| --- | --- | --- |
| `dateFrom`, `dateTo`, `budgetMin`, `budgetMax` | Same parse/order rules and lack of strict date validation as TOR list | Same `INVALID_DATE_*`, `INVALID_BUDGET_*` codes |
| `agency` | Exact string match; no max/trim | None |
| `category` | Intended `software` / `non-software`; empty ignored. Current `in` membership check also accepts inherited Object keys such as `constructor` / `toString` (gap) | Other unrecognized values: `INVALID_CATEGORY` |
| `page` (search only) | Integer1..MAX_SAFE_INTEGER, default1 | `INVALID_PAGE` |
| `pageSize` (search only) | Integer1..100, default20 | `INVALID_PAGE_SIZE` |
| `format` (export only) | **Required** exact `csv` / `json` | `INVALID_FORMAT` |

`limit` and `isSoftware` are **ignored** by these two handlers; category is the classification filter. Exports ignore pagination and cap output at10000 rows (`X-Export-Truncated` signals truncation). No accepted bodies.

### GET /api/analytics/overview and GET /api/analytics/overview/export

[Overview](../app/api/analytics/overview/route.js), [overview export](../app/api/analytics/overview/export/route.js), [parseAnalyticsQuery](../lib/analytics/project-analytics.js). Proof: [overview route](../tests/unit/analytics-overview-route.test.js), [export route](../tests/unit/analytics-overview-export-route.test.js), [parser](../tests/unit/project-analytics.test.js).

| Input | Enforced rule | Invalid result |
| --- | --- | --- |
| `page` | Integer1..MAX_SAFE_INTEGER, default1 | `INVALID_PAGE` |
| `limit` / fallback alias `pageSize` | Integer1..100, default10; present limit wins, even if empty | `INVALID_LIMIT` |
| `isSoftware` | Optional `true`/`false`; empty ignored | `INVALID_IS_SOFTWARE` |
| `agency` | Trimmed exact string, no maximum | None |
| `biddingStatus` | `open`, `closed`, `cancelled`, `unknown`; absent/empty ignored | `INVALID_BIDDING_STATUS` |
| `fiscalYear` | Numeric string → integer Buddhist Era2400..3000; absent/empty ignored | `INVALID_FISCAL_YEAR` |
| `dateFrom`, `dateTo`, `budgetMin`, `budgetMax` | TOR-list shared semantics, including ordering, finite nonnegative budgets and permissive dates | Same date/budget codes |
| `format` (export only) | Required exact `csv`/`json` | `INVALID_FORMAT` |

Export validates pagination but does not page output; capped10000 rows. `q`, `category`, `stage` are ignored (even though some comments mention stage). No body fields.

## Authentication and account/profile

### POST /api/auth/register and POST /api/auth/login

[Register](../app/api/auth/register/route.js), [login](../app/api/auth/login/route.js), shared [handler](../lib/password-auth-handler.js), [password/email rules](../lib/password-auth.js), [username rules and reserved names](../lib/username.js). Proof: [password auth integration](../tests/integration/password-auth.integration.test.js), [password storage](../tests/security/password-storage.test.js), [username](../tests/unit/username.test.js).

Content-Type starts with `application/json`; otherwise415 `INVALID_REQUEST`. UTF-8 stream body ≤8192 bytes (413 `INVALID_REQUEST`). Required valid object JSON, not null/array/scalar (400 `INVALID_REQUEST`). Unknown properties, including role/scopes, are ignored.

| Field | Type / rule | Invalid result |
| --- | --- | --- |
| `email` (register required; login alias) | String trimmed/lowercased, ≤254 characters; regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` | 400 `INVALID_CREDENTIALS` |
| `identifier` (login) | Takes precedence over `email` unless null/undefined. If contains @, email rules; otherwise username rules. No name field needed for login | 400 `INVALID_CREDENTIALS` |
| `password` (both required) | String15..128 **Unicode code points**, UTF-8≤512 bytes; no trimming or complexity rule | 400 `INVALID_CREDENTIALS`; valid-format wrong password/account:401 same code |
| `username` (register optional) | null/empty/absent derives a username. Otherwise trimmed/lowercased3..30; first/last alphanumeric, interior a-z/0-9/dot/underscore/hyphen. Reserved names in linked rule file rejected | 400 `INVALID_USERNAME`; conflict409 `USERNAME_TAKEN` |
| `name` (register optional) | String trimmed≤100; non-string ignored as empty | 400 `INVALID_NAME` |
| `next` (both optional) | Local `/path` string; forbids `//`, backslash, whitespace/controls and foreign origin. Invalid falls back to `/dashboard`; no explicit max | Fallback, no field error |

Existing email409 `ACCOUNT_EXISTS`; automatic OAuth/password linking disabled. Auth limit30/IP/15min and10/identifier/15min; login additionally shares10/account/15min across email/username. 429 `RATE_LIMITED` with retry headers. Hash service/database unavailable503 `AUTH_UNAVAILABLE`.

### GET /api/auth/google/start and GET /api/auth/google/login

[Start](../app/api/auth/google/start/route.js), [alias](../app/api/auth/google/login/route.js), [implementation](../lib/google-oauth-start.js). Query `next` is an optional string, no explicit maximum, stored in the state cookie and validated with `safeAuthDestination` at callback. `Accept: application/json` returns authorizationUrl; otherwise redirects. No body. Shared start-IP cap5/15min;429 `RATE_LIMITED`. Proof: [OAuth integration](../tests/integration/google-oauth-security.integration.test.js).

### GET /api/auth/google/callback

[Handler](../app/api/auth/google/callback/route.js): `code` required nonempty string; `state` required exact match with state portion of `mtn_oauth_state` cookie. No explicit maximums. State cookie is deleted on callback; originally600s max-age. Missing code400 string error `Authorization code is missing`; state mismatch400 `Invalid OAuth state`. Token exchange/provider profile failures400; verified provider email and Google ID required; existing other sign-in method409. Separate callback-IP cap5/15min. `next` is read from the state cookie, not callback query; sanitized local destination or `/dashboard`. No accepted body. Proof: [OAuth security](../tests/integration/google-oauth-security.integration.test.js).

### GET /api/auth/me and POST /api/auth/logout

[Me](../app/api/auth/me/route.js): no inputs beyond credentials; caller identity only; no backing user401 `User no longer exists` string error. [Logout](../app/api/auth/logout/route.js): no body/query; clears cookie idempotently even for guest, but browser Origin policy still applies. Proof: [auth](../tests/security/auth.test.js), [scope/Origin](../tests/security/scopes-cors-headers.test.js).

### GET /api/profiles, PUT /api/profiles, PATCH /api/profiles, DELETE /api/profiles

The same rules apply to GET /api/profile, PUT /api/profile, PATCH /api/profile, DELETE /api/profile ([alias](../app/api/profile/route.js)). [Handlers](../app/api/profiles/route.js), [allowlist/validator](../lib/profile-validation.js). All use caller `session.sub`; body/query IDs ignored. GET/DELETE accept no business input. PUT is a **partial update**, same as PATCH, not replacement. Update object body≤128KiB with readJson rules above; unknown fields ignored. Provided fields:

| Field | Type / range / maximum |
| --- | --- |
| `name`, `company_name` | Optional trimmed string≤200 |
| `registration_number` | Optional trimmed string≤100; no numeric-only requirement |
| `address` | Optional trimmed string≤2000 |
| `authorized_signatory` | Optional trimmed string≤200 |
| `skills`, `techStack`, `certifications` | Arrays≤100 string items, each trimmed≤100; empty strings removed, exact duplicates removed. skills and techStack mirror if only one provided |
| `registered_capital`, `highest_past_project_value` | Finite number0..1e15 or null (numeric strings rejected) |
| `concurrent_project_capacity` | Integer0..10000 or null |
| `match_score_threshold` | Finite number0..100; null rejected |
| `email_notifications_enabled` | Boolean |
| `notification_frequency` | Exact `IMMEDIATE` or `DAILY_DIGEST` |
| `past_projects` | Array≤50 objects; empty array clears history |
| `past_projects[].name`, `.client` | Required nonempty trimmed strings≤200 |
| `past_projects[].value` | Required finite number0..1e15 |
| `past_projects[].year` | Required integer Buddhist Era2400..2700 |

All text fields reject unsupported C0 controls (except tab/LF/CR). Empty top-level text strings allowed; null text rejected. Invalid fields400 `INVALID_PROFILE`, with dotted field paths in `error.fields`; no partial write. Model ValidationError also400 `INVALID_PROFILE`. Unknown user404 string error. Profile requests share default60/min/user;429 `RATE_LIMITED`. DELETE also deletes owned drafts before account; delete failure500. Proof: [company-profile integration](../tests/integration/company-profile.integration.test.js), [scoped ownership](../tests/integration/scoped-profile-route.integration.test.js), [model/client](../tests/integration/company-profile-model.integration.test.js).

## BidPrep

Shared [security/body/ID validation](../lib/bid-prep/security.js), [draft parsing](../lib/bid-prep/draft-content.js), [CRUD/export service](../lib/bid-prep/drafts.js). Proof: [access](../tests/security/bid-prep-access.test.js), [editor/export](../tests/integration/bid-draft-editor-export.integration.test.js), [privacy](../tests/security/bid-prep-privacy.test.js). Default per-user process-local buckets: reads60/min, writes30/min, draft creation5/hour, exports20/hour, company deletion10/hour (environment-configurable). 429 `RATE_LIMITED`; max50 stored drafts (may be configured lower),409 `DRAFT_LIMIT`, enforced transactionally.

### GET /api/bid-prep/drafts and POST /api/bid-prep/drafts

GET has no pagination/filter fields: lists at most50 owned drafts. POST body≤128KiB JSON object; field rules:

| Field | Type / rule | Invalid result |
| --- | --- | --- |
| `projectId` | Required string1..64; regex `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`; not trimmed | 400 `INVALID_DRAFT`; nonexistent404 `TOR_NOT_FOUND` |
| `title` | Optional string≤200; absent→empty | 400 `INVALID_DRAFT` |
| `sections` | Optional array≤40 objects; absent→empty stored list | 400 `INVALID_DRAFT` |
| `sections[].heading` | Optional string≤200; absent→empty | 400 `INVALID_DRAFT` |
| `sections[].body` | Optional string≤8000; absent→empty | 400 `INVALID_DRAFT` |
| `sections[].sources` | Optional array≤20 strings, each≤200; absent→empty | 400 `INVALID_DRAFT` |

Text sanitized to plain text by [sanitizePlainText](../lib/bid-prep/text.js); combined cleaned title/headings/bodies/sources≤100000 characters, otherwise413 `PAYLOAD_TOO_LARGE`. Individual overlength input is rejected before sanitization, never silently clipped. Explicit null text/list values rejected. Unknown fields (including owner) ignored. No caller-chosen user ID.

### GET /api/bid-prep/drafts/[id], PATCH /api/bid-prep/drafts/[id], DELETE /api/bid-prep/drafts/[id]

`id` is lowercase24-hex only. Invalid, missing or foreign draft gives404 `DRAFT_NOT_FOUND`. GET/DELETE have no business query/body. PATCH≤128KiB object; `version` required positive **safe integer** (≤9007199254740991), else400 `INVALID_DRAFT`. Optional title/sections use POST content limits; projectId/owner are not editable. Unknown fields ignored; even a version-only accepted PATCH increments version. Stale version409 `DRAFT_CONFLICT`, no overwrite. Null title/sections rejected by parser. Proof: [editor concurrency](../tests/integration/bid-draft-editor-export.integration.test.js).

### POST /api/bid-prep/drafts/[id]/export

Same owned draft ID rule; optional query `version` converted with Number, must be positive safe integer (400 `INVALID_DRAFT`); mismatch409 `DRAFT_CONFLICT`. No accepted body. Empty stored section bodies400 `EMPTY_DRAFT`; corrupt stored draft400 `INVALID_DRAFT`; generated DOCX>2MiB413 `PAYLOAD_TOO_LARGE`. Exports DOCX only; `format` ignored. [Handler](../app/api/bid-prep/drafts/[id]/export/route.js), [proof](../tests/integration/bid-draft-editor-export.integration.test.js).

### GET /api/bid-prep/tors/[projectId]/checklist

[Handler](../app/api/bid-prep/tors/[projectId]/checklist/route.js), [service](../lib/bid-prep/checklist.js): projectId same1..64 regex as draft creation, invalid/nonexistent404 `TOR_NOT_FOUND`; no summary409 `TOR_NOT_READY`; missing caller profile404 `USER_NOT_FOUND`. No business query/body; userId ignored. Output bounded100 requirements; this is an output cap, not request validation. [Proof](../tests/security/bid-prep-access.test.js).

### DELETE /api/bid-prep/data

[Handler](../app/api/bid-prep/data/route.js): JSON object≤4096 bytes; `confirm` must equal string `DELETE_COMPANY_DATA` exactly, otherwise400 `CONFIRMATION_REQUIRED`. No other accepted fields. Clears caller's company fields and drafts, preserves account. [Proof](../tests/security/bid-prep-privacy.test.js).

### POST /api/tors/[id]/proposal-draft and GET /api/tors/[id]/proposal-draft

[Handler](../app/api/tors/[id]/proposal-draft/route.js): trimmed nonempty `id`, no maximum/pattern, otherwise400 `INVALID_TOR_ID`. POST ignores body, needs existing TOR (404 `TOR_NOT_FOUND`) and extracted facts (409 `TOR_NOT_EXTRACTED`), returns202 job. GET requires query `jobId`24-hex (case-insensitive), otherwise400 `INVALID_JOB_ID`; owner+project+job lookup mismatch404 `PROPOSAL_DRAFT_NOT_FOUND`. POST generation cap and shared draft-create cap return429 `PROPOSAL_DRAFT_RATE_LIMITED`. [Proof](../tests/unit/proposal-draft-route.test.js).

## Admin catalog management

### GET /api/admin/classification/queue

[Handler](../app/api/admin/classification/queue/route.js): query page integer1..1000000(default1), pageSize integer1..100(default20), confidenceType exact `either`/`classification`/`extraction` (absent/empty→either). Invalid400 `INVALID_REVIEW_QUERY`. No body. [Proof](../tests/unit/classification-queue-route.test.js).

### GET /api/admin/keywords and PUT /api/admin/keywords

[Handler](../app/api/admin/keywords/route.js): GET no business fields. PUT root must be JSON array; malformed/nonarray400 `INVALID_BODY`. Each row `keyword` is **coerced with String** and trimmed, must be nonempty (400 `EMPTY_KEYWORD`), no explicit maximum. `category` must equal `software`/`non-software` (400 `BAD_CATEGORY`). Unknown row fields ignored; duplicate keyword/category pairs removed case-insensitively; empty array accepted. No array-count or body-size cap, no strict Content-Type enforcement. Replaces whole list without a transaction; delete-then-insert failure may leave list empty. [Guard proof](../tests/security/scopes-cors-headers.test.js); no dedicated keyword validation suite currently.

### POST /api/admin/classification/run

[Handler](../app/api/admin/classification/run/route.js): no accepted query/body. Reclassifies unresolved projects with current keyword sets; preserves manual overrides. [Proof](../tests/unit/classification-run-route.test.js).

### GET /api/admin/tors/[id]/classification and PATCH /api/admin/tors/[id]/classification

[Handler](../app/api/admin/tors/[id]/classification/route.js), [parser](../lib/classification-override.js): trimmed nonempty `id`, no max/pattern; invalid400 `INVALID_TOR_ID`. GET no business query/body (history capped100). PATCH requires valid JSON object, malformed400 `INVALID_BODY`, invalid parsed fields400 `INVALID_OVERRIDE`. No explicit Content-Type/body-byte cap.

| Field | Enforced rule |
| --- | --- |
| `isSoftware` | Optional boolean |
| `tags` | Optional array≤20; strings trimmed, nonempty≤50; case-insensitive dedup |
| `processingStatus` | Optional exact enum: `metadata_ingested`, `classification_pending`, `irrelevant`, `document_pending`, `document_downloaded`, `ai_pending`, `text_extraction_pending`, `text_extracted`, `completed`, `metadata_only`, `review_required`, `retry_pending`, `failed` |
| `documentStatus` | Optional exact enum: `downloaded`, `stored`, `text_ready`, `summarized`, `skipped`, `review_required`, `retry_pending`, `failed` |
| `reason` | Optional string≤500 before trim; empty becomes omitted |
| `enqueueProcessing` | Boolean, default false |

At least one of isSoftware/tags/processingStatus/documentStatus required (reason or enqueueProcessing alone insufficient). Unknown fields ignored. Setting documentStatus without stored document409 `NO_DOCUMENT`; missing TOR/candidate404 (service error). Proof: [override tests](../tests/unit/classification-override-route.test.js).

### PATCH /api/projects/[id]/classification

[Legacy handler](../app/api/projects/[id]/classification/route.js): raw path id, no explicit format/length check. Body optional parsing defaults malformed JSON to `{}`; `isSoftware` required boolean (400 `INVALID_CLASSIFICATION`). `reason` optional: coerced String from value or `Manual review`, **sliced to1000**, not rejected. No byte cap/Content-Type enforcement, unknown fields ignored. Missing project404 `PROJECT_NOT_FOUND`; queue failure after saved classification503 `CLASSIFICATION_ENQUEUE_FAILED`. [Proof](../tests/unit/project-classification-route.test.js).

## Admin pipeline and legacy operator routes

### POST /api/admin/pipeline/trigger

[Handler](../app/api/admin/pipeline/trigger/route.js): optional object JSON, missing/whitespace body→`{}`. Bounded stream≤8192 bytes. Malformed/nonobject/oversize or invalid fields400 `INVALID_PIPELINE_REQUEST` (oversize is400 here, not413). No Content-Type enforcement. Unknown fields ignored **except raw `tenders` is explicitly forbidden**.

| Field | Type / default / rule |
| --- | --- |
| `limit` | Integer1..50, default5 |
| `depts` | Optional array≤100 of exact four-digit strings |
| `projectIds` | Optional array length≤limit, each exact eleven-digit string |
| `allowBrowser` | Boolean, default true |
| `force` | Boolean, default false |
| `sync` | Only literal false accepted, default false |

Accepted202 returns jobId/runId/startedAt immediately; concurrent live run409 `PIPELINE_ALREADY_RUNNING`; control unavailable503 `PIPELINE_TRIGGER_FAILED`. Proof: [admin integration](../tests/integration/admin-pipeline.integration.test.js), [restart recovery](../tests/integration/admin-pipeline-recovery.test.js).

### GET /api/admin/pipeline/status and DELETE /api/admin/pipeline/status

[Handlers](../app/api/admin/pipeline/status/route.js): no business fields. DELETE reset while live409 `PIPELINE_ALREADY_RUNNING`; unavailable500 `STATUS_CHECK_FAILED`/`STATUS_RESET_FAILED`. Restart/lease recovery occurs server-side. [Proof](../tests/integration/admin-pipeline.integration.test.js).

### POST /api/ingestion/trigger

[Handler](../app/api/ingestion/trigger/route.js): optional JSON; malformed/no body silently→`{}`. No root-object check, byte cap or Content-Type enforcement. A null root may fail500 rather than400. Unknown fields ignored.

| Field | Enforced rule |
| --- | --- |
| `year` | Default current Thai fiscal year; String(value) must be exactly4 digits; no year range |
| `limit` | Optional actual integer1..1000, default fetch cap500 |
| `rssDeptId` | Optional String(value) exactly4 digits |
| `enqueueProcessing` | Boolean, default true |
| `verifyInline` | Boolean, default false |
| `keyword`, `deptCode` | Optional passed through to upstream fetch, no handler type/length validation |

Invalid checked fields400 `INVALID_INGESTION_REQUEST`. This route performs ingestion before returning202; it is **not** the immediate asynchronous admin runner. Upstream transient failure503 `INGESTION_UPSTREAM_UNAVAILABLE`, otherwise500 `INGESTION_FAILED`. [Proof](../tests/unit/ingestion-trigger-route.test.js).

### POST /api/processing/trigger

[Handler](../app/api/processing/trigger/route.js), [recovery validator](../lib/processing-recovery.js): optional JSON; malformed→`{}`; no root/body-size/Content-Type enforcement. Invalid checked values400 `INVALID_PROCESSING_REQUEST`.

| Field | Enforced rule |
| --- | --- |
| `projectId` | Optional coerced String, trimmed nonempty, no maximum; existing Project required |
| `candidateId` | Optional trimmed nonempty **string**, no maximum; existing candidate required; cannot combine with projectId |
| `batchSize` | Integer1..100, default10; candidate branch returns before validating this field |
| `scanLimit` | Bulk only integer1..1000, default100 |
| `afterId` | Bulk only ObjectId/24-hex accepted by Mongoose, or null, default null |
| `dryRun`, `retryFailed` | Bulk only booleans, default false |

Single project/candidate cannot include any dryRun/scanLimit/afterId/retryFailed fields. Successful enqueue202; reuses active jobs. Missing target is400, not404. Some malformed root types reach500 `PROCESSING_ENQUEUE_FAILED`. [Proof](../tests/unit/processing-trigger-route.test.js), [recovery](../tests/unit/processing-recovery.test.js).

### POST /api/scraping/trigger

[Handler](../app/api/scraping/trigger/route.js), [delay validator](../lib/scraper.js): optional JSON; malformed→`{}`, no root/body-byte/Content-Type enforcement. Fields projectId optional coerced String trimmed nonempty/no max; batchSize integer1..50(default10); onlyMissing boolean(default true); delayMs integer or nonempty numeric string→integer3000..60000(default configured valid delay or4000). Null projectId is rejected. Invalid checked values400 `INVALID_SCRAPING_REQUEST`; null root may instead fail500 `SCRAPING_FAILED`. Unknown fields ignored. [Proof](../tests/unit/scraping-trigger-route.test.js).

### GET /api/ingestion/status and GET /api/scraping/status

[Ingestion](../app/api/ingestion/status/route.js), [scraping](../app/api/scraping/status/route.js): no accepted query/body. Operational statistics only. Guard proof: [RBAC matrix](../tests/security/rbac-route-matrix.test.js); no dedicated business-validation cases because there are no business inputs.

### GET /api/processing/status

[Handler](../app/api/processing/status/route.js): optional string projectId (no format/max), takes precedence over optional jobId. jobId passed to Mongoose findById without explicit24-hex validation; malformed ID may give500 `PROCESSING_STATUS_FAILED`, valid missing job404 `JOB_NOT_FOUND`. Missing project404 with status `not_found`. Neither parameter→aggregates. No body. [Guard proof](../tests/security/rbac-route-matrix.test.js).

### GET /api/processing/review

[Handler](../app/api/processing/review/route.js): optional page Number(value)||1 clamped≥1, pageSize Number(value)||20 clamped1..100. No integer check or page cap; downstream failure500 `REVIEW_QUEUE_FAILED`, not explicit invalid-query400. No body. Prefer strict admin classification queue for bounded review queries. [Guard proof](../tests/security/scopes-cors-headers.test.js).

## Notifications and diagnostics

### POST /api/notifications/test

[Handler](../app/api/notifications/test/route.js): optional JSON `matches` array; no item schema, count, string lengths or body-byte cap. Each item is consumed as torId/title/agency/budget/matchScore by email rendering, without route validation. Nonarray/malformed/missing body→sample matches. Recipient from caller User, not request. No Content-Type enforcement. No dedicated send rate limit in this handler beyond infrastructure; do not use to send unbounded input. No user404 string error; provider send failure500 string error. Proof: [notification route integration](../tests/integration/notifications-test-route.integration.test.js). These are mock-provider tests, not inbox delivery evidence.

### POST /api/notifications/digest and GET /api/notifications/digest

[Handler](../app/api/notifications/digest/route.js): POST accepts optional `projects` array with **no item/count/body-size validation**; malformed/missing/nonarray body falls back to DB selection (latest200 legacy-compatible processed projects). GET has no business inputs and invokes digest service. Both are mutations protected by notifications:send/admin session or cron principal, including Origin checks on GET. Unknown fields ignored. [Guard proof](../tests/security/scopes-cors-headers.test.js), [service tests](../tests/unit/notification-service.test.js). No live delivery claimed.

### GET /api/health and GET /api/test-db

[Health](../app/api/health/route.js) is public; [test-db](../app/api/test-db/route.js) admin-only. No business query/body. DB failure503 on health,500 on test-db; currently responses may include exception messages. [Access proof](../tests/security/rbac-route-matrix.test.js). No credentials should be included in test output or issue evidence.

## OpenAPI reconciliation and known gaps

[OpenAPI](api/openapi.yaml) is a mixed implemented/planned contract. [Contract tests](../tests/contract/openapi-contract.test.ts) check selected endpoints/shapes; green lint or contract tests do not prove route completeness. The following differences were verified against the current source. This documentation change records them without changing runtime behavior or silently replacing planned definitions.

| Area | Difference / follow-up |
| --- | --- |
| Planned-only routes | `/admin/ingestion/runs` GET/POST, `/matches` GET, `/tors/{id}/match` GET, `/tors/{id}/report` POST have no app/api handlers. Do not call them as implemented endpoints. |
| Singular profile | OpenAPI `/profile` has planned GET/POST/PUT. Runtime is alias GET/PUT/PATCH/DELETE, partial-update semantics and current profile response. POST is not implemented. |
| Missing profile operations | `/profiles` DELETE and `/profile` PATCH/DELETE are not described. |
| Missing live endpoint definitions | `/projects` GET, `/projects/{id}` GET, `/projects/{id}/classification` PATCH; `/admin/classification/run` POST; `/ingestion/trigger` POST, `/ingestion/status` GET; `/processing/trigger` POST, `/processing/status` GET, `/processing/review` GET; `/scraping/trigger` POST, `/scraping/status` GET; `/notifications/test` POST, `/notifications/digest` GET/POST; `/test-db` GET. |
| TOR search | `q`, `budgetMin`, `budgetMax` are implemented but absent from `/tors` query parameters. Implementation limits q by slicing, not rejection. |
| Analytics search | OpenAPI advertises `isSoftware` and `limit` (default10); implementation ignores both, uses category and `pageSize`(default20). |
| Analytics overview export | Runtime accepts budgetMin/budgetMax/page/limit/pageSize; operation parameters omit these. Pagination is validated but export remains unpaginated. |
| Bearer authorization | Several session-only OpenAPI operations (BidPrep, me, planned profile alias etc.) do not list the implemented scoped JWT Bearer alternative. Schemes describe scopes in prose, not an OAuth scope map. |
| Body and field semantics | OpenAPI does not universally encode byte caps, UTF-8 password cap, Unicode-code-point password length, aggregate draft text cap, username reserved names, sanitizer behavior, or every fallback/coercion described above. `maxLength` alone is not equivalent to these rules. |
| Error variants | 401/403 guards apply even when an operation omits them; legacy string-error envelopes differ. Permissive dates are weaker than `format: date`/ISO wording. Planned schema/response requirements should not be treated as backend validators. |

Priority hardening follow-up: use an own-property/set allowlist for analytics category, replace legacy `/projects` raw regex with bounded escaped search, standardize strict calendar parsing, bound keyword and notification arrays/body bytes, reject malformed root JSON consistently, validate operator target IDs and cap pagination arithmetic. These are observable gaps and deserve separate behavior-changing work with regression tests; #193 does not claim they are fixed.

## Verification and ASVS evidence

Run `node scripts/audit-api-documentation.js` to check every exported method/path is present in this dictionary and the RBAC matrix, local Markdown targets exist, and print actual OpenAPI method coverage. Run `npm run test:vitest`, `npm test`, `npm run build`, and `npx @redocly/cli lint docs/api/openapi.yaml` for regression/contract/build/lint evidence. Tests use fixtures; no real email/pipeline job needs to be triggered for this documentation work.

Manual examples: invalid `/api/tors?limit=101` must return400 `INVALID_LIMIT`; `/api/analytics/search?pageSize=101` must return400 `INVALID_PAGE_SIZE`; authenticated PUT `/api/profiles` with `{"past_projects":[{"name":"x","client":"y","value":"100","year":2569}]}` must return400 `INVALID_PROFILE` and no write. Use an allowed localhost Origin and an authorized session, and redact credentials from screenshots/logs.

ASVS V2.1.1 completion requires a teammate review and merge into develop. Only then set the sheet row DONE with #193 and merged documentation/PR evidence. This guide explicitly distinguishes tested validation, guard-only evidence and known gaps; it does not claim every implemented endpoint has a dedicated validation test.
