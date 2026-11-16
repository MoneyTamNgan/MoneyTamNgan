# TOR pull pipeline

How a project becomes a summarised, searchable TOR. Each box is one stage; the label on a box is the `processing.status` the project has when that stage finishes. The step-by-step sequence with actors is in [tor-flow.md](tor-flow.md).

```mermaid
flowchart TD
    A["1. Ingest metadata<br/>e-GP Open Data API and RSS<br/>(scheduler 06:00 / 12:00 / 18:00, or admin run)"] --> B["2. Classify from metadata<br/>software / not software / uncertain"]
    B -->|not software| X1(["irrelevant"])
    B -->|uncertain| X2(["review_required<br/>admin decides"])
    B -->|software| C["3. Check the tender is still open<br/>invitation PDF, extensions, cancellations"]
    C -->|closed or cancelled| X3(["metadata_only"])
    C -->|unknown| X2
    C -->|open| D["4. Acquire the TOR document"]

    subgraph ACQ [Acquire]
        D --> D1{"known pdf_url<br/>or cached file?"}
        D1 -->|yes| D2["download directly<br/>(URL safety check)"]
        D1 -->|no| D3["RSS draft-document ZIP<br/>extract PDFs, pick the TOR"]
        D3 -->|none published| D4["browser fallback (Puppeteer)<br/>retries and circuit breaker"]
    end

    D2 --> E["document_downloaded<br/>validate, SHA-256, store locally or GCS"]
    D3 --> E
    D4 --> E
    D4 -->|not published| X3
    D4 -->|retryable failure| X4(["retry_pending<br/>worker retries with backoff"])

    E --> F["5. Extract text per page<br/>embedded text first, Thai+English OCR for scanned pages<br/>(checkpointed per page)"]
    F -->|unreadable| X2
    F --> G["text_extracted"]
    G --> H["6. Vertex AI (Gemini)<br/>summary, scope, qualifications, tech stack,<br/>evidence pages, anomaly signals"]
    H -->|failure| X4
    H -->|low confidence or partial| X2
    H --> I["completed<br/>summary stored"]
    I --> J["7. Embedding<br/>text-embedding-005, 768 dims"]
    J --> K["Dashboard, search, matching and alerts"]
    X2 -->|admin approves or overrides| C
```

## Stages

| # | Stage | Code | Notes |
|---|---|---|---|
| 1 | Ingest | `lib/egp-api.js`, `lib/egp-rss.js`, `lib/ingestion-runner.js` | Scheduler calls the trigger endpoints; each run is stored in `ingestionruns` |
| 2 | Classify | `lib/classifier.js`, `lib/classification.js` | Admin override in `lib/classification-override.js` |
| 3 | Eligibility | `lib/procurement-eligibility.js`, `lib/egp-announcement.js` | A newer extension or cancellation wins over the older invitation |
| 4 | Acquire | `lib/document-resolver.js`, `lib/tender-acquisition.js`, `lib/scraper.js` | API first, browser only as the last resort (`ENABLE_BROWSER_FALLBACK`) |
| 5 | Extract text | `lib/text-extraction.js` | Poppler (`pdftotext`, `pdftoppm`) and Tesseract `tha+eng`; PDFs up to 1000 pages |
| 6 | Summarise | `lib/vertex/` | Output must match the response schema; TOR text is data, not instructions |
| 7 | Embed | `lib/vertex/embedding.js`, `docs/vector-search.md` | Worker runs it after a job and a sweep retries failures |

Orchestration is `processProject` in `lib/processing-pipeline.js`. API requests only enqueue a job in MongoDB; `scripts/worker.js` runs jobs with leases and bounded retries, so a crashed worker never leaves a job stuck in `running`.

## Where the data comes from

| Source | What it gives | Used for |
|---|---|---|
| e-GP Open Data API (`lib/egp-api.js`) | structured project metadata and a `pdf_url` when known | stage 1, stage 2 |
| e-GP announcement RSS, per department (`lib/egp-rss.js`) | `B0`: draft bidding documents (ZIP). `D0`: invitation announcement (PDF) | stages 3 and 4 (the invitation supplies the submission window, agency and reference price; the ZIP supplies the TOR) |
| Official e-GP detail page (Puppeteer) | the document when nothing above has it | stage 4, last resort |

## Jobs, retries and recovery

API requests never process a TOR themselves. They enqueue a job in the `processingjobs` collection and the worker (`scripts/worker.js`) picks it up.

| Rule | Value | Code |
|---|---|---|
| Claim | oldest queued job; the worker takes a **lease** of 10 minutes and the attempt counter goes up | `claimNextJob` in `lib/job-queue.js` |
| Attempts | up to 3 per job by default (`max_attempts`) | `lib/job-queue.js` |
| Retry backoff | 30 s, doubling each attempt, capped at 1 hour; a non-retryable error fails the job at once | `lib/job-queue.js` |
| Crashed worker | a `running` job whose lease has expired goes back to `queued` | `lib/job-queue.js` |
| Duplicate requests | a project that already has a queued or running job is not enqueued twice | `lib/job-queue.js` |
| Recovery sweep | plans which stuck projects to re-enqueue (skips summarised, terminal, not-software and manual-review projects) | `lib/processing-recovery.js` |
| Browser failures | retried with backoff; a circuit breaker pauses the run after repeated transient failures so an e-GP outage does not use up every attempt | `lib/tender-acquisition.js` |
| Scheduler | runs ingestion then scraping at 06:00, 12:00 and 18:00 Asia/Bangkok; each run is stored in `ingestionruns` | `scripts/ingestion-scheduler.js`, [reference.md](reference.md#automated-ingestion-schedule) |

## Statuses

`processing.status` (mirrored in `workflow.status`) tells you where a project is:

| Status | Meaning | Who moves it on |
|---|---|---|
| `irrelevant` | classified as not software | nobody (admin can override the classification) |
| `metadata_only` | tender closed or cancelled, or the document was never published | nobody |
| `review_required` | needs a human: uncertain classification, unknown eligibility, unreadable document, partial or low-confidence AI result | admin review queue (`/api/processing/review`, `/api/admin/classification`) |
| `retry_pending` | a retryable failure (network, e-GP 5xx, browser, Vertex) | the worker, with backoff |
| `document_downloaded`, `text_extraction_pending`, `text_extracted`, `ai_pending` | in progress between stages | the worker |
| `completed` | summary and evidence stored | done; the embedding sweep adds the vector |

Admins can start a run and watch its progress through `/api/admin/pipeline/trigger` and `/api/admin/pipeline/status`; these actions are recorded by `lib/admin-pipeline-audit.js`. Check progress with `GET /api/processing/status` and `GET /api/ingestion/status`.

## Run it

```bash
npm run scheduler:once                       # ingest now
curl -X POST localhost:3000/api/processing/trigger -H 'Content-Type: application/json' -d '{"batchSize":20}'
npm run worker:once                          # process one queued job
```

More options: [reference.md](reference.md#run-the-pipeline).
