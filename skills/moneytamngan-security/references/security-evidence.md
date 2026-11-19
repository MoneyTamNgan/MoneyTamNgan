# Security code and evidence map

Read these paths from the active repository root. Missing files may exist only on a documentation branch; locate them or state that limitation instead of assuming the checkout contains them.

| Concern | Evidence to inspect |
| --- | --- |
| Roles, scopes and ownership | `docs/security/RBAC_SPEC.md`, `lib/auth.js`, `lib/account-status.js`, `lib/request-authorization.js`, `lib/route-security.js`, `proxy.js`, `lib/bid-prep/security.js` |
| Passwords and OAuth | `docs/security/AUTHENTICATION.md`, `docs/email-password-auth.md`, `lib/password-auth.js`, `lib/password-auth-handler.js`, `lib/oauth-security.js`, `app/api/auth/` |
| Validation and contract | `docs/API_VALIDATION.md`, `docs/api/openapi.yaml`, `scripts/audit-api-documentation.js`, `tests/contract/` |
| Headers and CORS | `lib/security-policy.js`, `next.config.js`, `proxy.js`, `docs/http-security-implementation-report.md`, `scripts/test-http-security.js` |
| Limits and sessions | `lib/rate-limit.js`, `lib/auth.js`, `lib/account-status.js`, `lib/bid-prep/security.js` |
| Logging and async pipeline | `lib/auth-audit.js`, `lib/admin-pipeline-audit.js`, `lib/admin-pipeline-store.js`, `models/PipelineTriggerAudit.js`, `docs/admin-pipeline-control.md` |
| Document and URL safety | `lib/archive-extractor.js`, `lib/url-safety.js`, `lib/scraper.js`, `tests/security/zip-slip.test.js`, `tests/security/file-signature.test.js` |
| Private AI drafts and retention | `docs/security/bid-prep-fr-4.7.md`, `lib/bid-prep/`, `tests/security/bid-prep-access.test.js`, `tests/security/bid-prep-privacy.test.js` |
| Security tests | `tests/security/`, `tests/integration/admin-pipeline.integration.test.js`, `tests/unit/ingestion-trigger-route.test.js`, `.github/workflows/ci.yml` |
| SAST and DAST | `.github/workflows/semgrep.yml`, `.github/workflows/zap-dast.yml`, `scripts/ci/summarize-sast.py`, `scripts/ci/summarize-zap.py`, `docs/security/reports/` |
| Dependency policy | `docs/security/VULNERABILITY_MGMT.md`, `scripts/check-dependency-audit.js`, `tests/security/dependency-audit.test.js`, `.github/workflows/ci.yml`; locate the current exception file from the checker |
| Threats and ASVS | `docs/security/THREAT_MODEL.md`, `docs/security/ASVS_CHECKLIST.md`, `docs/security/README.md` |
| Detailed coursework audit | `docs/security-assignment-audit-2026-11-19.md`, `docs/evidence/security-assignment-2026-11-19/`, `docs/presentation/security-four-presenters-script.md` |

## Historical baseline: 19 November 2026

These are audit observations, **not current guarantees**. Re-run relevant checks and inspect changed code before repeating them. The detailed audit was prepared on `docs/security-assignment-audit`; another checkout may not contain it yet.

- Rubric assessment: 13 covered, 5 partial. Partial areas: threat prioritization, validation/injection coverage, credential lifecycle, error handling, and logging. Covered does not mean certified or vulnerability-free.
- 340 Node + 460 Vitest tests passed, and production build passed. These are total automated tests, not 800 security-only tests. The separate API documentation audit failed.
- Latest same-code SAST evidence: 0 High, 50 warnings, with warning-level parse issues. Passive unauthenticated ZAP: 0 High, 1 Medium, 3 Low, 4 Informational. Medium concerned inline styles. Record which artifact supports each count.
- A fresh raw dependency audit returned no findings on that date. The earlier picomatch advisory had been withdrawn; an old exception is not evidence of a currently vulnerable dependency. Recheck current registry evidence.

## Known limitations to recheck before claiming closure

- JWT sessions have 24-hour absolute expiry. Logout cleared the cookie but did not invalidate a copied token before expiry. Disabled-account checks are a separate control.
- Login and API limiters were process-local fixed windows; restart and multiple replicas limit their effectiveness. IP attribution depends on a trustworthy proxy configuration.
- Some legacy handlers returned internal exception/provider messages. Password registration/login/logout events did not all have consistent audit records.
- Legacy raw search regex, inherited-key category allowlist behavior, notification bounds, and incomplete private-host/IPv6 URL checks remained concerns. A validation observation alone was not a demonstrated end-to-end exploit.
- Script CSP used nonces, but styles still allowed inline content. Localhost tests did not verify public TLS/HSTS enforcement.
- Full MFA, compromised-password screening, password recovery and idle timeout were not established by this audit.
- A bounded history scan found no matching secret patterns, but exposed-key revocation was unconfirmed. Watcharapat was identified as the SMTP account owner; account type and credential status should be verified when relevant.
- Threat priorities were audit proposals pending team adoption. External STRIDE-sheet status must be checked independently.

For a new report, retain only limitations still supported by the current code and label unverified items clearly. Do not carry old counts, exceptions or open issues forward as timeless project facts.
