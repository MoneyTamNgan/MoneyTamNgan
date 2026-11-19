# ASVS notes for authentication and BidPrep

Issue #103 named an ASVS 5.0.0 checklist that was not committed. The rows below are the ones issue #142 asks to bring up to date: V2, V6.2, V7, V8 and V14. "DONE" means the control is implemented and a test or document in this repo shows it. It is not a claim that every Level 1 item in the ASVS catalogue was re-scored.

## V6.2 Authentication verifiers (correction)

Earlier notes that treated sign-in as Google-only are out of date.

| Item | Status | What the code does | Evidence |
|---|---|---|---|
| V6.2 email login | DONE | `POST /api/auth/login` accepts an email identifier | `docs/email-password-auth.md`, `tests/integration/password-auth.integration.test.js` |
| V6.2 username login | DONE | The same route accepts a username. Registration stores an optional username. Reserved names are rejected | `lib/username.js`, `tests/unit/username.test.js`, issue #108 |
| V6.2 password storage | DONE | scrypt, per-password salt, `timingSafeEqual`, hash excluded from queries | `lib/password-auth.js`, `models/User.js` |
| V6.2 Google login | DONE | Authorization-code flow remains, with its own rate limit | `lib/oauth-security.js` |

Both email and username are live. A failure uses one message for an unknown identifier, a Google-only account and a wrong password.

## V2 Validation and business logic

| Item | Status | Evidence |
|---|---|---|
| V2 BidPrep input | DONE | Type, length and allowlist checks. Unknown owner/role fields are ignored. Oversized bodies return 413 | `lib/bid-prep/drafts.js`, `tests/security/bid-prep-access.test.js` |
| V2 Profile allowlist | DONE | Profile updates ignore `role` and a user id in the body | `tests/integration/scoped-profile-route.integration.test.js` |

## V7 Session management

| Item | Status | Evidence |
|---|---|---|
| V7 Session cookie | DONE | HttpOnly, SameSite=Lax, 24h, `auth_version` 2 | `lib/auth.js` |
| V7 BidPrep uses that session | DONE | Routes call `requestPrincipal`. A missing session is 401 | `lib/bid-prep/security.js` |

## V8 Authorization

| Item | Status | Evidence |
|---|---|---|
| V8 Object-level access | DONE | Draft, export, checklist and company deletion all key off `session.sub`. Another user's draft is 404 | `docs/security/bid-prep-fr-4.7.md`, `tests/security/bid-prep-access.test.js` |
| V8 Scope gate | DONE | `profile:read` / `profile:write`. A read-only token cannot create a draft. Unknown methods fail closed | `lib/request-authorization.js` |

## V14 Data protection

| Item | Status | Evidence |
|---|---|---|
| V14 Delete company data | DONE | API and profile button. Success is returned only after a second read shows the fields empty and the caller's drafts gone | `lib/bid-prep/deletion.js`, `app/profile/page.js` |
| V14 Minimisation toward Vertex | DONE | `buildProposalRequest` sends only the `publicProfile` allowlist | `lib/proposal/draft.js`, `tests/unit/proposal-draft.test.js`, `tests/security/bid-prep-privacy.test.js` |
| V14 Logs | DONE | Audit allowlist. 500 responses do not include the exception text | `lib/bid-prep/security.js` |
| V14 Retention period | DECIDED (team default), customer confirmation pending | Decision of 16 Nov 2026: data stays until the user deletes it. The customer has not confirmed in writing (#143). No period is invented here | `docs/security/bid-prep-fr-4.7.md` |

## V5 File handling and storage

| Item | Status | What the code does | Evidence |
|---|---|---|---|
| V5.2.2 Magic-byte validation | DONE | Downloaded files are checked for `%PDF-` or `PK` magic bytes before parsing or extraction; HTML, empty, and spoofed files are rejected, logged, and deleted without stopping the rest of the run | `lib/scraper.js`, `lib/archive-extractor.js`, `tests/security/file-signature.test.js` |
| V5.3.2 Zip Slip prevention | DONE | Every ZIP member path is checked against the scoped extraction directory (`../`, absolute paths, drive letters, and null bytes are skipped and logged), symlink entries are rejected, and one bad entry does not crash extraction of remaining valid documents | `lib/archive-extractor.js`, `tests/security/zip-slip.test.js` |

## Scanners

Semgrep (`p/owasp-top-ten`) fails the build on a High finding. ZAP baseline fails the `main` workflow on a High alert. See `docs/security/README.md`. New BidPrep routes are in the same tree those jobs scan. This change does not commit a fresh scanner artifact; CI is the current result.

## Specification evidence (#192 / #193)

These two rows use the cards' stricter acceptance gate: review by a teammate and merge into develop before the shared ASVS sheet is marked DONE. They do not change the earlier implementation-status rows above.

| Item | Status | Evidence / remaining action |
| --- | --- | --- |
| V8.1.1 RBAC specification (#192) | REVIEW PENDING | [RBAC_SPEC.md](RBAC_SPEC.md), [method matrix tests](../../tests/security/rbac-route-matrix.test.js). After approval/merge, link #192 and the merged file/PR in the sheet, then mark DONE. |
| V2.1.1 API validation dictionary (#193) | REVIEW PENDING | [API_VALIDATION.md](../API_VALIDATION.md), [route/link audit](../../scripts/audit-api-documentation.js). After approval/merge, link #193 and the merged file/PR in the sheet, then mark DONE. Known validation/OpenAPI gaps are listed explicitly. |

Local verification on 2026-11-16 at this implementation: 398 Vitest tests and 280 Node tests passed (678 total), production build passed, both documentation files cover all 58 live method/path pairs with valid local links. Cached Redocly CLI lint passed with nine existing warnings and four ignored problems. OpenAPI coverage audit identified 18 live operations absent from the spec and six spec operations without handlers; all are listed in the validation dictionary. CI, non-author review, merge and shared-sheet completion remain separate release gates.
