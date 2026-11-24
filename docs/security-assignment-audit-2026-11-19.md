# MoneyTamNgan — Software Development Security assignment audit

Historical assignment audit. Product requirement links are in [traceability.md](traceability.md). BidPrep privacy is BidPrep FR-4.7.

**Course:** 01219325 Software Development Security  
**Audit date:** 19 November 2026, Asia/Bangkok  
**Code baseline:** `b053761a9222f4300f4519ead308ccd67514b191`, latest fetched `develop` and `main`. PR #164 is merged.  
**Submission:** Sunday 22 November 2026, 23:59 Bangkok time. Presentation: Monday 23 November 2026, 13:00 Bangkok time.

## Overview and audit scope

**The project addresses all 18 rubric topics, but it is not accurate to call every criterion fully complete.** This assessment rates **13 covered and 5 partial**. “Covered” means a demonstrable implementation or required documentation exists, not a full ASVS certification, a guarantee of security, or a predicted grade. The five partial areas are threat prioritization, consistent validation/injection protection, credential lifecycle assurance, error handling, and security logging.

The six numbered sections below follow the requested project-document structure; the rubric assessment and supporting checklists are retained as appendices.

The four advanced features required by criterion 18 are present: scoped authorization, login-attempt limiting, backend API limiting, and JWT expiration checking. MFA is not needed to reach four; it is not implemented. Session expiration must not be counted a second time as an inactivity timeout.

Fresh checks passed **340 Node tests + 460 Vitest tests = 800**, and the production build. Live local header/CORS/denial checks passed. However, the API documentation audit failed. Passing automated tests and scanner gates does not establish that the gaps below are fixed.

This was a read-only assessment of application behavior. A separate local server used dummy credentials on port 3119; no production database writes, real users, new emails, paid Vertex calls or government scraping were required. Fresh SAST/DAST results were downloaded from successful CI runs, not falsely described as new local scans. Detailed results are in [verification-summary.json](evidence/security-assignment-2026-11-19/verification-summary.json).

## 1. Application name and all team members

**Application:** MoneyTamNgan, a Thai software procurement/TOR discovery and bid-preparation web application.

Team roster confirmed by the owner on 19 November 2026:

- Phruek Chantarasittiphon
- Watcharapat Pathanutpong
- Peerawat Theerasakul
- Napat Sirichan

## 2. Functional features

Implemented features:

- Government/e-GP discovery, software classification and bidding-status assessment.
- PDF/ZIP acquisition, embedded-text extraction and Thai OCR with document provenance.
- Vertex summaries, restrictive-condition analysis, fiscal-year and announcement-schedule extraction.
- Project search, filters, procurement analytics and profile skill matching.
- Company profiles, immediate notifications and daily email digests.
- Bid drafts, checklists and DOCX export, with no automated bid submission.
- Protected admin pipeline, classification and review tools.

External anti-bot availability, OCR accuracy and model output remain functional limitations; this audit does not claim every external pipeline succeeds.

The stack is Next.js/React, Node.js route handlers and workers, MongoDB/Mongoose, Puppeteer/HTTP retrieval, Tesseract/Poppler and Vertex AI. [README](../README.md) supplies installation instructions; [pipeline](pipeline.md) and [reference guide](reference.md) explain the functional architecture.

## 3. Security features mapped to OWASP ASVS security requirements

Use **ASVS 5.0.0**, the current stable release linked by [OWASP](https://asvs.owasp.org/). IDs and levels were checked against the [official versioned catalogue](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv). Short labels below are paraphrases. This selection is not a full catalogue assessment.

| Versioned requirement | Level | Short label | Implementation assessment |
| --- | --- | --- | --- |
| `v5.0.0-2.1.1` | 1 | Validation documentation | Partial: dictionary exists; current checklist PATCH entry missing. |
| `v5.0.0-2.2.1` | 1 | Positive input validation | Partial: strong auth/profile validation; legacy gaps remain. |
| `v5.0.0-1.2.4` | 1 | Database injection defenses | Controlled query construction/type checks exist; raw regex and endpoint gaps prevent a blanket claim. |
| `v5.0.0-6.1.1` | 1 | Document anti-automation | Authentication design and exact limits documented. |
| `v5.0.0-6.2.1` | 1 | Minimum password length | 15–128 Unicode code points, with UTF-8 byte cap. |
| `v5.0.0-6.3.1` | 1 | Resist automated login | Implemented limits; single-process limitations apply. |
| `v5.0.0-11.4.2` | 2 | Password KDF storage | scrypt N=131072/r=8/p=1, per-password 16-byte salt, constant-time comparison. |
| `v5.0.0-3.4.2` | 1 | Constrain CORS origins | Exact allowlist and rejection checks verified. |
| `v5.0.0-3.4.1` | 1 | HSTS policy | Header verified; real HTTPS enforcement not tested. |
| `v5.0.0-3.4.3` | 2 | CSP protection | Partial strict-standard claim: nonce/object restrictions exist, but `base-uri 'self'` differs from the catalogue minimum `base-uri 'none'`. |
| `v5.0.0-8.2.1`, `8.2.2`, `8.3.1` | 1 | Function/object/server authorization | Role/scope gates plus owner-qualified queries; tested for implemented resources. |
| `v5.0.0-9.1.1`, `9.1.2` | 1 | Token signature/algorithm checks | MAC validation and HS256-only verification. |
| `v5.0.0-7.3.2` | 2 | Absolute session lifetime | 24 hours; an appropriate lifetime still depends on risk decisions. |
| `v5.0.0-7.4.1` | 1 | Revoke terminated sessions | **Not met for copied JWTs:** logout only clears cookie. |
| `v5.0.0-7.4.2` | 1 | Disable-account session termination | Real account state checked server-side on authenticated access; tests pass. |
| `v5.0.0-16.3.1` | 2 | Authentication event logging | Partial: not all auth operations are logged. |
| `v5.0.0-16.5.1` | 2 | Safe unexpected errors | Partial: generic handling is inconsistent. |

Other concrete gaps include password change (`v5.0.0-6.2.2`), common-password rejection (`6.2.4`), breached-password checks (`6.2.12`, Level 2), and inactivity timeout (`7.3.1`, Level 2). Cookie naming also falls short of `v5.0.0-3.3.1`: production uses Secure, but `mtn_session` lacks the specified secure prefix. Thus the application must **not** be labelled fully ASVS Level 1 compliant.

The repository's “V6.2 password storage” row is a chapter-level implementation note; the precise KDF reference is `v5.0.0-11.4.2`. Reserved username rejection alone is not proof that default accounts are disabled under `6.3.2`.

## 4. Threat modeling performed for this project

Trust boundaries: untrusted browser → Next.js API/Proxy; API/worker → MongoDB; worker → government document hosts; OCR/text → Vertex; mail helper → SMTP. Incoming PDFs, archive names and model output are untrusted data. Admin and machine credentials cross different authorization boundaries.

The following priorities are **audit recommendations**, not a claim that the original team sheet already approved them. P0 means before public submission/release decisions where applicable; P1 means address before a public deployment; P2 means tracked hardening. This is prioritization, not a quantitative risk score.

| Threat/model link | Priority | Current mitigation / verification | Checklist state |
| --- | --- | --- | --- |
| Credential exposure, TH-5/TH-14 plus earlier exposed key | P0 | Secrets excluded from app source; 1,532 historical text blobs checked by bounded patterns with no candidates. | Partial: confirm key revocation; a heuristic scan cannot prove no historical secrets. |
| Forged sessions/admin elevation, TH-1/TH-8/TH-20 | P1 | Signed scopes, algorithm allowlist, separate machine boundaries and 401/403 tests. | Implemented/tested. |
| Cross-user access, TH-3/TH-12 | P1 | `session.sub`, field allowlists, owner-qualified draft operations. | Implemented/tested for these resources. |
| Cross-site mutations, TH-9/TH-16 | P1 | Exact origins and guard enforcement. | Implemented/tested. |
| Session reuse after logout — audit finding | P1 | Cookie removal and absolute expiry exist. | **Partial:** copied signed token still verifies after logout; add backend revocation/token versioning. |
| Error disclosure, TH-5/TH-14-related | P1 | Generic password/BidPrep failures. | **Partial:** other routes expose exception/provider details. |
| Missing event trail, TH-4 | P1 | Allowlisted OAuth-denial/pipeline/BidPrep logs. | **Partial:** password/login/logout coverage and retention not complete. |
| Flooding/expensive work, TH-7/TH-13 | P1 | Rate limits, bounded KDF concurrency and quotas. | Partial across replicas; forwarded-header trust and unbounded notification inputs remain. |
| Remote URL/private-host access, TH-10 | P1 | Scheme, credential and some literal-address checks; redirects revalidated. | **Partial:** helper accepts `http://[::1]/`; no network request was made. DNS/private-resolution protection is not established. This is not a proven end-to-end SSRF exploit. |
| Archive traversal and invalid files, sheet TH-03 | P1 | Magic bytes, scoped path checks, symlink rejection and tests. | Implemented/tested; no blanket guarantee for all document-parser vulnerabilities. |
| Parallel pipeline/restart state, TH-19/TH-20 | P1 | Atomic lease, expiry, owner fencing and trigger audit. | Implemented/tested. |
| Prompt injection/data minimization, TH-11/TH-14 | P2 | Delimited TOR payload, fixed instructions, allowlisted company data. | Partial by nature: no guarantee model follows every instruction or every OCR fact is correct. |
| Export/AI-as-submission misuse, TH-15/TH-17/TH-18 | P2 | Escaping, plain DOCX content and non-submission notices. | Implemented/tested; user review of bid content remains required. |

Some original rows say “Mitigated” more broadly than this audit supports, especially TH-10 and logging. Reconcile those statuses and the separate STRIDE sheet instead of copying them as unconditional pass claims.

## 5. Security principles followed in the implementation

| Principle | Concrete implementation | Residual limitation |
| --- | --- | --- |
| Least privilege | User/admin/pipeline/cron scopes are separated; registration fixes role=user; minimal owner-qualified queries. | JWT-signing secret and database credentials remain high-trust assets. |
| Complete mediation | Proxy plus independent route guards; profile/draft operations use signed identity. | New endpoints must use the same guards and ownership tests. |
| Fail-safe defaults | Unknown protected mutations require permission; foreign origins and invalid sessions are rejected. | Legacy error envelopes and validation are inconsistent. |
| Defense in depth | Authorization, ownership, validation, CSP, origin checks, rate limits and CI scanning operate at different layers. | Scanners do not prove complete safety; missing controls remain explicit. |
| Minimize exposed data | Hash hidden from serialization; private configuration ignored; Vertex payload and audit fields allowlisted. | Old key revocation and retention/customer decisions remain open. |
| Limit resources and isolate work | Hash concurrency cap, bounded auth bodies, ZIP extraction protections, job leases and isolated test databases. | Rate-limit counters are not distributed; some legacy bodies remain unbounded. |

## 6. Security test process

1. Pin the audited commit/tree; use an isolated worktree and locked dependency install.
2. Read security specifications and follow their source/test links. Confirm behavior in code rather than accepting DONE labels.
3. Run Node and Vitest suites, production build, dependency audit, documentation audit and OpenAPI lint.
4. Download current successful CI SAST/DAST artifacts and verify their source tree. The latest DAST commit `38849ab` and audited `b053761` share tree `c5e04d7…`; this is same-code evidence, not a newly initiated scan.
5. Start a loopback production server with dummy credentials. Check headers, per-request nonce, CORS and denied access; test logout/expiry without real accounts.
6. Scan locally fetched Git text history with bounded secret patterns, outputting only metadata. No credential value is included in the evidence.
7. Record failed checks and residual risk, then perform presentation/browser checks separately.

| Check | Fresh result |
| --- | --- |
| `npm test` | 340 passed, 0 failed |
| `npm run test:vitest` | 460 passed, 0 failed, 50 files |
| `npm run build` | Passed with dummy configuration |
| `npm run audit:dependencies` and raw npm audit | Passed; raw report currently has 0 findings |
| OpenAPI lint, cached Redocly CLI | Passed; 9 warnings, 4 explicitly ignored |
| `node scripts/audit-api-documentation.js` | **Failed:** two documents omit the checklist PATCH method; 18 missing live OpenAPI operations, six spec-only operations |
| Local HTTP smoke | Five headers, fresh/matching script nonce, origin checks and 401/403 denials passed |
| JWT checks | Expired token and HS384 rejected; lifetime 86,400 seconds; logout replay limitation confirmed |
| Historical secret-pattern check | 1,532 text blobs, 0 candidate matches; no guarantee of full secret coverage |
| Fresh CI Semgrep artifact | 0 High, 50 Warning, 2 warning parse errors |
| Fresh CI ZAP artifact | 0 High, 1 Medium, 3 Low, 4 Informational |

SAST warnings comprise 20 mutable action-tag findings, 25 HTTP links in existing report output, four workflow environment-secret findings and one raw-HTML-format finding. Triage them rather than equating 50 warnings with 50 confirmed exploitable application bugs.

ZAP's Medium is `style-src unsafe-inline`; Low alerts concern COEP/COOP/CORP. The passive unauthenticated spider does not establish protection of logged-in admin/profile/draft flows. Those are supported by separate automated authorization tests, not by ZAP.

**Dependency freshness:** the [picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) was withdrawn on 18 November 2026; today's raw registry audit has zero findings. The older “five high findings” evidence is historical, not today's result. The approved exception remains in the manifest until 2 December and is currently unused by a finding; review removing it without rewriting history. Zero registry findings does not prove absence of all vulnerabilities.

The secret check excluded ignored/untracked private env files, binary content and refs not fetched locally, and recognizes only selected patterns. The owner previously stated Resend-key revocation was uncertain; this audit did not enter any provider account or use the old key.

## Appendix A. Assessment against all 18 criteria

| # | Assignment criterion | Assessment | Evidence and qualification |
| --- | --- | --- | --- |
| 1 | List of ASVS requirements followed | **Covered, selected scope** | [ASVS checklist](security/ASVS_CHECKLIST.md), selected versioned mapping below and [validation dictionary](API_VALIDATION.md). The existing checklist is selective; it is not a complete Level 1 assessment. |
| 2 | Threat modeling, priorities and mitigations | **Partial** | [STRIDE model](security/THREAT_MODEL.md) identifies threats and mitigations. It has no consistent explicit priority/likelihood/impact column. Section 4 proposes priorities, but team adoption and reconciliation with the external sheet remain necessary. |
| 3 | Map security design principles | **Covered in this report and README** | Section 5 links least privilege, mediation, fail-closed behavior, defense in depth and minimization to actual controls. This is a retrospective mapping, not evidence of when design decisions were made. |
| 4 | Password authentication | **Covered** | [Password handler](../lib/password-auth-handler.js), [KDF](../lib/password-auth.js), [tests](../tests/integration/password-auth.integration.test.js): register/login by email or username, random salt, scrypt, generic wrong-password response and hidden hash. No password reset/change or breached-password screening. |
| 5 | Social OAuth/OpenID sign-in | **Covered at implementation/test level** | Google authorization-code flow, state cookie, verified email and shared JWT session. [Callback](../app/api/auth/google/callback/route.js), [OAuth tests](../tests/integration/google-oauth-security.integration.test.js). A new real Google account consent/login was not performed in this audit. |
| 6 | Role-based authorization | **Covered** | [Role/scope definitions](../lib/auth.js), [request authorization](../lib/request-authorization.js), [RBAC tests](../tests/security/rbac-route-matrix.test.js). User, admin and machine principals have distinct permissions. |
| 7 | Prevent access to another user's data | **Covered for tested user resources** | Queries bind profiles/drafts/checklists to `session.sub`; another owner's draft returns 404. [Draft service](../lib/bid-prep/drafts.js), [ownership tests](../tests/security/bid-prep-access.test.js). This is evidence for these resources, not every future endpoint. |
| 8 | Input validation and injection protection | **Partial** | Type checks, allowlists, bounded auth bodies, controlled Mongo queries and escaping exist. Legacy `/api/projects?search=` uses raw regex; analytics category uses inherited-property membership; notification test input lacks schema/body bounds. Mongoose alone does not prove NoSQL-injection safety. SQL is not used. |
| 9 | Environment variables and credentials | **Partial** | `.env.example`, ignored private configuration and server-only credentials exist. The bounded history pattern scan found no candidates, but does not certify every secret format/ref. Revocation of the previously exposed Resend key was not confirmed by the owner. |
| 10 | CORS without wildcard origins | **Covered** | [Origin policy](../lib/security-policy.js), [Next config](../next.config.js), Proxy and route guards enforce exact origins. Live preflight accepted the configured loopback origin and rejected foreign, `*` and `null` origins. |
| 11 | Error handling | **Partial** | Password/BidPrep paths return generic errors, but public health, TOR/project and other handlers return `error.message`; Google callback returns an unfiltered provider error payload and exception message. No claim that secrets were observed leaking is made. |
| 12 | Security/event logging | **Partial** | Structured OAuth rejection, pipeline, BidPrep and notification logging exists. Password registration/login success/failure and logout lack consistent auth-audit calls. Central retention/alerting and complete access-denial coverage are not established. |
| 13 | HTTP security headers | **Covered in code and live HTTP checks** | CSP nonce, HSTS, DENY, nosniff and referrer policy verified. [Saved headers](evidence/security-assignment-2026-11-19/live-http.json). The team must show custom configuration in the presentation; a browser DevTools screenshot is still useful. HTTP localhost does not verify HTTPS enforcement. |
| 14 | SAST tool and report | **Covered** | Latest [Semgrep run](https://github.com/MoneyTamNgan/MoneyTamNgan/actions/runs/44472921630), [saved JSON](evidence/security-assignment-2026-11-19/sast-report.json): 0 ERROR/High, 50 WARNING, two warning-level parsing errors. Green is not warning-free. |
| 15 | DAST tool and report | **Covered, baseline scope** | Latest [ZAP run](https://github.com/MoneyTamNgan/MoneyTamNgan/actions/runs/44472812671), [saved JSON](evidence/security-assignment-2026-11-19/zap-dast-report.json): 0 High, 1 Medium, 3 Low, 4 Informational. Passive unauthenticated scan, not an authenticated penetration test. |
| 16 | Map mitigation implementation back to threats | **Covered as a checklist** | Existing STRIDE evidence plus Section 4 explicitly distinguish tested controls, partial controls and residual risk. The assignment permits incomplete mitigations when honestly listed. External sheet alignment still needs checking. |
| 17 | Map implementation to ASVS and Top 10 | **Covered, selected scope** | Section 3 and Appendix C provide versioned ASVS and Top 10:2025 mappings. They do not imply every requirement/category is fully mitigated. Earlier broad chapter labels must not be presented as exact verified requirement IDs. |
| 18 | Four advanced features | **Covered** | Four distinct controls are identified in Appendix B. Additional MFA, inactivity timeout and compromised-password checking are absent. |

## Appendix B. Advanced features and limitations

| Course option | Current state | Demonstrable evidence / limit |
| --- | --- | --- |
| Authorization with scopes | **Implemented — count 1** | Signed, role-bounded scopes; read-only tokens cannot mutate; machine credentials cannot become admin. `lib/auth.js`, `lib/request-authorization.js`, scope tests. |
| Login-attempt rate limit | **Implemented — count 2** | Auth IP 30/15 minutes; identifier and resolved account 10/15 minutes; Google start/callback 5/15 minutes. Fixed-window counters are process-local. |
| Backend API rate limit | **Implemented — count 3** | Public reads default 60/minute guest, 300/minute signed-in; BidPrep has per-user limits. It is not a universal limiter for every endpoint. |
| JWT expiration checking/management | **Implemented with limits — count 4** | Signed HS256 tokens expire after 86,400 seconds; expired and non-allowlisted algorithms rejected; disabled/deleted real accounts refused. [Offline verification](evidence/security-assignment-2026-11-19/jwt.json). Copied-token revocation on logout is missing. |
| Login inactivity timeout | **Not implemented as a distinct feature** | Absolute 24-hour JWT lifetime is not an idle timer. Do not double-count it. |
| Compromised-password checking | **Not implemented** | No registration blocklist/breached-password lookup was found. Length and scrypt do not provide this control. |
| MFA / OTP / verification | **Not implemented by this application** | Local registration signs in immediately; no local email verification or OTP. The app does not require Google MFA. A TOR notification email is not authentication or MFA. |

Forwarded-IP headers require a trusted reverse proxy. A directly reachable app can accept client-supplied forwarding headers; counters also reset on restart and are not shared between replicas. These limits must be explained during the demo.

## Appendix C. OWASP Top 10 mapping

This report uses [OWASP Top 10:2025](https://top10.owasp.org/2025/), the current release. The Semgrep ruleset name `p/owasp-top-ten` does not itself establish a complete version-specific mapping.

| 2025 category | Implemented controls | Remaining qualification |
| --- | --- | --- |
| A01 Broken Access Control | Roles/scopes, owner queries, origin rules. | Keep new route coverage current. |
| A02 Security Misconfiguration | Security headers, exact CORS, private cookies, non-root container. | Inline styles, missing isolation headers, HTTP-only local setup and secure cookie prefix gaps. |
| A03 Software Supply Chain Failures | Lockfile, full audit, expiring risk gate, SAST. | Actions pinned by mutable tags; container/action dependency coverage is incomplete. |
| A04 Cryptographic Failures | scrypt, salts, JWT MAC/algorithm checks. | Credential lifecycle confirmation, HTTPS deployment and key-management evidence. |
| A05 Injection | Typed queries, escaping, validation, safe DOCX output. | Raw legacy regex, category allowlist bug, input-bound gaps and URL-helper weakness. |
| A06 Insecure Design | STRIDE, bounded expensive work, pipeline leases and user ownership. | Team-adopted priorities and confirmed retention requirements. |
| A07 Authentication Failures | Password and Google login, limits, token expiry and disabled-account checks. | Password change/recovery, common/breached-password checks, MFA and logout revocation. |
| A08 Software or Data Integrity Failures | Controlled structured parsing, document hashes, provenance, archive checks and transactions. | Model output is not independently proven factual; full software provenance is not established. |
| A09 Security Logging and Alerting Failures | Structured security-event helpers and pipeline audit records. | Missing full authentication trail, retention and alerting. |
| A10 Mishandling of Exceptional Conditions | Generic errors in selected services, bounded work and recovery logic. | Raw exception/provider details and inconsistent legacy handling. |

## Appendix D. What to finish before submission

### Implementation/security priorities

- [ ] Revoke the previously exposed key and have the account owner record confirmation; do not paste it into evidence.
- [ ] Implement server-side invalidation for copied tokens after logout; add replay regression tests.
- [ ] Replace raw unexpected/provider errors with generic messages and sanitized event logs.
- [ ] Log password/login/logout and important denials consistently, with defined retention/access.
- [ ] Fix the IPv6/hostname-resolution URL checks and test real downloader redirect/address behavior in isolation.
- [ ] Escape/bound legacy search, use own-property category validation, and bound notification test input.
- [ ] Keep the existing per-process rate-limit limitations explicit; use a trusted proxy/shared store before scaling.

### Documentation and demonstration priorities

- [x] Confirm application name and full four-person roster; include six required README sections.
- [x] Provide this criterion matrix, principles map, threat checklist, selected ASVS and Top 10 mappings.
- [ ] Team-review and adopt threat priorities; synchronize the external STRIDE/ASVS sheet and correct overbroad DONE/Mitigated labels.
- [ ] Add the checklist PATCH endpoint to validation/RBAC documentation; reconcile the 18 missing and six spec-only OpenAPI operations.
- [ ] Walk through custom header configuration in `next.config.js`, `lib/security-policy.js` and `proxy.js` during the presentation; save a DevTools Network screenshot. Do not claim local HTTP demonstrates TLS/HSTS enforcement.
- [ ] Demonstrate actual Google sign-in and password login on the presentation machine. Use two disposable users to show a cross-owner denial; include 401/403/429 examples without revealing credentials.
- [ ] Review/update the deck for this security course: four advanced features, threat priorities, ASVS mappings and latest evidence. Its current notes still say SMTP is deferred, which is outdated.
- [ ] Submit repository, project document and slides by the deadline. README has setup commands and the repository is public; instructor-collaborator access is not needed for the public option. Confirm no sensitive data before submission.

This audit supplies the requested Markdown project/security report and README material. It does not silently implement the identified gaps, certify full ASVS Level 1, claim active penetration testing, or replace a teammate/instructor review.

## Appendix E. Evidence and document index

- [Fresh verification summary](evidence/security-assignment-2026-11-19/verification-summary.json)
- [Live headers/logout](evidence/security-assignment-2026-11-19/live-http.json) and [JWT checks](evidence/security-assignment-2026-11-19/jwt.json)
- [Raw npm audit](evidence/security-assignment-2026-11-19/npm-audit.json), [API doc audit](evidence/security-assignment-2026-11-19/api-documentation-audit.json), [bounded history scan](evidence/security-assignment-2026-11-19/history-pattern-scan.json)
- [Fresh Semgrep JSON](evidence/security-assignment-2026-11-19/sast-report.json), [fresh ZAP JSON](evidence/security-assignment-2026-11-19/zap-dast-report.json), [existing scanner runbook/HTML report](security/README.md)
- [Authentication design](security/AUTHENTICATION.md), [RBAC specification](security/RBAC_SPEC.md), [API validation](API_VALIDATION.md), [BidPrep security](security/bid-prep-fr-4.7.md)
- [STRIDE model](security/THREAT_MODEL.md), [ASVS notes](security/ASVS_CHECKLIST.md), [dependency policy](security/VULNERABILITY_MGMT.md), [HTTP implementation report](http-security-implementation-report.md)

All security documents above were reviewed alongside current source; their older dates, test counts and unresolved acceptance notes are not automatically current. The shared Google Sheets were not revalidated in this audit.
