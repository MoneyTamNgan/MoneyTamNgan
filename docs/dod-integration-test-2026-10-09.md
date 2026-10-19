# TOR fiscal-year and announcement schedule integration tests

Historical report: the API/worker integration gap described below was addressed
on 12 October. See [the unified pipeline report](unified-pipeline-2026-10-12.md).

Branch: `develop-api_database`. Test date: 9 October 2026.
Production MongoDB records were not changed. No implementation fixes, commits,
pushes or merges were performed during this testing turn.

## Verdict

Both DoDs work on the exercised paths, including real OCR, live Gemini Flash,
MongoDB transactions, schedule storage and project-detail API reads. They are
not yet one automatic workflow behind every entry point: announcement extraction
is invoked by `scripts/ingest-open-tenders.js`, not by the existing government
API ingestion endpoint or the worker itself.

Do not interpret successful fixture tests as universal OCR accuracy or proof
that every live government TOR can be acquired.

## Results

| Check | Result | Scope |
| --- | --- | --- |
| Node tests | PASS: 140 | Fiscal years, schedules, schemas, OCR/Vertex validation, admission, history and retry behavior |
| Vitest | PASS: 71 | Existing API, UI and business-rule regression tests |
| Production build | PASS | Current API branch with uncommitted schedule additions |
| Live government spending API | PASS: 5 records | Real request; contract metadata is not proof of open bidding |
| Real scanned procurement PDF OCR | PASS | One archived Thai e-Bidding page used as a controlled acquisition fixture |
| Live Gemini Flash summary/fiscal year | PASS | Real authenticated Vertex call; fiscal year 2565 with regex and grounded LLM evidence |
| Real announcement PDF text/schedule | PASS | Project 69099693138; normalized bidding date 2026-10-08 and 09:00-12:00 Bangkok window |
| Actual RSS ingestion command | PASS | Live announcement download; passed deadline prevented TOR download and jobs |
| Atlas normalized storage | PASS | Real records, pointers and transactions |
| Combined schema preservation | PASS | Real announcement plus controlled TOR text and mocked Vertex HTTP response; fiscal year 2570 and schedules coexist |
| Repeated persistence | PASS | No duplicate extraction runs/pages/summaries |
| HTTP API/UI smoke | PASS | 12 endpoints/pages, anonymous mutation rejection and real HTTP enqueue deduplication |
| Real worker reuse | PASS | Worker consumed the HTTP job and reused durable OCR/Vertex result |
| Rollback and document revisions | PASS | Intentional transaction failure rolled back; changed bytes at the same URL retained document history |
| Temporary file cleanup | PASS | Worker removed its fixture copy; RSS command removed the actual recorded announcement filename |
| Forced announcement OCR | REVIEW REQUIRED | Misread digits were retained as evidence, not published into authoritative schedule fields |

## Source and test boundaries

The scanned fixture is `/private/tmp/mtn-e2e-pdf/tor-20.pdf`, an archived page
from the local e-Bidding document for project 66089621472. Its fiscal-year clause
is in section 12, not section 9. Poppler found no usable embedded Thai text,
so Tesseract ran. The stored OCR confidence was about 0.942; the run retained
`financial_ocr_requires_review`. Pipeline status `review_required` with no error
is an intentional quality gate, not a failed Vertex request.

The real worker test supplied controlled acquisition and open-eligibility adapters.
It did not claim this archived project currently accepts bids, or exercise a
successful live browser scrape. Government API transport was tested independently.

The invitation source was:
https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=6572bdad-5898-4bb8-9095-8378e36c9801

It belongs to a construction tender, so the isolated CLI test used `--all`.
This flag was not used against production. The invitation's deadline was passed;
the command correctly stored metadata/schedule but downloaded no TOR and queued
no project. This is not a successful live open software-tender acquisition test.

The combined-schema test used synthetic TOR text stating year 2570 and a mocked
Vertex HTTP response. That test verifies storage integration and grounding logic;
it must not be described as a second live Vertex run or real TOR OCR result.

## Retained MongoDB results

### Real OCR and live Vertex

Database: `moneytamngan_e2e_dod_1009_2028`

Filter in `projects`: `{ "project_id": "66089621472" }`

- Raw OCR: `documentpages.text`, linked through `latest_extraction_run_id`.
- Fiscal year: `documentsummaries.extraction.fiscal_budget`, linked through
  `latest_summary_id`; year 2565, method `regex+llm`.
- One page, extraction run, summary and Vertex chunk remained after rerun.
- Two completed processing jobs remained: initial pipeline test and HTTP-enqueued
  worker-reuse test. Completed jobs had no active key.
- The separate `version-probe` project has two historical document records and
  one current primary document.

### Actual announcement ingestion command

Database: `mtn_dod_cli_1009_2040`

Filter in `projects`: `{ "project_id": "69099693138" }`

- `bidding_date.date`: `2026-10-08`.
- `submission_schedule.start_time` / `end_time`: `09:00` / `12:00`.
- `submission_schedule.ends_at`: `2026-10-08T05:00:00.000Z` (12:00 Bangkok).
- `announcement_schedule.status`: `parsed`, with source document/page evidence.
- `procurement_eligibility.status`: `closed`.
- Document storage backend: `remote`, with no saved local PDF path.
- No primary TOR, no queued processing jobs.
- `/api/projects/69099693138` returned these schedule fields from this test DB.

### Combined schema fixture

Database: `mtn_schedule_test_1791552809195`

Filter in `projects`: `{ "project_id": "69099693138" }`

Schedule fields coexist with `latest_extraction_run_id` and `latest_summary_id`.
The linked summary contains fiscal year 2570 with regex and mocked-LLM evidence.

## Integration gaps and limitations

1. `POST /api/ingestion/trigger` still imports government contract metadata and
   queues the existing verification/processing path. It does not call the new
   RSS announcement acquisition/schedule extractor. Running that endpoint and
   `worker:once` alone does not guarantee announcement fields will be populated.
2. `ingest:tenders --enqueue` supplies the announcement flow and queues TOR work
   when an eligible TOR is acquired. The worker retains its existing independent
   official eligibility verification, which can still be blocked by scraping.
3. Schedule fields are exposed in `/api/projects/[id]`. The dedicated TOR response
   mapper and TOR detail page do not currently render those new fields. MongoDB
   storage meets the stated schedule DoD, but schedule UI is not implemented.
4. No universal accuracy guarantee: unreadable PDFs, missing clauses, contradictory
   years/dates, unusual layouts and OCR digit errors require review. The forced
   OCR announcement test demonstrated this limitation rather than hiding it.
5. This run did not freshly discover and fully process a matching live open
   software TOR plus its invitation from beginning to end. The live service,
   fixture, CLI, worker and combined-storage tests above cover distinct boundaries.

## Commands used

```sh
npm test
npm run test:vitest
npm run build
PIPELINE_TEST_DB=moneytamngan_e2e_dod_1009_2028 node scripts/test-pipeline-live.js /private/tmp/mtn-e2e-pdf/tor-20.pdf
npm run test:schedule-atlas -- --file=/private/tmp/announcement-schedule-live.pdf --combined
MONGODB_DB_NAME=mtn_dod_cli_1009_2040 node scripts/ingest-open-tenders.js --tenders=/private/tmp/dod-announcement-tender.json --limit=1 --all --no-browser --enqueue
```

Use fresh isolated database names for repeating tests. Temporary localhost servers
used only test databases and a process-local test signing secret; `.env` was not
edited. They were stopped after testing.
