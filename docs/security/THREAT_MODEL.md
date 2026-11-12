# STRIDE threat model

Issue #103 asked for this file. It was not on `develop` when FR-4.7 started, so TH-1 to TH-10 record the controls already in the tree, and TH-11 onward are the BidPrep threats. Evidence is a path in this repo, not a claim that a scanner was re-run for the older rows.

| Id | STRIDE | Threat | Mitigation | Status | Evidence |
|---|---|---|---|---|---|
| TH-1 | Spoofing | Forged or legacy session | `auth_version` 2 and role-bounded scopes; bad tokens are rejected | Mitigated | `lib/auth.js`, `tests/security/scopes-cors-headers.test.js` |
| TH-2 | Spoofing | OAuth login abuse | Separate start/callback limits, state cookie, audit event | Mitigated | `lib/oauth-security.js`, `lib/auth-audit.js` |
| TH-3 | Tampering | Profile mass-assignment (`role`, other user id) | Updates use `session.sub` and an allowlist | Mitigated | `tests/integration/scoped-profile-route.integration.test.js` |
| TH-4 | Repudiation | Auth events not attributable | Auth audit log: event, time, path, client address. No tokens | Mitigated | `lib/auth-audit.js` |
| TH-5 | Information disclosure | Password hash leaked | `select: false`, JSON transform, public field allowlist | Mitigated | `models/User.js`, `docs/email-password-auth.md` |
| TH-6 | Information disclosure | Login errors distinguish accounts | One 401 message; dummy KDF for missing accounts | Mitigated | `lib/password-auth.js`, `docs/email-password-auth.md` |
| TH-7 | Denial of service | Guest and login floods | Fixed-window limits and `Retry-After` | Mitigated for one process | `lib/rate-limit.js`, `lib/oauth-security.js` |
| TH-8 | Elevation of privilege | Pipeline token used as admin | Pipeline scopes cannot call profile or admin routes | Mitigated | `tests/security/scopes-cors-headers.test.js` |
| TH-9 | Tampering | Cross-site mutation | Exact origins, no wildcard, cookie mutations need `Origin` | Mitigated | `lib/security-policy.js` |
| TH-10 | Information disclosure | Remote document URL to a private host | Scheme, credential and private-address checks | Mitigated | `lib/url-safety.js` |
| TH-11 | Tampering | Prompt injection from TOR text | Fixed instructions; TOR text is delimited data. The payload builder does not follow text inside the delimiter | Mitigated for the payload. #139 must call `buildVertexBidPayload` | `lib/bid-prep/vertex-payload.js`, `tests/security/bid-prep-privacy.test.js` |
| TH-12 | Elevation of privilege | BOLA on drafts, checklist and company data | Every query includes `session.sub`. Another user's draft is 404. Checklist ignores a user id in the query | Mitigated | `docs/security/bid-prep-fr-4.7.md`, `tests/security/bid-prep-access.test.js` |
| TH-13 | Denial of service | Vertex cost and oversized drafts | Draft creation default 5/hour, export and delete hourly caps, 128 KiB body, 50 drafts | Mitigated per process. Several instances do not share counters | `lib/bid-prep/security.js`, access test `returns 429` |
| TH-14 | Information disclosure | Company data and PDPA leakage | Delete-and-verify, Vertex allowlist, audit allowlist, generic 500 | Mitigated for collection and logs. Retention period is open until the customer answers (#143) | `lib/bid-prep/deletion.js`, `docs/security/bid-prep-fr-4.7.md` |
| TH-15 | Repudiation | AI text treated as a submitted bid | UI, API `notices` and DOCX say it is a draft and that the seller submits to e-GP. Checklist items stay `manual` | Mitigated by disclosure. A person still has to check the text | `components/ui/NoEgpSubmissionNotice.js`, `lib/bid-prep/docx.js` |
| TH-16 | Tampering | CSRF on draft and delete calls | Same origin rule as the rest of the API. Export is POST, not GET | Mitigated | `lib/route-security.js`, access test `cookie mutation without an allowed Origin` |
| TH-17 | Tampering | Formula or markup in an export | Plain-text DOCX, XML escape, leading apostrophe on formula characters. No macros | Mitigated | `tests/security/bid-prep-privacy.test.js` |
| TH-18 | Elevation of privilege | A BidPrep route submits to e-GP | No e-GP client is imported. The file and the pages tell the user to submit | Mitigated | privacy test `does not submit a bid` |

Residual: rate-limit counters are in memory, and the customer has not set a retention period.
