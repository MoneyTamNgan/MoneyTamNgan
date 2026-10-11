# Pipeline consistency fixes and test results

Branch: `develop-api_database`. Implementation/testing did not merge branches, delete production records, or backfill production data. Changes are subsequently being committed in focused chunks and pushed at the user's request; `develop` is not being merged or edited.

## What changed

1. Discovery is asynchronous by default. Metadata is classified and staged in `discoverycandidates`; `verify_candidate` jobs verify open bidding before promotion. Unknown candidates survive transient e-GP failures and exhausted retries remain reviewable. `verifyInline:true` retains the small-batch diagnostic path.
2. Manual non-software overrides survive metadata refresh and candidate promotion. Uncertain classification does not trigger paid OCR/AI processing.
3. Official verification can try a bounded normal browser render after static HTML cannot establish eligibility. Human challenges, conflicting dates and unavailable pages remain unknown, never assumed open.
4. The worker resumes Vertex from matching stored OCR before making new government requests. `OCR_FORCE=true` requests new extraction instead. Historical stored analysis is distinct from acquiring an ended TOR.
5. Vertex retries HTTP 429/500/502/503/504 and transport timeouts, with bounded attempts/backoff and Retry-After support. Validated chunks are saved in `vertexchunks` and reused after interruption. Auth failures are not retried.
6. PDF registration/current-primary publication, OCR pages/run pointers, and final summary pointers use MongoDB transactions. OCR/summary pointer writes reject concurrent document/run changes. API hydration rejects stale cross-document joins instead of showing an old summary for a new PDF.
7. Processing/workflow retry states are aligned; `ai_pending` and `text_extracted` records can be queued again. Worker watch mode is required for unattended retries.
8. Source URL/entry uniqueness includes SHA-256, allowing a revised PDF at the same URL without losing its earlier version. `db:ensure-indexes` creates the replacement before dropping the obsolete `uniq_document_source_entry` index. No document data is removed. These indexes were successfully applied to the configured application database.
9. OCR configuration is persisted from the extractor's actual `config` property.
10. Admin/analytics read normalized MongoDB records rather than demo projects. Admin buttons perform real ingestion/enqueue requests, not simulated publication. TOR detail displays fiscal-year evidence/warnings. Unprocessed document pages get safe presentation defaults.
11. Pipeline/admin mutations require an admin session or explicitly configured operator token. Public read endpoints remain available. Cookie mutations reject foreign origins.
12. Supplementary acquisition follows software/open-bid admission, processes archive groups sequentially, and uses portable temporary paths. Primary-PDF selection has not changed.
13. The legacy DB connection import now delegates to the shared explicit DB-name/DNS helper. Docker MongoDB is configured as a single-member replica set for transactions, with healthy-primary dependencies.

## Tests

- Core Node suite: 101 tests passed.
- Next/API/auth Vitest suite: 71 tests passed.
- Production build passed.
- `git diff --check` passed.
- `docker compose config --quiet` passed. Docker containers themselves were not started; Atlas transactions were exercised instead.
- Real government metadata request for year 2569 returned five records in both live smoke runs. This is a contract-data response, not proof of open bidding or completeness.

### Real OCR / Vertex / MongoDB end-to-end test

Latest isolated database: `moneytamngan_e2e_1791461515820`.

- Main test project: `projects` → `{ project_id: "66089621472" }`.
- Summary: `documentsummaries` → `{ _id: ObjectId("6ac788a961bb6af4300b5c5c") }`.
- Raw text: `documentpages` → `{ project_id: "66089621472" }`.
- Run/configuration: `extractionruns` → `{ project_id: "66089621472" }`.
- Checkpoint: `vertexchunks` → use the run's `_id` as `extraction_run_id`.
- Version test: `documents` → `{ project_id: "version-probe" }` has two different hashes at the same source URL/entry, exactly one current primary, and a previous-document reference.

The main test used an archived, real scanned Thai procurement page (page 20 of the local e-Bidding PDF, reduced to a one-page fixture). Real Poppler/Tesseract ran, real Gemini Flash generated the summary, and real Atlas transactions saved all linked records. The fixture's normalized source page is numbered 1, not the original PDF page 20.

Government API transport was tested independently. Candidate metadata, open eligibility and acquisition were controlled test adapters, deliberately labelled as fixtures; the test does **not** assert that this old project is currently accepting bids. `example.org` source URLs exist only in the isolated test records and are not real download links.

Verified: candidate promotion, unique active job, OCR configuration/raw text, summary linking, fiscal budget year 2565 with regex+LLM evidence from section 12, temporary-file cleanup, repeat processing with no second download/OCR/Vertex call and no duplicate records, transaction rollback, and changed-PDF history at an unchanged URL.

Result was `review_required`, not silently approved: scanned financial text retains OCR-quality review requirements. No risk findings were returned on this particular source page; that is not a fabricated positive risk-detection example.

### HTTP and rendered-page smoke test

The isolated test app returned HTTP 200 for:

- `/api/tors?isSoftware=true`
- `/api/tors/66089621472`, `/summary`, `/anomalies`
- `/api/projects/66089621472`
- `/api/processing/status?projectId=66089621472`, `/api/processing/review`, `/api/ingestion/status`
- `/admin`, `/analytics`, `/tors/66089621472`, `/tors/66089621472/document`

Admin/analytics HTML contained the isolated project, and TOR detail HTML included fiscal year 2565. Anonymous processing POST was rejected with 401. These are HTTP/server-render checks, not a browser screenshot or click-through audit.

Authenticated HTTP enqueue created job `6ac78998f9575e9855267317`; the immediately repeated request reused that active job instead of inserting another.
The actual `worker:once` process then completed that job. HTTP status confirmed `completed`, `resumedOcr:true`, `reused:true`, and the unchanged summary ID `6ac788a961bb6af4300b5c5c`. The result remains `review_required` because the source has financial OCR review flags; successful job completion is not automatic human approval.

## Operating the fixed pipeline

Set a strong `JWT_SECRET` for browser login. It was missing from the local environment during testing; only the isolated test process received a temporary signing secret, and `.env` was not edited. An authenticated admin-role session is required for admin actions. Do not automatically promote ordinary users to admin.

For CLI mutation requests, configure a random `PIPELINE_ADMIN_TOKEN` of at least 32 characters on the app, then send it in `Authorization: Bearer …`. Never commit either secret. Set `APP_ORIGIN` to the external origin behind a reverse proxy.

```sh
npm run db:ensure-indexes
npm run dev
```

In a second terminal:

```sh
npm run worker
```

Ingestion with `enqueueProcessing:true` now queues verification, then document processing after promotion. `worker:once` handles one job only: verification and actual project processing may require separate invocations. Use watch mode for the complete chain and retries.

For repeatable isolated tests:

```sh
node scripts/test-pipeline-live.js /path/to/the-one-page-thai-fixture.pdf
MONGODB_DB_NAME=moneytamngan_e2e_1791461515820 npm run dev
node scripts/test-pipeline-http.js http://localhost:3000
```

The live test requires MongoDB, Vertex credentials, OCR binaries and a fixture containing budget year 2565; it can incur small Vertex usage. It creates a new test database by default and preserves it for inspection. HTTP smoke test needs the same configured signing secret as the test app. Never reuse a test-only secret in production.

## Remaining limits

- EGP-CONTRACT is not a complete open-announcement feed. This work does not establish exhaustive software-TOR coverage or an 80%+ scraping reliability rate.
- e-GP/aggregator outages, human challenges and unsupported deadline layouts can still block new acquisition. They remain visible/retryable, not reported as successful downloads.
- Not-yet-open and uncertain candidates need later requeue/review. There is no new perpetual announcement crawler or automatic manual-decision UI for candidates.
- Request spacing is per process, not a distributed rate limiter.
- AI capacity limits can outlast bounded retries. Completed OCR/chunks remain durable; final failed jobs require an operator requeue.
- OCR/LLM cannot guarantee missing or unreadable fiscal years, exhaustive risk findings, or perfect Thai monetary accuracy. Financial uncertainty remains reviewable.
- Default OCR/AI still selects the primary PDF only. Registering all PDFs from a ZIP does not mean every attachment has been summarized.
- These tests validate the controlled acquisition pipeline plus real OCR/AI/storage/API/UI handoffs. A fully live matched open-bid discovery→ZIP→summary run remains dependent on government availability and a verified active-announcement source.
