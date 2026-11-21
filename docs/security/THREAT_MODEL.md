# STRIDE threat model

Issue #103 asked for this file. It was not on `develop` when FR-4.7 started, so TH-1 to TH-10 record the controls already in the tree, and TH-11 onward are the BidPrep threats. Evidence is a path in this repo, not a claim that a scanner was re-run for the older rows.

| Id | STRIDE | Threat | Mitigation | Status | Evidence |
|---|---|---|---|---|---|
| TH-1 | Spoofing | Forged or legacy session | `auth_version` 2 and role-bounded scopes; bad tokens are rejected | Mitigated | `lib/auth.js`, `tests/security/scopes-cors-headers.test.js` |
| TH-2 | Spoofing | OAuth login abuse | Separate start/callback limits, state cookie, audit event | Mitigated | `lib/oauth-security.js`, `lib/auth-audit.js` |
| TH-3 | Tampering | Profile mass-assignment (`role`, other user id) | Updates use `session.sub` and an allowlist | Mitigated | `tests/integration/scoped-profile-route.integration.test.js` |
| TH-4 | Repudiation | Auth events not attributable | Allowlisted auth audit log (`logAuthAudit`) covering OAuth denials/callbacks, password register/login/rate-limits, and logout with 90-day retention policy; no secrets logged | Mitigated | `lib/auth-audit.js`, `lib/password-auth-handler.js`, `app/api/auth/logout/route.js`, `docs/security/AUTHENTICATION.md` |
| TH-5 | Information disclosure | Password hash leaked | `select: false`, JSON transform, public field allowlist | Mitigated | `models/User.js`, `docs/email-password-auth.md` |
| TH-6 | Information disclosure | Login errors distinguish accounts | One 401 message; dummy KDF for missing accounts | Mitigated | `lib/password-auth.js`, `docs/email-password-auth.md` |
| TH-7 | Denial of service | Guest and login floods | Fixed-window limits and `Retry-After` | Mitigated for one process | `lib/rate-limit.js`, `lib/oauth-security.js` |
| TH-8 | Elevation of privilege | Pipeline token used as admin | Pipeline scopes cannot call profile or admin routes | Mitigated | `tests/security/scopes-cors-headers.test.js` |
| TH-9 | Tampering | Cross-site mutation | Exact origins, no wildcard, cookie mutations need `Origin` | Mitigated | `lib/security-policy.js` |
| TH-10 | Information disclosure | Remote document URL to a private host | Scheme, credential, IPv4/IPv6 literal (`[::1]`, ULA, CGNAT, IPv4-mapped) checks (`validateRemoteDocumentUrl`) plus async DNS resolution check (`resolveAndValidateRemoteDocumentUrl`) | Mitigated | `lib/url-safety.js`, `tests/security/url-safety.test.js` |
| TH-11 | Tampering | Prompt injection from TOR text | Fixed system prompt; TOR text is delimited data and delimiter characters inside it are escaped; output must match a response schema and unsourced statements are dropped | Mitigated in the request builder and the output check, tested with a mocked model. Also run once against the local qwen2.5:3b model on 19 Nov 2026: the structure was kept and the system prompt was not leaked (see docs/connectivity-test-2026-11-19.md). One model and one TOR only | `lib/proposal/draft.js` (`buildProposalRequest`), `tests/unit/proposal-draft.test.js`, `tests/security/bid-prep-privacy.test.js` |
| TH-12 | Elevation of privilege | BOLA on drafts, checklist and company data | Every query includes `session.sub`. Another user's draft is 404. Checklist ignores a user id in the query | Mitigated | `docs/security/bid-prep-fr-4.7.md`, `tests/security/bid-prep-access.test.js` |
| TH-13 | Denial of service | Vertex cost and oversized drafts | Draft creation default 5/hour, export and delete hourly caps, 128 KiB body, 50 drafts | Mitigated per process. Several instances do not share counters | `lib/bid-prep/security.js`, access test `returns 429` |
| TH-14 | Information disclosure | Company data and PDPA leakage | Delete-and-verify, Vertex allowlist, audit allowlist, generic 500 | Mitigated for collection and logs. Retention: team decision of 16 Nov 2026 is to keep data until the user deletes it; customer confirmation is pending (#143) | `lib/bid-prep/deletion.js`, `docs/security/bid-prep-fr-4.7.md` |
| TH-15 | Repudiation | AI text treated as a submitted bid | UI, API `notices` and DOCX say it is a draft and that the seller submits to e-GP. Checklist items stay `manual` | Mitigated by disclosure. A person still has to check the text | `components/ui/NoEgpSubmissionNotice.js`, `lib/bid-prep/docx.js` |
| TH-16 | Tampering | CSRF on draft and delete calls | Same origin rule as the rest of the API. Export is POST, not GET | Mitigated | `lib/route-security.js`, access test `cookie mutation without an allowed Origin` |
| TH-17 | Tampering | Formula or markup in an export | Plain-text DOCX, XML escape, leading apostrophe on formula characters. No macros | Mitigated | `tests/security/bid-prep-privacy.test.js` |
| TH-18 | Elevation of privilege | A BidPrep route submits to e-GP | No e-GP client is imported. The file and the pages tell the user to submit | Mitigated | privacy test `does not submit a bid` |

Residual: rate-limit counters are in memory, and the customer has not yet confirmed the retention decision (kept until the user deletes it).

## Admin pipeline control evidence — #78

| Id | STRIDE | Threat | Mitigation | Evidence |
|---|---|---|---|---|
| TH-19 | Denial of service / tampering | Parallel manual pipelines or a restart leaving a permanent running flag | Atomic singleton MongoDB lease, heartbeat, expiry recovery, owner fencing; active reset returns 409 | `lib/admin-pipeline-control.js`, `lib/admin-pipeline-store.js`, `tests/integration/admin-pipeline-recovery.test.js` |
| TH-20 | Repudiation / elevation of privilege | Unattributed or unauthorized pipeline triggers | Independent Proxy/handler admin scopes, durable allowed-attempt audit and bounded denial logs | `lib/admin-pipeline-audit.js`, `models/PipelineTriggerAudit.js`, `tests/integration/admin-pipeline.integration.test.js` |

The supplied [STRIDE sheet](https://docs.google.com/spreadsheets/d/1mZCqus4RaeYQnVjN70ffu9_TbxBNA1OslLpimWm1YYU/edit?gid=1505854712#gid=1505854712) was inspected. Its **TH-02 (row 3)** is admin elevation of privilege and maps to repository TH-8 + TH-20. Its **TH-06 (row 7)** is pipeline/public API denial of service and maps to TH-19. Both can reference [the #78 runbook and saved F3/F7 updates](../admin-pipeline-control.md) and [sanitized live response evidence](../evidence/admin-pipeline-http.json). The original sheet opens View only; F3/F7 were saved and verified on 2026-11-13 in the [owner-created editable copy](https://docs.google.com/spreadsheets/d/1DAK7xXw7uJ3rpTrQNPMUjbzi6WOAh-0dQBn6BTv8dQo/edit?gid=1505854712#gid=1505854712). Existing repository TH-2 (OAuth abuse) and TH-6 (login disclosure) retain their original meanings.

## Zip Slip prevention — STRIDE TH-03 / ASVS V5.3.2

| Id | STRIDE | Threat | Mitigation | Status | Evidence |
|---|---|---|---|---|---|
| TH-03 (sheet) | Tampering | Weaponized ZIP containing `../`, absolute paths, drive letters, or symlinks writes outside the extraction folder (Zip Slip) | Every member path is decoded without aborting the archive, resolved and verified to stay inside the scoped extraction directory, symlinks are rejected, and escaping/bad entries are skipped and logged so valid documents still extract | Mitigated | `lib/archive-extractor.js`, `tests/security/zip-slip.test.js` |

## Audit findings and priority tracking (21 November 2026)

| Finding | Priority | Mitigation implemented | Status | Evidence |
| --- | --- | --- | --- | --- |
| AUD-01: Revocation of previously exposed Resend credential | P0 | Credential owner (Watcharapat) confirmed key revocation and SMTP-only transport configuration | Resolved | `docs/smtp-delivery-verification-2026-11-18.md` |
| AUD-02: Copied JWT remains usable after logout | P1 | `POST /api/auth/logout` revokes tokens immediately via `revokeSessionToken()` and bumps `User.session_version` (`sv` claim checked in `verifyActiveSession()`) | Mitigated & Tested | `lib/account-status.js`, `app/api/auth/logout/route.js`, `tests/security/session-disabled.test.js` |
| AUD-03: Legacy errors expose internal/provider details | P1 | Removed OAuth `details: tokenData` and replaced raw `error.message` in 500/503 catch blocks across `/api/*` routes with safe static messages | Mitigated | `app/api/auth/google/callback/route.js`, `app/api/health/route.js`, `app/api/test-db/route.js`, `app/api/**` |
| AUD-04: Validation, private-host URL checks and auth logging gaps | P1 | Escaped `/api/projects` search regex & validated dates/booleans, fixed `Object.hasOwn` analytics category check, bounded `/api/notifications/test` body, hardened IPv6/DNS SSRF checks, completed auth audit events, and tightened CSP `base-uri 'none'` | Mitigated & Tested | `app/api/projects/route.js`, `lib/analytics.js`, `app/api/notifications/test/route.js`, `lib/url-safety.js`, `tests/security/url-safety.test.js`, `lib/auth-audit.js` |
| AUD-05: Rate-limit cross-replica plan & API doc synchronization | P2 | Fixed `PATCH /api/bid-prep/tors/[projectId]/checklist` and all 18 live operations in `docs/api/openapi.yaml`, `docs/API_VALIDATION.md`, and `docs/security/RBAC_SPEC.md`; Redis/shared store documented as multi-replica prerequisite | Implemented (docs synced) | `scripts/audit-api-documentation.js`, `docs/api/openapi.yaml`, `docs/API_VALIDATION.md`, `docs/security/RBAC_SPEC.md` |
