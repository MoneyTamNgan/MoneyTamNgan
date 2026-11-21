# BidPrep acceptance results (#144)

Evidence is from the 19 Nov run on the demo machine ([E2E report](e2e-test-2026-11-19.md), 32 of 32 API steps) and the existing reports. "Not verified" means no evidence exists yet; nothing is marked passed without it. Sub-requirement numbers (FR-4.x.y) are not restated here because the SRS is a private Google Doc; rows use the epic's FR groups.

| Requirement | Result | Evidence |
|---|---|---|
| FR-4.1 company details (edit, read) | Pass | E2E "Edit company profile", "Read profile"; [company-profile.md](company-profile.md) |
| FR-4.2 checklist | Pass (1 TOR) | E2E "Checklist (A)": 47 items; guest gets 401 |
| FR-4.3 sourced draft | Partial | Draft created and AI job completed (76 s). 2 of 3 real TORs timed out at 90 s; the 90 s criterion is **not met** ([connectivity report](connectivity-test-2026-11-19.md)) |
| FR-4.4.1 DOCX export | Pass (after checklist confirmed) | 22 Nov E2E: 409 until all items pass, then valid zip 64 KB; [sample.docx](evidence/bid-drafts/sample.docx). Microsoft Word check not done |
| FR-4.7 access control and privacy | Pass | E2E: B gets 404 on A's draft, export, AI job and list; guests 401; user 403 on admin; [bid-prep-fr-4.7.md](security/bid-prep-fr-4.7.md) |
| Vertex/AI down: checklist works, draft shows a message | Pass | `VERTEX_UNAVAILABLE` in 20 ms, no hang |
| 2 accounts, full flow | Pass | E2E steps above |
| 3 different TORs (clear, ambiguous, incomplete) | Partial | 25 TORs read on 22 Nov: 5 with checklists (all `manual` with an empty profile), 20 return a clean 409 (incomplete data). A full profile on 6 TORs still gives all `manual` (no automatic pass/fail triggered); covered by unit tests only ([report](e2e-test-2026-11-22.md)) |
| Google sign-in, match email, admin pipeline run | Not verified | listed under "Not covered" in the E2E report |
| Screenshots at 360/768/1280 px | Pass with 1 defect | 18 screenshots; `/projects` overflows horizontally at 360 px ([evidence](evidence/screenshots-2026-11-22/)) |

## Defects
| Defect | Status |
|---|---|
| Draft too slow on local model | Known limitation (see handover) |
| `/api/tors` 500 instead of 503 when DB is down | Known limitation |
| `/projects` wider than the screen at 360 px | Open, not a blocker |
| Export needs every checklist item confirmed (all start `manual`) | By design; confirm items before the demo |
| Secure cookie fails over plain http by IP | Documented workaround |

No blocker is open; the items marked "Not verified" need a run on the demo machine and a teammate's sign-off.
