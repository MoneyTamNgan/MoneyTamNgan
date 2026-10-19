# Unified announcement and TOR pipeline

Implemented on `develop-api_database`, 12 October 2026. `develop` was not edited.

## Change

The existing ingestion route and queued worker now share invitation lookup,
schedule extraction and procurement verification. Candidate verification can use
a matching official invitation when current HTML cannot establish eligibility.
Official cancellation/award evidence still wins. Confirmed software is required.

Processing jobs now save announcement schedules before TOR processing and before
durable OCR/summary reuse. The announcement has its own document reference and
cannot replace the TOR primary document, extraction history or Vertex summary.
URL metadata is retained; downloaded invitation PDFs are temporary. Announcement
document/schedule writes use an Atlas transaction. Database failures propagate
for retry; unavailable documents are explicitly marked, not guessed.

Flow:

```text
Government API metadata -> verify_candidate -> admission -> process_project
    -> matching invitation -> text/OCR -> bidding_date + submission_schedule
    -> TOR -> embedded text/Thai OCR -> fiscal regex + grounded Vertex evidence
    -> versioned extraction pages and summary -> compatibility API views
```

## Configuration

Provide `rssDeptId` in the ingestion body, use upstream `rss_dept_id` / four-digit
`dept_id`, or configure `EGP_RSS_DEPT_IDS`. A known official invitation URL is
preferred. Worker RSS lookups query at most four department hints, use 4-second
spacing, 5-second request timeouts, a 5-minute feed cache and a 15-minute parsed
snapshot cache. No per-project scan of all departments is performed.

No department hint or matching feed record means the schedule remains
`not_found`/`needs_review`, with a diagnostic. It does not manufacture dates or
prevent unrelated saved OCR/summary reuse. Use `enqueueProcessing: true` and run
the worker in watch mode or repeatedly: default ingestion queues verification
first, which queues processing after promotion.

## Verification

- 146 Node tests and 73 Vitest tests passed (219 total); production build passed.
- API tests verify department-hint propagation and malformed-hint rejection.
- Service tests cover exact project matching, conflicting invitation versions,
  official URL restrictions, transactions, cleanup, source absence, cancellation
  precedence and the prohibition on treating old API deadlines as current proof.
- The queued pipeline test passed with real Poppler/Tesseract, live Gemini Flash
  and Atlas transactions. One project contains both announcement schedules and
  the TOR fiscal-year summary; document references remain distinct.
- A repeated run reused the extraction and summary with no additional OCR or
  Vertex requests. Transaction rollback, same-URL PDF history and cleanup passed.
- Live government API transport independently returned five records.
- Local HTTP API/UI tests, anonymous mutation rejection and duplicate HTTP
  enqueue checks passed. A real worker rerun was also exercised against the same
  isolated database.

Test records: `moneytamngan_e2e_unified_1012b.projects`, filter
`{ "project_id": "66089621472" }`.

Raw text: `documentpages`, via `latest_extraction_run_id`.
Fiscal year: `documentsummaries.extraction.fiscal_budget`, via `latest_summary_id`.
Schedules: `projects.bidding_date`, `projects.submission_schedule` and provenance
under `projects.announcement_schedule`, via `announcement_document_id`.

## Test boundaries

The test used an archived scanned procurement page and a separate public
invitation as controlled acquisition fixtures. Candidate metadata, eligibility
and the invitation clock were explicitly controlled. These files do not prove a
matching, currently-open live government software tender was freshly discovered.
OCR, Vertex, transaction persistence and worker orchestration were real; no
production records or `.env` credentials were changed.

The first attempt stopped because previous temporary fixture files had been
cleared. A new isolated database was used after restoring the fixture. The final
test passed. The failed-attempt database was not deleted.

Fiscal year 2565 was found in source section 12 (section 9 is a priority, not a
requirement). The invitation's parsed date was 2026-10-08, 09:00-12:00 Bangkok.
The worker finished as `review_required`, with no execution error, because OCR
financial figures are intentionally flagged for review. Broad OCR/date accuracy
and government scraper reliability are not guaranteed.

The TOR-specific response mapper/UI still does not render schedule fields; those
fields are readable in MongoDB and `/api/projects/[id]`. Multi-PDF TOR OCR remains
deferred; this change preserves current primary-PDF processing.
