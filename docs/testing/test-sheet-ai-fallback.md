# UI test sheet, `v1.0.0`, 22 Nov 2026

Plan: [test-plan.md](test-plan.md). Every flow is one recorded video; the time column is the position in that video. Results come from `results.json` written by the test run; nothing was edited by hand.

## Summary

| Flow | Title | Steps | Pass | Fail | Video | Length |
|---|---|---|---|---|---|---|
| F07-bidprep-ai | BidPrep: generate an AI draft (queued job, local model), TOR with a small scope | 5 | 5 | 0 | [video](../evidence/ai-fallback-2026-11-22/F07-bidprep-ai/F07-bidprep-ai.webm) | 02:20 |
| F07b-bidprep-ai-large-tor | BidPrep: generate an AI draft for a TOR with a large scope (47 items) | 5 | 5 | 0 | [video](../evidence/ai-fallback-2026-11-22/F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm) | 01:30 |

**Total: 10 passed, 0 failed of 10 steps.**

## F07-bidprep-ai: BidPrep: generate an AI draft (queued job, local model), TOR with a small scope

Video: [F07-bidprep-ai/F07-bidprep-ai.webm](../evidence/ai-fallback-2026-11-22/F07-bidprep-ai/F07-bidprep-ai.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | The page loads with the AI warning | as expected | ✅ PASS | 00:00 | [img](../evidence/ai-fallback-2026-11-22/F07-bidprep-ai/01-01.png) |
| 02 | Enter a TOR id and click "สร้างร่างด้วย AI" | A job is queued (HTTP 202) and the page shows "กำลังรอผล AI" with a job number | queued -> 202 | ✅ PASS | 00:03 | [img](../evidence/ai-fallback-2026-11-22/F07-bidprep-ai/02-02.png) |
| 03 | Wait for the job to finish (up to 5.5 minutes) | When the job completes the page opens the saved draft (or lists it under "ร่างที่บันทึกไว้"); if the job fails, the page must show why | ready after 123 s | ✅ PASS | 00:05 | [img](../evidence/ai-fallback-2026-11-22/F07-bidprep-ai/03-03.png) |
| 04 | Open the AI draft | The editor shows at least 3 sections, source lists and at least one "[to fill in: ...]" placeholder | as expected | ✅ PASS | 02:09 | [img](../evidence/ai-fallback-2026-11-22/F07-bidprep-ai/04-04.png) |
| 05 | Cleanup: delete the test account and its drafts | HTTP 200 | as expected | ✅ PASS | 02:10 | [img](../evidence/ai-fallback-2026-11-22/F07-bidprep-ai/05-05.png) |

## F07b-bidprep-ai-large-tor: BidPrep: generate an AI draft for a TOR with a large scope (47 items)

Video: [F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm](../evidence/ai-fallback-2026-11-22/F07b-bidprep-ai-large-tor/F07b-bidprep-ai-large-tor.webm)

| Step | Action | Expected | Actual | Result | Video time | Screenshot |
|---|---|---|---|---|---|---|
| 01 | Sign in, fill a profile and open "เตรียมข้อเสนอ" | The page loads with the AI warning | as expected | ✅ PASS | 00:00 | [img](../evidence/ai-fallback-2026-11-22/F07b-bidprep-ai-large-tor/01-01.png) |
| 02 | Enter a TOR id and click "สร้างร่างด้วย AI" | A job is queued (HTTP 202) and the page shows "กำลังรอผล AI" with a job number | queued -> 202 | ✅ PASS | 00:02 | [img](../evidence/ai-fallback-2026-11-22/F07b-bidprep-ai-large-tor/02-02.png) |
| 03 | Wait for the job to finish (up to 5.5 minutes) | When the job completes the page opens the saved draft (or lists it under "ร่างที่บันทึกไว้"); if the job fails, the page must show why | ready after 78 s | ✅ PASS | 00:04 | [img](../evidence/ai-fallback-2026-11-22/F07b-bidprep-ai-large-tor/03-03.png) |
| 04 | Open the AI draft | The editor shows at least 3 sections, source lists and at least one "[to fill in: ...]" placeholder | as expected | ✅ PASS | 01:23 | [img](../evidence/ai-fallback-2026-11-22/F07b-bidprep-ai-large-tor/04-04.png) |
| 05 | Cleanup: delete the test account and its drafts | HTTP 200 | as expected | ✅ PASS | 01:24 | [img](../evidence/ai-fallback-2026-11-22/F07b-bidprep-ai-large-tor/05-05.png) |

## Defects found

None in this run.
