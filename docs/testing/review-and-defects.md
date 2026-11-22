# Independent review of the tests, and defects found

Results: [test-sheet.md](test-sheet.md) (first run 81 of 85 passed; after the fixes, full re-run 86 of 86, see section 4 and [evidence-index.md](evidence-index.md)). Plan: [test-plan.md](test-plan.md).

## 1. Independent review by `agy` (three rounds)
After the first full run, the test code, `results.json`, the sheet and the product code were given to a second reviewer (`agy`, Gemini 4 Argon, read only). Its job was to find steps that pass when the feature is broken and expected texts that are false about the product. Every claim was checked against the code before acting. The tests were corrected and run again after each round.

| Round | agy verdict | What was wrong, and what was done |
|---|---|---|
| 1 | F02 and F05 **WRONG**, the others **WEAK** | **False passes:** F02-03 passed on the alert left by step 02 (the browser blocks a short password before any alert); F05-06 only checked a static heading; F04-09 passed after a swallowed 15 s timeout; F01-05 passed on text that is already on the page. Many steps never checked the values typed. The `waitForFunction` calls were silently failing under the page CSP and being ignored. **Done:** every step rewritten with assertions that change when the feature breaks; failures are no longer swallowed; 14 new checks added (dashboard filters, analytics chart mode and JSON export, checklist "ไม่ผ่าน", past-project delete, section delete, company-data delete, theme/sidebar state, security headers) |
| 2 | F05 **WRONG**; F01, F04, F06, F07, F08 **WEAK**; F02, F03 **VALID** | F05-02 was vacuous (no summary toggle on that TOR) and was removed; F06-07 passed because of unsaved edits, not because of the checklist, so the draft is now saved first; F01-05 claimed the sort changes the URL (it does not, so the text and check were fixed); F02-06 now compares the error for a real and an unknown account (no account enumeration); F04-06/08/11 now check threshold, frequency and all 10 cleared fields; F08 now counts only real queue rows |
| 3 | all round-2 items **FIXED** or **PARTLY**; none wrong | Two expected texts that were false about the product were corrected: the AI job redirects to the editor when it completes (it is not listed first); a guest also sees the qualification and detail cards (only the profile-comparison cards need an account). F04-10 now saves and checks the API; F06-12 checks the saved title and heading; F07-04 checks for a `[to fill in: ...]` placeholder |

Two steps in F06 and F08 were corrected once more after round 3 had been read (F06-11 saves only when the page reports unsaved changes; F08 excludes the empty-state row). They were re-run alone and the evidence of F06 and F08 comes from that re-run. F02 and F03 come from the last complete run, F01, F04, F05 and F07 from the final re-run; all on `v1.0.0`, 22 Nov 2026.

### Weaknesses that remain (agy round 3, accepted)
| Step | Limit |
|---|---|
| F01-05 | Filters are checked through the URL and the sort order, not by checking that each shown card satisfies the filter |
| F01-09 | After the analytics reload the check is on page structure, not on chart numbers |
| F08-02, 03, 04 | The console labels are static; the queue filter is client-side and is checked only by "row count does not grow" |
| All UI steps | The test browser runs with `bypassCSP: true` because the page CSP blocks the polling Playwright uses. The CSP header itself is checked in F03-07, but a script or style that the CSP would block in a real browser would not be seen by these flows |
| F05 | The project-summary expand toggle and the qualification-value card of a signed-in user have no check that the numbers are right (the TORs tested have no summary toggle) |

## 2. Defects found
| ID | Flow / step | What happens | Evidence | Severity | Analysis |
|---|---|---|---|---|---|
| D1 | F07 03 and 04 | Generating an AI draft for TOR 69109232352 does not finish: the job fails with `VERTEX_TIMEOUT`; the page shows only "การสร้างร่างไม่สำเร็จ โปรดลองอีกครั้ง" followed by a sign-in link although the user is signed in | [video](../evidence/testing-2026-11-22/F07-bidprep-ai/F07-bidprep-ai.webm), worker log | High for the demo | The local model `qwen2.5:3b` takes more than the generation limit (60 s default, capped at 90 s in `lib/proposal/generate.js`). The UI replaces the specific API message with a generic one, so the user is not told it was a time-out |
| D2 | F07b 03 and 04 | For a TOR with a large scope (47 items) the job completes but saving fails: "Generated draft exceeds editor limits. sections must be a list of at most 40 items." No draft is produced | [video](../evidence/testing-2026-11-22/F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm) | High | `proposalToSections` creates one section per scope item plus about 11 others (`lib/bid-prep/draft-content.js`), while `DRAFT_LIMITS.sections` is 40 (same file, line 3). Any TOR with 30 or more scope items always fails. It was missed earlier because the API smoke test only checked that the job status was "completed" |
| D3 | F01 (observed in screenshots) | `/projects` is wider than the screen at 360 px | [screenshots](../evidence/screenshots-2026-11-22/) | Low | Layout only |

Combined effect of D1 and D2: on the demo machine, no AI draft can be produced end to end through the website with the tested TORs. The manual draft, checklist and DOCX export work (F06). Product code was not changed in this run.

## 3. Things worth knowing that are not defects
- The admin queue shows 9,223 items waiting for review and the scraper health reads "ต้องตรวจสอบ" (last run failed) on the live data (F08 screenshots).
- DOCX export needs every checklist item set to "ผ่าน" and the draft saved (F06-07, F06-10, F06-11); on a real TOR all items start as "ตรวจสอบเอง".
- The sign-in and register endpoints share a limit of 30 per 15 minutes per address, so two test runs close together hit HTTP 429 (the runner waits for `Retry-After`).

## 4. Full re-run after the fixes (22 Nov 2026, later the same day)
All 9 flows were run again on the demo machine with the fixes of PR #242, #243 and #245 (files copied to the machine by hand, not yet merged): **86 of 86 steps pass** (F01 got one new step, 14, for the layout at 360 and 768 px). Sheet: [test-sheet.md](test-sheet.md). Every function with its video and screenshot: [evidence-index.md](evidence-index.md). Evidence: [../evidence/testing-2026-11-22-full/](../evidence/testing-2026-11-22-full/). The evidence of the first run (81 of 85, with the defects) stays in [../evidence/testing-2026-11-22/](../evidence/testing-2026-11-22/).

| Defect | Fix | Re-run |
|---|---|---|
| D1 AI time-out | PR #242: no time limit on the draft call (`PROPOSAL_DRAFT_TIMEOUT_MS=0`) | F07 03: draft ready after the generation finished, no time-out |
| D2 more than 40 sections | PR #243: limit 40 to 100 | F07b 03: draft for the 47-item TOR saved |
| D4 (new) a long scope item breaks the 200-character heading limit | PR #243: heading cut at 200 characters, full text kept in the body | seen in an intermediate run ("heading must be at most 200 characters"), gone in the final run |
| D3 `/projects` too wide at 360 px | PR #245: the card badges wrap | F01 14: no page scrolls sideways at 360 or 768 px (`/projects` was 437 px wide at 360 px before the fix, measured with Playwright, and 360 after). The step was not run against the unfixed code, so the 437 px figure is the proof that it detects the defect |

**Caveat: the AI in F07 and F07b was not the local model.** The final full run (all 9 flows, 86 of 86) used the bridge installed on the demo machine itself (systemd user service `agy-bridge`, `agy` at `/snap/bin/agy`); the intermediate runs used the same bridge on the tester's laptop. It answers Ollama-style requests by calling the `agy` CLI (Gemini 3.8 Flash). The bridge is now in the repo (PR #246, [../agy-bridge.md](../agy-bridge.md)) and the machine's `.env` was changed for it (`OLLAMA_BASE_URL`; backup `~/.env.bak-before-agy`). The worker log still prints `model: qwen2.5:3b` because that is only the configured label. The quality of the draft text was not assessed, only that a draft is produced, saved and opened. The result with `qwen2.5:3b` itself and no time limit has not been measured.
