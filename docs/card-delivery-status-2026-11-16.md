# Actionable card delivery, 16 November 2026

Scope: implement the available work on PhruekCh's unfinished cards, while leaving #165 SMTP/provider setup manual. This report separates implementation from acceptance and never substitutes an automated self-review for a teammate's approval.

| Card | Delivered / existing evidence | Remaining gate |
| --- | --- | --- |
| #123 scraper failure cases | Shared allowlisted reason/retry policy, permanent failure protection, redacted diagnostics, retained prior summaries, uncertain-date safeguards, real archive-limit fixtures, queue/worker tests; [runbook](scraper-resilience-health.md) | CI, non-author review and merge of this change |
| #124 scraper health | New durable acquisitionattempts collection, protected health metrics on existing status API, per-run/source counters, degraded signals, bounded read-only benchmark, [dated feed evidence](evidence/acquisition-health/feed-benchmark-2026-11-16.json) | Representative ≥20-project live cohort, team acceptance of proposed 90% target, three full days of intended scheduled execution after deployment, approval/merge |
| #130 presentation/video | [10-slide editable English deck](presentation/moneytamngan-demo-en-10min.pptx), source notes, [600-second allocation and demo script](presentation/demo-script-en-10min.md), recording/privacy/rehearsal checklist | Confirm organizer time limit, record deployed-system video with narration, two storage destinations, whole-team rehearsal and independent review |
| #78 admin trigger | [Merged PR #162](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/162), [control runbook](admin-pipeline-control.md), [real isolated HTTP evidence](evidence/admin-pipeline-http.json), existing auth/concurrency/recovery tests. Owner's editable STRIDE copy was updated and verified earlier | Recorded teammate approval and owner/team acceptance; no self-approval generated |
| #136 company details | [Merged PR #166](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/166), [profile report](company-profile.md), real isolated [HTTP evidence](evidence/company-profile/http.json) and desktop/mobile screenshots | Recorded non-author approval |
| #140 draft editor | [Merged PR #168](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/168), [implementation report](bid-draft-editor-export-report.md), [real Atlas/browser BOLA/concurrency evidence](evidence/bid-drafts/http.json) | Recorded non-author approval |
| #141 DOCX export | Same merged PR and report, real file/owner tests, fictitious [sample DOCX](evidence/bid-drafts/sample.docx). New native Chrome Google Docs check opened the sample on 16 November: first-page Thai text and checklist columns displayed correctly | Native screenshot saving timed out, so no new screenshot file is claimed. Microsoft Word check, full-document native-viewer evidence and teammate approval remain pending |
| #192 RBAC spec / #193 validation dictionary | [PR #196](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/196): 58-route matrix, field dictionary, tests and green CI | PR is still open at preparation time. Requires non-author approval, merge, then shared ASVS sheet DONE evidence. Do not mark the sheet DONE before merge |
| #39 email dispatcher | [Draft PR #164](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/164): SMTP/Resend integration, persistent deduplication/digest/retry behavior and green CI | Actual inbox receipt/screenshot depends on manual #165. Current-score implementation follows owner's instruction; formal #96 dependency wording still needs team reconciliation. Review/merge pending |
| #165 SMTP provider | Deliberately untouched | Manual provider/account/domain/credential ownership and inbox test |

## Google Docs sample review

The fictitious sample was uploaded into the owner's existing Drive account and opened in Google Docs' DOCX mode. The page showed the Thai title, draft/non-submission notices and requirement/status/reason/page columns without missing Thai glyph boxes in the observed first-page view. The file remains private to its owner; no sharing permissions changed.

Private owner copy: https://docs.google.com/document/d/1Se38rpyC0shx9-fKLRuUUe0bSAIuR8S_/edit

This is an observed Google Docs check, not a Microsoft Word test. The native screenshot-save tool timed out. No screenshot artifact or full-document pass is invented. Use the recording checklist to capture and redact the remaining evidence before closing #141.

## Current limitations

The first bounded feed-only benchmark discovered 77 records and one software candidate; its announcement was verified open but no TOR was obtained without browser fallback. Two B0 feeds timed out. It cannot establish a 20-project success rate. [Browser-enabled evidence](evidence/acquisition-health/browser-benchmark-2026-11-16.json) retrieved the official ZIP and selected TOR PDF for the one verified-open software candidate, 69109037016. One success is not the required representative 20-project measurement.

The isolated Atlas health fixture initially failed with MongooseServerSelectionError. After the owner restored the IP allowlist, the test passed and was repeated after the duplicate-log correction. It verified real MongoDB idempotency, benchmark exclusion, per-run metrics, the exact 90% boundary, five-failure degradation and the 90-day TTL. The disposable test databases were removed. [Sanitized Atlas evidence](evidence/acquisition-health/atlas-telemetry-2026-11-16.json) contains synthetic telemetry only, not a production reliability claim.

No task is marked Done merely because its issue is closed or its board status changed. In particular, #136/#140/#141/#192/#193 were Closed while their board cards were In review in the audit snapshot. Closing an issue does not merge PR #196 or create approval evidence. No board, issue status, acceptance checkbox or ASVS status was changed by this implementation.

Final local regression: 311 Node tests and 342 Vitest tests passed (653 total). Production build and OpenAPI lint passed; nine existing lint warnings remain. PR #198 carries current CI/review evidence.
