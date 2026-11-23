# TOR pipeline audit — 25 October 2026 (Asia/Bangkok)

Branch tested: `develop-api_database`, commit `00697cb`. No application-code fixes, production-record changes, email delivery or bulk worker run were performed. A bounded test used real OCR, Vertex and Atlas in a separate database. Existing archived input was not represented as a currently open tender.

## Outcome by stage

| Stage | Result | Evidence and limit |
| --- | --- | --- |
| Automated backend suite | PASS | 235 tests, zero failed/skipped |
| API/UI/security/contract suite | PASS | 172 tests across 27 files |
| Production build | PASS | Compilation, TypeScript and route generation succeeded |
| Atlas production connectivity | PASS, read-only | `moneytamngan`: 2,250 projects; 2,019 completed jobs, six failed, zero queued/running at snapshot |
| Government contract API | Responding | Keyword `ระบบสารสนเทศ`, limit five: fiscal year 2570 returned zero; 2569 reported total 1,920 and returned five |
| Sampled API admission | Correctly refused | All five sampled records had contract/award evidence; none was admitted as a fresh open bid |
| Current RSS discovery | Responding, no selected match | D0 feeds: 1507=1, 0703=20, 2102=20, 0906=5 items. No confirmed software matches under built-in classifier rules. This small sample is not a recall/accuracy measurement |
| Official HTML identity probe | UNRESOLVED | Project 69099617982 returned `unknown`: official page did not identify the requested project. HTTP-only probe, rendered fallback disabled; this does not establish that anti-bot is the cause |
| Fresh open TOR/ZIP acquisition | NOT DEMONSTRATED | No qualifying fresh project was found in the bounded sample. Existing offline suites exercise ZIP extraction; no live ZIP success is claimed |
| Real OCR → Vertex → normalized storage | PASS, controlled archived input | One scanned page through the existing live-test harness, actual Tesseract and actual Gemini Flash; fiscal year 2565 and a Thai summary persisted |
| Retry, history and rollback | PASS, isolated Atlas | Same-input repeat reused OCR/summary; transaction rollback preserved previous state; changing PDF bytes at the same URL created a second document version with one current primary |
| Worker fiscal refresh | PASS, isolated Atlas | First refresh wrote one analysis/cache; second refresh had `changed:false`, still one fiscal analysis and one summary, no additional Vertex request |
| Stored announcement schedules | PASS, read-only production text | 69099617982: 22 October 2026, 09:00–12:00; 69099439550: 21 October 2026, 09:00–12:00, Asia/Bangkok; no parser warnings. Existing stored text only, no new closed-tender downloads |
| Actual localhost HTTP | PASS with test-only session configuration | TOR/project/status/review/admin-queue GETs returned 200; anonymous review/admin queue returned 401; TOR/dashboard/analytics HTML routes returned 200. HTTP success is not visual browser QA |

There was **not** a single uninterrupted fresh government-discovery-to-summary success. Fresh discovery/admission and downstream processing were tested separately. The downstream acquisition/eligibility adapter was explicitly a fixture; actual OCR, cloud summarization and MongoDB persistence were real.

## Test output and where to inspect it

Retained isolated database: `moneytamngan_e2e_oct25_mi1gPA`.

- `projects`: `{ project_id: "66089621472" }`
- `documentsummaries`: `{ _id: ObjectId("6adced434ea71332d627dde6") }`
- `fiscalbudgetanalyses`: `{ _id: ObjectId("6adced904ea71332d627ddfd") }`
- `extractionruns` / `documentpages`: filter by `project_id: "66089621472"`.

The main fixture retained one document, one extraction run, one page and one summary. A separate `version-probe` project retained two document versions solely for the history check. Source document URLs in this test are fixture URLs, not usable government download links. Page 1 in the test corresponds to page 20 of the archived original, not page 1 of its complete procurement package.

Compact output:

```json
{
  "projectId": "66089621472",
  "processingStatus": "review_required",
  "fiscalBudget": {
    "year": 2565,
    "status": "found",
    "method": "regex+llm"
  },
  "techStack": ["Enterprise Resource Planning (ERP)"],
  "retryCreatedDuplicateSummary": false,
  "fiscalRetryChanged": false
}
```

The generated Thai summary covers penalties, ERP and hardware warranties, advance payment and the 2565 budget clause. Review status is intentional: OCR quality/financial warnings and missing announcement coverage were preserved rather than hiding uncertainty. This one-page example does not establish whole-document OCR accuracy or risk-detection recall.

Execution artifacts: `/private/tmp/mtn-oct25-pipeline.mi1gPA/live-e2e.log` and its source-page preview. Test server was stopped after checks. The test database was retained for inspection, not merged into application data.

## Improvements, in recommended order

### 1. Fix normalized-summary reads in notifications — confirmed high-impact mismatch

`scripts/worker.js` reads a raw project and passes it directly to notifications. `calculateSkillMatchScore` expects `extracted_data.tech_stack` or `techStack`, and treats missing requirements as neutral 100%. Normalized projects keep these requirements in the linked summary.

An isolated real-record probe with a Python-only profile produced **raw score 100 versus hydrated score 0** for an ERP requirement. No email was sent. The daily digest also selects legacy skill fields, potentially omitting normalized-only projects.

Recommendation: hydrate current document/run/summary provenance before notification matching; update digest selection for normalized summaries. Treat missing/unreadable requirements as unknown for email eligibility rather than interpreting absence as a demonstrated match. Add tests using genuinely normalized-only records, not just legacy embedded test fixtures.

### 2. Unify fiscal reads across detail, analytics and exports — confirmed live mismatch

`lib/analytics/artifact-stages.js` derives `_fiscal` only from the primary TOR summary. It ignores the new current combined fiscal cache and announcement-derived evidence.

Read-only production comparison:

| Project | Stored fiscal year | Detail fiscal year | Analytics document-year input |
| --- | --- | --- | --- |
| 69099617982 | 2570 | 2570 | null |
| 69099439550 | 2569 | 2569 | null |
| 66089621472 | 2565 | 2565 | 2565 |
| 66089621504 | 2565 | 2565 | 2565 |

Analytics can substitute a bidding-close estimate, but that is not the document's funding-year evidence and can differ. Recommendation: share a source-provenance/cache-version-aware fiscal read policy across detail, filters, analytics and exports. Test announcement-only, combined conflicting years, stale caches and October rollover.

### 3. Improve fresh discovery instead of repeatedly draining historical contract metadata

The ingestion endpoint defaults to only `currentThaiFiscalYear()`. The sampled current-year request was empty, while the previous year had metadata but all sampled records were already awarded. This is a discovery coverage issue, not proof of broken OCR or Vertex.

Recommendation: use current RSS announcements as the primary open-tender discovery source, contract data for enrichment, and current plus previous fiscal years as bounded API fallback. Deduplicate IDs, retain continuation cursors, and always verify the actual bidding deadline. Do not reject a still-open tender merely because its funding year is older. Expose discovery/verification/download/OCR/AI/storage counts separately; completed queue jobs are not completed summaries.

### 4. Preserve reviewer metadata and guard closed acquisition ordering — code-review findings

`processProject` replaces the entire classification object, retaining status/confidence/method/reason but omitting the newly introduced `tags`, `reviewed_by` and `reviewed_at`. Preserve admin audit fields on manual overrides and add a regression test.

It also calls `syncProjectAnnouncement` before the ordinary acquisition admission check and before durable TOR-text resume. That function can download a linked announcement without first rejecting an already-known closed state. The TOR acquisition gate is present, but the no-new-downloads-for-ended-projects policy is not uniformly placed around announcement refresh. Add an early known-closed guard while preserving analysis of already stored text; allow a narrowly bounded announcement eligibility check only when status is genuinely unknown. These ordering risks were identified from code, not exercised by downloading closed production announcements.

### 5. Close deployment/observability gaps

The local `.env` lacks `JWT_SECRET`: signing an admin session initially failed. Isolated HTTP testing used a temporary test-only secret supplied to the process, without changing `.env`. Configure a strong deployment secret before relying on login/admin behavior; add a startup readiness/config check without logging secrets.

Production currently has no queued/running work, but two projects remain `ai_pending`, five failed, four metadata-only, one review-required and 85 marked closed among 97 software-marked projects. A service supervisor/readiness view should distinguish an idle worker from a stopped worker, and show why eligible stored text is not progressing. Do not silently retry terminal failures or start paid bulk Vertex analysis based solely on an empty queue.

The prior dependency install reported nine advisories. Security triage remains necessary; no automatic dependency upgrades were made in this audit.

## Recommended next change

Fix notification and fiscal read-model consistency first, with normalized-only integration fixtures. Then add rollover-safe multi-source discovery and the reviewer/closed-acquisition guards. OCR-engine replacement should wait for representative human-labeled document accuracy measurements: the successful page test does not justify claiming production-wide accuracy.
