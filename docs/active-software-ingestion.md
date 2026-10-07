# Active software TOR ingestion

Normal ingestion (`POST /api/ingestion/trigger`) now accepts only software-classified candidates with verified open bidding. Non-software, uncertain software, closed, not-yet-open and unverified candidates are skipped before project upsert or job enqueue. The response adds skip counts and up to 20 examples. Existing historical records are not deleted.

The default discovery year now follows the current Thai fiscal year (October rollover, Bangkok timezone), instead of the hardcoded 2568. It remains a candidate-search year, not proof that an invitation is still open. API requests time out after 20 seconds; reflected API keys are redacted from HTTP error bodies.

The worker rechecks eligibility immediately before downloading/OCR/Vertex. Unknown eligibility produces `review_required`; closed/not-yet-open produces `metadata_only` and an explanatory `workflow.status`. No new artifact processing runs for these projects. Stored-text reanalysis remains available for historical analysis.

## Evidence and limits

- Contract/award evidence and explicit cancelled/closed statuses exclude a project.
- Otherwise the aggregator resolves the ID to its official e-GP detail page. Only allowlisted official HTML is read, with timeout and size limits.
- Verification requests are spaced at least one second apart per process. Multiple worker/server instances still need shared rate limiting.
- A narrowly labelled bid submission closing timestamp is required. Thai digits, Buddhist years, full Thai month names and day/month/year timestamps are supported; Thai local times use UTC+07:00.
- Date-only, conflicting deadlines, draft status, anti-bot responses, network failure and unsupported layout never mean open.
- Contract end dates, fiscal years, project ID prefixes and generic `Active` status are not bid deadlines.
- This is conservative verification, not a complete official announcement API adapter. Dynamic pages and date ranges not understood by the parser remain unverified. No anti-bot bypass is implemented.
- Keyword classification can miss software and produce false positives. This gate does not establish exhaustive recall or perfect software classification.
- EGP-CONTRACT is a contract-data source, not a comprehensive feed of currently open invitations. It may return zero eligible records. Reliable active discovery will need a verified current-announcement source/adapter; increasing the historical year range will not solve this.

## Test database

Use a dedicated database, never wipe production:

```sh
MONGODB_DB_NAME=moneytamngan_pipeline_test npm run dev
```

In a second terminal, the worker must select the same database:

```sh
MONGODB_DB_NAME=moneytamngan_pipeline_test npm run worker:once
```

The application connection helper explicitly defaults to `moneytamngan` when `MONGODB_DB_NAME` is unset. A raw `mongoose.connect(uri)` diagnostic does not use that helper and can misleadingly report `test` instead.

In Compass inspect `moneytamngan_pipeline_test.projects`, `documents`, `extractionruns`, `documentpages`, `documentsummaries`, and `processingjobs`. Risk findings and fiscal year live in `documentsummaries.extraction`; original source file URLs live in `documents.source_url`. PDF files are transient in the default link-only mode.

No bulk ingestion, production mutation, automatic database switch, or historical cleanup is part of this change. The ingestion route, normal processing worker, scraping-trigger route and standalone scraper CLI enforce this gate. Internal low-level scraping utilities are not standalone active-project discovery workflows. Historical stored-text reanalysis is intentionally still supported.

## Validation on this change

- 89 core tests and 66 Vitest tests passed; production build passed.
- Tests cover exact deadline expiry, Thai dates, future openings, award/cancellation, deadline extensions, unknown/challenge pages, incorrect project identity, conflict handling, and skipping OCR/Vertex and scraper entry points.
- A read-only connection using the application's database options confirmed `moneytamngan`, with 2,240 projects and 12 summary records at inspection time.
- A live five-candidate discovery request for fiscal year 2570 and keyword `ระบบสารสนเทศ` returned government API HTTP 500. No successful current-project live end-to-end run or new MongoDB write is claimed.
