# OCR and Vertex verification — 8 September 2026

## Outcome

The application builds, all 38 automated tests pass, and live Vertex calls succeed on real Thai procurement text. After the user added the client IP to Atlas, the real worker, MongoDB persistence, API status, and summary-reuse checks also passed. This is not a complete production acceptance pass: forced OCR introduced a material numerical error that the existing confidence checks did not catch.

## Verification matrix

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Automated suite | PASS | 38 tests; includes four new tests for chunk aggregation, completed/review persistence, and Vertex-failure state |
| Production build | PASS | All 16 routes/pages generated successfully |
| Whitespace check | PASS | `git diff --check` |
| Four-page embedded-text extraction | PASS | Four pages, zero OCR pages |
| Four-page forced-OCR cache | PASS | Four OCR pages; repeated run retained page timestamp and text hash |
| Live Vertex with forced-OCR text | TRANSPORT/SCHEMA PASS; QUALITY ISSUE | Thai summary and page references returned; experience requirement misreported |
| Live Vertex with embedded text | PASS on sampled requirement | Correctly retained the 80-million-baht experience requirement on page 2 |
| Native OCR from a fresh temporary PDF copy | PASS for execution/reproducibility | All four pages OCRed; output text hash matched the earlier forced-OCR artifact |
| MongoDB DNS | PASS | System and public resolvers returned three SRV records |
| MongoDB connection | PASS after IP update | Direct connection and database ping succeeded; earlier TLS failures resolved |
| Local health / project / OCR-status / job-status APIs | PASS | Production server tested against the isolated test database |
| Live queue and database enrichment | PASS | Real worker completed one queued project and persisted summary/evidence |
| Live API requeue and summary reuse | PASS | Second worker run returned reused=true; AI attempts and processed_at unchanged |
| Long-running lease renewal | NOT VERIFIED under load | Worker ran successfully; no deliberate lease-loss or long-running renewal scenario |
| GCS persistence | NOT RUN | Current configuration uses local storage |
| Full 145-page final-code OCR and Vertex run | NOT RUN in this verification | Earlier 145-page OCR artifact predates final spacing/fingerprint changes |

## Live Vertex evidence

Source: saved four-page announcement PDF for project `68019088742`.

- Forced OCR: 2,752 input tokens and 1,729 reported output tokens; model confidence 0.90.
- Embedded text: 2,597 input tokens and 1,791 reported output tokens; model confidence 0.95.
- Both calls used `gemini-2.5-flash` and prompt version `tor-thai-text-v2`.
- These token counts are response metadata, not a complete billing calculation.

Both initial requests returned parseable schema-valid responses with references to supplied pages. They were direct extractor tests. A subsequent isolated database-backed worker test made another live request, reporting 2,597 input and 1,868 output tokens, and persisted its result successfully. No existing production project was modified.

### Follow-up after the Atlas IP update

The test used a unique database (`moneytamngan_ocr_test_107535e36612`) and one temporary project. It verified the actual `scripts/worker.js` process, not an injected mock, against the existing four-page PDF with embedded-text extraction and a real Vertex request.

Checks passed for queued-job completion, four extracted pages, stored text URI/hash, Thai summary, evidence page ranges, preserved budget and manual classification, and production API responses. Requeueing through the API and running the worker again reused the saved summary without increasing AI attempts or changing its processed timestamp.

The temporary project and jobs were deleted afterward. The isolated test database may retain empty collections/indexes. The test server was stopped. A machine-readable result is stored locally at `storage/test-results/ocr-worker-live-2026-09-08.json` (Git-ignored).

## Important accuracy finding

The embedded text on page 2 says:

> ๘๐,๐๐๐,๐๐๐.๐๐ บาท (แปดสิบล้านบาทถ้วน)

The forced-OCR-to-Vertex output reported 50,000,000 baht for this requirement. The normal embedded-text-to-Vertex output correctly retained 80,000,000 baht.

The forced-OCR artifact had `needsReview: false`, and Vertex assigned confidence 0.90. Confidence therefore cannot establish the correctness of critical amounts. Existing page-membership validation also cannot detect this error: a fact can cite the right page while containing a wrong number.

Do not enable `OCR_FORCE=true` as a default workaround. Prefer embedded text where usable. Scanned-only PDFs still require improved number verification, source-page review, and an OCR benchmark before automated acceptance of budgets, dates, experience thresholds, and qualification clauses.

## Database diagnosis

The local production server started at `127.0.0.1:3000` and was stopped after the checks. The health endpoint also depends on MongoDB, so its timeout does not independently indicate an application-server failure.

A direct connection with bounded connection/server-selection timeouts reproduced the failure. DNS resolution succeeded; all three Atlas nodes failed with:

```text
tlsv1 alert internal error
SSL alert number 80
```

These were the initial failure symptoms. After the user added the client IP to Atlas, connectivity and the follow-up integration tests succeeded. The assistant did not change network access rules.

## Additional regression coverage added

1. Multi-chunk Vertex results preserve distinct evidence, deduplicate exact duplicates, concatenate summaries, use the lowest confidence, and sum usage.
2. Successful AI extraction saves enrichment, evidence, hashes, and usage without overwriting authoritative budget metadata.
3. OCR review flags route otherwise high-confidence AI output to `review_required`.
4. Vertex failures preserve completed OCR while recording a retryable processing state.

These tests use mocked cloud/database boundaries. They do not substitute for a live database-backed worker test.

## Remaining acceptance checks

1. Atlas connectivity, isolated queue/worker processing, API persistence, and repeat-run reuse are now verified. Still test real transient failure recovery and long-running lease ownership under deployment conditions.
2. Correctly identify or flag OCR numerical errors; benchmark representative Thai pages against manually checked source text.
3. Rerun the final OCR code and summarization on the full 145-page TOR, checking cross-chunk repetition and evidence.
4. Verify GCS and host-restart recovery if deploying with cloud storage.

Only regression tests and this report were changed in the repository during verification. Production OCR/Vertex behaviour and credentials were not modified. Temporary database test records were created and removed as described above. Tests/report remain uncommitted pending delivery instructions.
