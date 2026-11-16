# Scraper resilience and health

Implementation for #123 and the application portion of #124. It retains government-source admission, link-only document storage, OCR/Vertex history, existing routes and queue semantics. SMTP setup (#165) is intentionally unchanged.

## Failure policy and regression evidence

The shared `lib/scrape-failure.js` maps untrusted upstream errors to an allowlisted code and safe explanation. Logs and stored diagnostic text do not echo source URLs, encrypted/token-bearing queries, emails or arbitrary provider messages. Canonical document/source URLs remain in their dedicated provenance fields.

| Failure case | Code / retry policy | Proving test |
| --- | --- | --- |
| Bot challenge / denied access | anti_bot_blocked; bounded retry | `scraper-failure-policy`: Cloudflare fixture; `procurement-eligibility`: rendered challenge never grants open status |
| Timeout / network outage | temporary_timeout / download_failed; bounded retry | `scraper-failure-policy`; `tender-acquisition`: backoff, deadline and circuit breaker |
| Unresolvable encrypted detail URL | resolver_failed; manual review | `scraper-failure-policy`; `tender-acquisition`: no official detail link stops retrying |
| Unsupported official layout | unsupported_layout; manual review | `scraper-failure-policy`; existing `pipeline`: document layout detector |
| Corrupt ZIP / no usable PDF | archive_invalid; manual review | `scraper-failure-policy`: actual corrupt/no-PDF ZIPs through archive reader |
| Entry, per-PDF, total archive or download size limit | file_too_large; manual review | `scraper-failure-policy`: actual entry/per-file/total-limit ZIP fixtures and download-limit classifier |
| Encrypted/corrupt unreadable PDF | unreadable_pdf; manual review, no Vertex call | `ocr-pipeline`: corrupt PDF fixture |
| OCR tool/language failure | text_extraction_failed; bounded retry | `ocr-pipeline`: unavailable OCR; `pipeline-stress`: crashed OCR |
| Conflicting or uncertain bidding evidence | no authoritative submission window; unknown/review | `announcement-schedule`: ambiguous time fixture; `tor-response`: prior future deadline cannot imply open after needs_review |
| Prior verified summary exists, new acquisition fails | prior summary pointers and findings retained | `ocr-pipeline`: permanent known-URL acquisition failure does not unset or replace summary pointer |
| Repeated job failures | terminal at max_attempts, active key released; permanent errors stop immediately | `scraper-failure-policy`: actual `failJob` updates |
| Untrusted exception includes URL/token/email | safe allowlisted explanation only | `scraper-failure-policy` and `acquisition-health` redaction tests |

The worker's prior `retryable || candidates.length > 0` condition incorrectly re-enabled retries for a permanent failure whenever a URL existed. It now respects an explicit false flag. Empty/unpublished documents remain metadata-only; permanent malformed documents go to review. Transient failures use the existing exponential queue delay (30s increasing to a 1h cap, default three attempts). Browser acquisition retains its bounded retries and shared breaker. A failed item does not abort the following item. `failJob` also honors an explicit permanent error.

Uncertain parsed schedule candidates are retained in `announcement_schedule.evidence`, while authoritative bidding/submission fields remain null. TOR views, open/closed filters and analytics treat a needs-review announcement as unknown, even if an older future deadline exists. This deliberately tightens unsafe previous display behavior.

## Durable acquisition health

`GET /api/admin/pipeline/status` adds `acquisitionHealth`, retaining `status`, `run` and `dbStats`. Both Proxy and the handler still require an admin principal with admin:read. Telemetry failure returns `acquisitionHealth.status = unavailable` without discarding the runner state or acquired documents. Public `/api/health` continues to report database liveness only.

The `acquisitionattempts` collection stores attempt_key (unique), project_id, optional run_id, source (admin/worker/benchmark), success/failed/skipped, reason_code, route, timing and duration. No source URL, document content or exception body is stored here. The main admin pipeline and worker record new acquisition attempts. Cached files, already paired projects, and eligibility skips do not inflate the success denominator. Legacy standalone scrape commands are not a complete source of this telemetry. Benchmark probes are excluded from the production query.

Health summarizes the latest 100 production events:

- `successRate = succeeded / attempted`, excluding skipped events; bySource and byRun show counts within that same sample.
- Under 20 attempts: insufficient_data, not a reliability guarantee.
- Proposed target: at least 90% on 20 or more attempts. **Team acceptance of this target is still pending.**
- Five consecutive failed acquisition events, a sampled rate below target with sufficient data, or no new attempt in 24 hours produces degraded status. Each failed event also emits an error-level metadata-only signal.
- No events: insufficient_data. Last-success and consecutive-failure values refer to this bounded sample, not all-time history. No-attempt staleness is visible once events exist; a fresh installation is not falsely reported healthy.
- Telemetry expires after 90 days through a TTL index. This does not delete PDF/OCR/summary history. Run `npm run db:ensure-indexes` once after deployment to ensure the new indexes.

The new schema is additive. Existing project error-code enums gain file_too_large, unreadable_pdf and text_extraction_failed; jobs gain error_code. Pipeline status and acquisition metrics measure different things: completed runner status does not mean every government document succeeded, and successful acquisition does not prove OCR/Vertex accuracy.

## Operations and recovery

1. Read authenticated `/api/admin/pipeline/status`; inspect acquisitionHealth alongside run.summary.errors and the project/job reason code. Never paste session tokens into evidence.
2. For transient upstream outages, wait for bounded retries and inspect the next run. Do not repeatedly reset a live lease or bypass a human challenge.
3. For archive limits, inspect the actual official archive and review configured limits before any deliberate increase. Do not disable limits to clear a failure.
4. For unreadable PDF, check whether the official file is encrypted/corrupt and obtain a usable replacement. For OCR-tool errors, verify pdftotext/Tesseract and Thai language files, then intentionally retry.
5. Use the dry-run planner and explicit apply/retry options in [processing-recovery.md](processing-recovery.md). Review/terminal projects are not blindly scheduled forever. A worker must remain running to execute queued work.
6. A restart can recover an expired admin lease through the existing controller. Telemetry remains in Mongo independently from the singleton runner status.

## Read-only live benchmark

```sh
npm run benchmark:acquisition -- --limit=20 --scan=100 --depts=1507,2102,0703,0804,0806 --output=/tmp/acquisition.json
npm run benchmark:acquisition -- --limit=20 --scan=100 --browser --output=/tmp/acquisition-browser.json
```

The benchmark uses built-in software keyword classification and official announcement eligibility before new TOR acquisition, respects three-second spacing, caps HTTP requests at 15 seconds, disables long discovery backoff and applies a ten-minute stop signal (an in-flight browser operation can finish its bounded deadline). It cleans its temporary PDFs/ZIPs and browser in finally. It does not connect to MongoDB, persist project data, call Vertex or send email. No CAPTCHA is bypassed. Requested 20 is a cap, not proof of 20 eligible projects. Report sample size, skipped eligibility, route configuration and discovery failures with every rate.

[Feed-only result, 16 November 2026](evidence/acquisition-health/feed-benchmark-2026-11-16.json): 77 discovered projects, one software candidate, one verified-open announcement, no TOR obtained with browser disabled, two B0 discovery timeouts. This is insufficient for a 20-project acceptance cohort and cannot establish a 90% rate. [Browser-enabled result](evidence/acquisition-health/browser-benchmark-2026-11-16.json): the same one verified-open software candidate (69109037016) yielded an official e-Bidding ZIP and selected TOR PDF through browser fallback. This is 1/1 in a tiny selected cohort, not a demonstrated 90% production success rate. Temporary files were removed by the benchmark.

The latest scheduled-ingestion CI successes are metadata-only evidence. They do not prove a successful scrape or three executions on every Bangkok day. #124 still needs a team-approved target, a representative live cohort, and evidence that the intended schedule executed consistently for three full days after deployment.

## Test commands

```sh
npm test
npm run test:vitest
npm run build
node scripts/test-acquisition-health-atlas.js /tmp/health-atlas.json
```

The Atlas test creates only an isolated mtn_health_test_* database, verifies persistent idempotency, benchmark exclusion, per-run counters, the exact rate boundary, degradation and TTL, then removes that fixture. It never writes to the main project database. If Atlas cannot connect, restore the machine IP allowlist before rerunning; do not mark persistence acceptance passed based on a mock.

## Remaining acceptance

Application work can be reviewed now. Non-author approval and merge remain required. The live 20-project target, post-deployment three-day observation and final Atlas verification depend on real infrastructure and cannot be fabricated. #165 remains manual. The delivery report tracks other card acceptance separately.
