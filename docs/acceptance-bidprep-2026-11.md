# BidPrep acceptance results (#144)

Evidence is from the 19 Nov run on the demo machine ([E2E report](e2e-test-2026-11-19.md), 32 of 32 API steps) and the existing reports. "Not verified" means no evidence exists yet; nothing is marked passed without it. Sub-requirement numbers (FR-4.x.y) are not restated here because the SRS is a private Google Doc; rows use the epic's FR groups.

| Requirement | Result | Evidence |
|---|---|---|
| FR-4.1 company details (edit, read) | Pass | E2E "Edit company profile", "Read profile"; [company-profile.md](company-profile.md) |
| FR-4.2 checklist | Pass (1 TOR) | E2E "Checklist (A)": 47 items; guest gets 401 |
| FR-4.3 sourced draft | Partial | Draft created and AI job completed (76 s). 2 of 3 real TORs timed out at 90 s; the 90 s criterion is **not met** ([connectivity report](connectivity-test-2026-11-19.md)) |
| FR-4.4.1 DOCX export | Pass | E2E: valid zip, 66 KB; [sample.docx](evidence/bid-drafts/sample.docx). Microsoft Word check not done |
| FR-4.7 access control and privacy | Pass | E2E: B gets 404 on A's draft, export, AI job and list; guests 401; user 403 on admin; [bid-prep-fr-4.7.md](security/bid-prep-fr-4.7.md) |
| Vertex/AI down: checklist works, draft shows a message | Pass | `VERTEX_UNAVAILABLE` in 20 ms, no hang |
| 2 accounts, full flow | Pass | E2E steps above |
| 3 different TORs (clear, ambiguous, incomplete) | Not verified | Only 1 TOR in the E2E; 3 TORs measured for drafts only |
| Google sign-in, match email, admin pipeline run | Not verified | listed under "Not covered" in the E2E report |
| Screenshots at 360/768/1280 px | Not verified | |

## Defects
| Defect | Status |
|---|---|
| Draft too slow on local model | Known limitation (see handover) |
| `/api/tors` 500 instead of 503 when DB is down | Known limitation |
| Secure cookie fails over plain http by IP | Documented workaround |

No blocker is open; the items marked "Not verified" need a run on the demo machine and a teammate's sign-off.
