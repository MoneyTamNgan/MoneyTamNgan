# Controls and evidence map

Operational control map. SRS links are in [traceability.md](../traceability.md). BidPrep ownership traces to BidPrep FR-4.7.

For each topic an auditor raises: what we do, where the proof is, and its honest status. "Gap" means a known weakness or something not evidenced yet; it is listed rather than hidden.

## A. Access control and authentication
| Topic | What we do | Evidence | Status |
|---|---|---|---|
| Authentication | Email/username + password (scrypt N=131072, salt, `timingSafeEqual`), Google OAuth with one-time `state` | [AUTHENTICATION.md](../security/AUTHENTICATION.md), `lib/password-auth.js`, `lib/oauth-security.js` | Done |
| Session | JWT in HttpOnly SameSite=Lax cookie, 24 h, `Secure` in production; logout revokes and bumps `session_version`; disabled accounts refused | `lib/auth.js`, `lib/account-status.js`, [ASVS V7](../security/ASVS_CHECKLIST.md) | Done |
| Authorisation (RBAC) | Roles guest / user / admin / pipeline token; scope per route; 58-route matrix | [RBAC_SPEC.md](../security/RBAC_SPEC.md), `tests/security/rbac-route-matrix.test.js` | Done |
| Object-level access | Every BidPrep query filters on session user; foreign id returns 404 | [bid-prep-fr-4.7.md](../security/bid-prep-fr-4.7.md); E2E step "B cannot read A draft" | Done |
| Anti-automation | Fixed-window rate limits per IP/user/account | [AUTHENTICATION.md](../security/AUTHENTICATION.md), `tests/security/rate-limit.test.js` | Done, in memory per process (resets on restart) |
| Privileged accounts | `ADMIN_EMAILS`, `npm run user:promote`; admin actions audited | `scripts/promote-admin.js`, `PipelineTriggerAudit` | Admin rights still sit on the former PM's account: **to move** |
| MFA | Not implemented by the app; Google accounts get Google's MFA | | Gap (stated) |

## B. Data protection and privacy
| Topic | What we do | Evidence | Status |
|---|---|---|---|
| Data inventory | PII limited to account and company profile fields | [02-data-model-er.md](02-data-model-er.md#data-classification) | Done |
| Data minimisation | No file upload from users; AI draft uses TOR text + the owner's profile only | [bid-prep-decisions.md](../bid-prep-decisions.md) | Done |
| Retention and deletion | Kept until the user deletes; `DELETE /api/profiles` removes drafts and account; `DELETE_COMPANY_DATA` clears company data; `AcquisitionAttempt` TTL 90 days | [API_VALIDATION.md](../API_VALIDATION.md), `tests/security/bid-prep-privacy.test.js` | Done; no automatic expiry for drafts (decision recorded) |
| Passwords and secrets | Hash only; secrets only in `.env`; `.env` untracked | `models/User.js`, `.gitignore` | Done |
| Encryption in transit | HTTPS in production; HSTS; TLS to Atlas | `lib/security-policy.js` | Done in production config; demo machine runs plain http on localhost |
| Encryption at rest | Provided by Atlas / host disk; not configured by the application | | **Gap: confirm Atlas encryption at rest and host disk encryption** |
| Third-party data sharing | TOR text (public) and owner's profile sent to the AI provider for drafts | [handover.md](../handover.md) | Disclose to users; local model keeps it on the machine |
| PDPA / privacy notice | Not written | | Draft written: [06-privacy-notice.md](06-privacy-notice.md); **needs legal review, filled fields and a link in the app** |

## C. Secure development
| Topic | What we do | Evidence | Status |
|---|---|---|---|
| Branching and review | Feature branch, PR into `develop`, CI, auto-promote to `main` | README "Branches and CI", `.github/workflows/` | Done; non-author approval is a team rule and some PRs were merged without a recorded approval (see [card-delivery-status](../card-delivery-status-2026-11-16.md)) |
| Automated tests | 353 Node tests + 472 Vitest tests pass on `v1.0.0`; API contract check; production build | CI, this audit pack's run on 22 Nov | Done |
| SAST | Semgrep in CI: 0 High / 50 Warning | `docs/security/reports/sast-report.json` | Done; warnings not all triaged |
| DAST | OWASP ZAP passive baseline: 0 High / 1 Medium / 3 Low / 4 Info; unauthenticated only | `docs/security/reports/zap-dast-report.json` | Done; no authenticated scan |
| Dependencies | `npm audit` gate; one accepted dev-only advisory (picomatch, expires 2 Dec 2026) | [VULNERABILITY_MGMT.md](../security/VULNERABILITY_MGMT.md), issue #219 | Open exception, owner-approved |
| Secret scanning | Regex scan of full git history found no credentials on 22 Nov | this pack | **Gap: run gitleaks/trufflehog (not installed) and rotate anything seen in chat** |
| Threat model | STRIDE over browser/API, worker/DB, documents, AI, SMTP | [THREAT_MODEL.md](../security/THREAT_MODEL.md) | Done |
| ASVS mapping | 13 of 18 criteria covered, 5 partial | [security audit](../security-assignment-audit-2026-11-19.md) | Not a claim of full ASVS compliance |
| API contract | OpenAPI checked against routes | [api/openapi.yaml](../api/openapi.yaml), `scripts/audit-api-documentation.js` | Done |

## D. Operations and resilience
| Topic | What we do | Evidence | Status |
|---|---|---|---|
| Deployment | Docker Compose; start/stop/rollback documented; restart in 11 to 12 s | [local-deployment.md](../local-deployment.md) | Done |
| Health monitoring | `/api/health` (200 / 503), health-check workflow | `app/api/health/route.js`, `.github/workflows/health-check.yml` | Done |
| Failure handling | DB down gives 503 within 3 s, no hang; AI down gives a clear error in 20 ms; job leases recover crashed workers | [E2E 19 Nov](../e2e-test-2026-11-19.md), [connectivity](../connectivity-test-2026-11-19.md) | Done |
| Logging and audit trail | Admin trigger audit (actor, role, IP, outcome), classification overrides, auth events, ingestion and acquisition records | `PipelineTriggerAudit`, `ClassificationOverride`; audit notes in the security audit | Partial: auth-event logging inconsistent (listed gap); no central log store |
| Backup and restore | Not configured by the application | | **Gap: confirm Atlas backup policy and write a restore drill** |
| Disaster recovery / fallback | Fallback to local `mongo` with pre-processed data if the venue cannot reach Atlas | [connectivity](../connectivity-test-2026-11-19.md), [local-deployment.md](../local-deployment.md) | Written; rehearse |
| Incident response | Runbook with roles, severity, playbooks, notification and record template | [05-incident-response-runbook.md](05-incident-response-runbook.md) | Written; **roles are blank and no tabletop exercise yet** |
| Secret rotation | Procedure written; not yet executed | [handover.md](../handover.md) | **Pending execution** |
| Change management | PR history, tags (`v1.0.0`), CI | GitHub | Done |
| Capacity | Single host; AI draft 76 to 92 s on GTX 1050 Ti with the local model | [connectivity](../connectivity-test-2026-11-19.md) | Known limit |

## E. AI governance
| Topic | What we do | Evidence |
|---|---|---|
| Human oversight | Every AI draft is labelled, must be reviewed and edited; export needs every checklist item confirmed; no automatic submission | `lib/bid-prep/notices.js`, export gate |
| Traceability | Each AI result stores model, model version, prompt version and token usage (`DocumentSummary`) | `models/DocumentSummary.js` |
| Output control | Schema-validated JSON; rows without a source are dropped; unknown facts become `[to fill in: ...]` | `lib/proposal/draft.js` |
| Prompt injection | Test on a hostile TOR kept the structure and did not leak the system prompt | [connectivity report](../connectivity-test-2026-11-19.md) |
| Quality and bias | Draft quality depends on a small local model; accuracy not measured against a gold set | **Gap: no quantitative accuracy study** |

## F. Requirements traceability
Requirement IDs come from the BidPrep SRS (private Google Doc, v0.1, waiting for customer confirmation). Each FR group maps to issues and evidence in [../acceptance-bidprep-2026-11.md](../acceptance-bidprep-2026-11.md); the original SRS requirements map to the cards in [../card-delivery-status-2026-11-16.md](../card-delivery-status-2026-11-16.md). **Gap: the SRS is not in the repository and the customer's written confirmation is not attached.**

## Open items to close before an audit
1. Run a real secret scanner and rotate any credential that appeared in chat or on test machines.
2. Move admin rights to the new system owner; name the owner in [handover.md](../handover.md).
3. Confirm Atlas encryption at rest and backup; add a restore drill.
4. Fill the blanks in the incident runbook (roles, contacts), run one tabletop exercise, and get the privacy notice reviewed, completed and linked in the app.
5. Reconcile the README "known gaps" line on copied tokens after logout with ASVS V7.4.1 (DONE).
6. Attach the customer's written SRS confirmation.
7. Fix `/projects` horizontal overflow at 360 px and test in Microsoft Word.
