# Announcement bidding schedule extraction

Integrated on `develop-api_database` using PR #60's RSS/announcement modules.
The existing fiscal-year, OCR, Vertex and document-history code remains in place.
Neither `develop` nor the PR author's branch is modified.

## Unified API/worker flow (12 October)

`POST /api/ingestion/trigger` now passes RSS department hints into candidate
verification. The verifier and `process_project` worker use a shared announcement
service; the worker saves invitation schedules before TOR processing, including
when it resumes an old project with durable OCR. Running the separate RSS CLI is
no longer required for announcement extraction.

Use `enqueueProcessing: true` to queue work. An optional four-digit `rssDeptId`
in the request supplies a department hint; upstream `rss_dept_id`/four-digit
`dept_id` is also retained. Alternatively set `EGP_RSS_DEPT_IDS` to a comma-separated
list of department IDs. Only four hinted/configured departments are queried per
lookup, with four-second spacing, five-second request timeouts and a five-minute
process-local feed cache. The worker never blindly scans all departments for one
project. A persisted official `tender.invitation_url` takes precedence.

Official current page evidence has priority. If it is unavailable, a matching
official RSS invitation and validated schedule can establish eligibility; current
official cancellation/award evidence and uncertain OCR cannot be overridden.
If no invitation can be resolved, `announcement_schedule` records `not_found` or
`needs_review` and an error. It does not invent fields or block unrelated durable
OCR/summary reuse. A parsed snapshot is refreshed after fifteen minutes.

Announcement document and schedule pointers are saved together in a transaction.
Temporary invitation PDFs are deleted and only URL metadata is retained. Existing
TOR document versions, extraction runs and Vertex summaries are not replaced by
this announcement step. The dedicated TOR UI does not yet display schedule fields;
they are available through the project-detail API and MongoDB.

```sh
curl -X POST http://localhost:3000/api/ingestion/trigger \
  -H 'Content-Type: application/json' \
  -d '{"year":"2570","limit":5,"rssDeptId":"0304","enqueueProcessing":true}'
npm run worker:once
```

Ingestion is admin-authenticated: the curl command also needs your normal admin
session cookie. The default route queues verification first, so one worker run
may verify a candidate and queue processing; run again or use `npm run worker`.

## Pipeline

1. Existing e-GP RSS D0 discovery provides the invitation PDF URL and project ID.
2. PR #60's downloader fetches that announcement separately from the TOR.
3. Poppler extracts embedded text, preserving form-feed page boundaries. Unreadable
   pages trigger the existing Thai/English Tesseract extraction pipeline.
4. Normalize Thai digits to ASCII. Parse explicitly labelled bidding/submission
   and bid-opening clauses, full/abbreviated Thai month names, Buddhist years,
   numeric dates and ISO dates. Validate calendar dates and time ranges.
5. Persist the announcement Document and update the existing Project with
   `bidding_date`, `submission_schedule` and `announcement_schedule` provenance.
   Existing `tender.submission_*` and `tender.closes_at` remain compatible.
6. The TOR OCR/Vertex pipeline continues unchanged. A TOR/browser failure does not
   prevent announcement schedule storage.

The RSS command only admits confirmed software projects by default. After reading
the announcement it uses the existing procurement eligibility rules to block TOR
acquisition for passed/unverified deadlines or contract/award evidence. The worker
keeps its existing official eligibility verification; this does not bypass it.
Announcement documents default to remote URL metadata, not GridFS/PDF storage.
Their temporary PDFs are removed after successful persistence. TOR file retention
continues to respect `TOR_RETAIN_SOURCE_FILES`; normalized primary-pointer updates
use the API branch's existing transaction bundle.

Both DoDs are now present on the same branch: TOR text is stored in
`documentpages.text` through `extractionruns`; its parsed fiscal year is stored in
`documentsummaries.extraction.fiscal_budget` (regex plus grounded Vertex evidence).
Announcement schedule fields are stored in `projects`, as documented below.

Already-paired projects without the current parser version acquire only the
announcement, not another TOR. Use `--force` for deliberate full reacquisition.

## MongoDB fields

`projects.bidding_date`:

```json
{"date":"2026-10-08","time":null,"at":null,"kind":"bid_submission","timezone":"Asia/Bangkok"}
```

`projects.submission_schedule`:

```json
{
  "date":"2026-10-08",
  "start_time":"09:00",
  "end_time":"12:00",
  "starts_at":"2026-10-08T02:00:00.000Z",
  "ends_at":"2026-10-08T05:00:00.000Z",
  "timezone":"Asia/Bangkok"
}
```

MongoDB stores `at`, `starts_at` and `ends_at` as BSON dates (UTC instants).
Date-only values remain Gregorian `YYYY-MM-DD` strings; midnight is not invented.
If only a bid-opening date is available, `kind` is `bid_opening` and
`submission_schedule` is null. If both event types exist, submission is preferred,
with opening evidence retained separately in `announcement_schedule.evidence`.

`announcement_schedule` stores parser version, source document reference and URL,
text hash, extraction method, timestamp, status, page-level clause evidence,
warnings and extraction errors. It is the current schedule read model, not a new
Vertex summary. The underlying announcement Document remains the source artifact.

Missing, impossible or conflicting dates are not guessed. Uncertain OCR candidates
remain in evidence for review; their structured date/window fields are null and
they do not set an authoritative `tender.closes_at`.

## Run and inspect

Normal ingestion:

```sh
npm run ingest:tenders -- --depts=0304 --limit=5 --no-browser --enqueue
```

This queues TOR OCR/Vertex work when a TOR is acquired. Run `npm run worker:once`
to process one queued project. `--all` explicitly bypasses
that gate and is not recommended for normal software-only ingestion.

Read-only extraction of a downloaded announcement:

```sh
npm run schedule:extract -- --file=/absolute/path/announcement.pdf
```

Backfill one existing project, without reacquiring or processing its TOR:

```sh
npm run schedule:extract -- --file=/absolute/path/announcement.pdf --project-id=PROJECT_ID --write
```

The write command requires the file SHA-256 to match the project's linked
announcement Document. It updates schedule fields only. The database comes from
`MONGODB_DB_NAME` (default `moneytamngan`); credentials come from `MONGODB_URI`.
No automatic bulk backfill or production test writes were performed.

Inspect Atlas `moneytamngan.projects` with `{ "project_id": "PROJECT_ID" }`, or
`GET /api/projects/PROJECT_ID`. The detail API preserves these additive fields.

## Verification

- Unit/regression tests cover Thai digits, all months, Buddhist years, valid and
  invalid calendars, positioned e-GP template values, bid-opening dates, time
  windows, conflicts, boilerplate publication dates, OCR fallback/errors, the
  acquisition path and Mongoose schema casting.
- Downloaded the public PR #60 fixture for project `69099693138` and visually
  confirmed its printed bidding date/window: 8 October 2569, 09:00–12:00.
- Tested real Poppler extraction through PR #60 acquisition and the actual
  `persistDocuments` function in Atlas. Ran persistence twice: one project and
  one announcement document, with matching structured schedule and legacy deadline.
- Test records retained at `mtn_schedule_test_1791549695255.projects`, filter
  `{ "project_id": "69099693138" }`. Production records were not modified.
- Forced actual Tesseract OCR on the same PDF also completed, but misread the
  Thai bidding day/year and time digits. Its quality flags now suppress structured
  schedule values and retain candidate evidence for manual review. Accurate OCR
  scheduling across scanned PDFs is not proven by this implementation.
- Combined API-branch Atlas verification retained at
  `mtn_schedule_test_1791551870339.projects`, same project filter. A real announcement
  plus controlled TOR text were persisted together. The fiscal year was 2570 with
  both regex and grounded LLM evidence. The Vertex HTTP response was mocked;
  extraction validation, OCR/page/summary transactions and idempotency were real.
  Repetition left one extraction run, one page and one summary, with schedule data
  still intact. This is not a live Vertex or real-TOR OCR end-to-end test.

Repeat the isolated Atlas test with that same public fixture PDF:

```sh
npm run test:schedule-atlas -- --file=/absolute/path/announcement.pdf
npm run test:schedule-atlas -- --file=/absolute/path/announcement.pdf --combined
```

This fixture-specific test creates a new `mtn_schedule_test_<timestamp>` database
and leaves its records available for inspection. It does not test live RSS
discovery or browser reliability, and the fixture is not a software tender.

## Limitations

This is deterministic clause parsing, not an LLM date inference task. Missing
dates, poor OCR, clauses split across PDF pages, unusual labels, multi-day windows
and unsupported layouts can require review. The successful live sample is not
evidence of universal scraping availability or a measured accuracy percentage.
Schedule extraction does not itself prove every tender remains eligible; cancellation
or extension notices may supersede an invitation. The existing worker verification
is still required before new TOR processing.
