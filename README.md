# MoneyTamNgan

## TOR processing pipeline

MoneyTamNgan uses an API-first pipeline:

1. Ingest structured project metadata from the e-GP Open Data API.
2. Classify obvious software/non-software projects from metadata.
3. Download a known `pdf_url` directly without opening a browser.
4. Use the rate-limited Puppeteer adapter only when no usable URL exists.
5. Validate and hash the document, then keep it locally or upload it to GCS.
6. Optionally send the PDF to Vertex AI for schema-controlled extraction.
7. Store the summary, qualifications, scope, tech stack, evidence pages, and
   anomaly signals without overwriting authoritative e-GP metadata.

Long-running processing is represented by MongoDB-backed jobs. API requests
enqueue work and a separate worker executes it with leases and bounded retries.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

At minimum, configure `MONGODB_URI` and `EGP_API_KEY`. Vertex is disabled by
default so API ingestion and local PDF downloads work without Google Cloud
credentials.

## Run the pipeline

Ingest metadata and enqueue each returned project:

```bash
curl -X POST http://localhost:3000/api/ingestion/trigger \
  -H 'Content-Type: application/json' \
  -d '{"year":"2569","limit":50,"enqueueProcessing":true}'
```

Alternatively, enqueue one existing project or a small pending batch:

```bash
curl -X POST http://localhost:3000/api/processing/trigger \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"69069021440"}'

curl -X POST http://localhost:3000/api/processing/trigger \
  -H 'Content-Type: application/json' \
  -d '{"batchSize":20}'
```

Run one queued job during development, or keep a worker polling:

```bash
npm run worker:once
npm run worker
```

Inspect pipeline coverage and the manual-review queue:

```text
GET /api/processing/status
GET /api/processing/status?jobId=<mongo-job-id>
GET /api/processing/review
PATCH /api/projects/<project-id>/classification
```

The classification patch body is `{ "isSoftware": true, "reason": "..." }`.

## Document storage

The TOR resolver finds e-GP document links, downloads the best
PDF (or ZIP fallback), and stores it under `storage/tor/<project-id>/`.
`Project.pdf_path` is the local file location while `Project.pdf_url` retains
the original remote URL for provenance. A discovered link is retained even
when downloading the file fails, so it can be retried later.

```bash
# Up to 10 projects whose pdf_path is missing
npm run scrape

# One project
npm run scrape -- --project-id=67039549408

# A larger batch with a five-second delay between projects
npm run scrape -- --limit=20 --delay=5000
```

Set `MONGODB_URI` in `.env`. The batch delay defaults to four seconds and can
be configured with `SCRAPER_DELAY_MS` or `--delay`. Values below three seconds
are rejected to avoid overwhelming the e-GP service.

Set `TOR_STORAGE_DIR` to override the storage root. Downloads are streamed to
temporary files and atomically renamed after completion. The default maximum
file size is 100 MB; change it with `TOR_MAX_FILE_SIZE_MB`. In production,
set `TOR_STORAGE_BACKEND=gcs` and configure `TOR_GCS_BUCKET`. Objects are named
by fiscal year, project ID, and SHA-256 hash so unchanged PDFs are not sent to
Vertex repeatedly.

## Vertex AI

Enable extraction only after Application Default Credentials and GCS access
are configured:

```env
TOR_STORAGE_BACKEND=gcs
TOR_GCS_BUCKET=money-tam-ngan-tor
GOOGLE_CLOUD_PROJECT=your-project
GOOGLE_CLOUD_LOCATION=global
VERTEX_AI_ENABLED=true
VERTEX_MODEL=gemini-2.5-flash
```

Local PDFs up to 20 MB can also be sent inline when GCS is not configured, but
GCS is recommended for production. Vertex responses use a fixed JSON schema
and are validated before database updates. Results below
`VERTEX_REVIEW_THRESHOLD` enter `review_required` instead of being silently
accepted.

## Legacy scraper commands

The API equivalents are `POST /api/scraping/trigger` and
`GET /api/scraping/status`. A trigger body can include `projectId`,
`batchSize`, `onlyMissing`, and `delayMs`.

The current e-GP announcement site uses Cloudflare verification. If it rejects
a headless session, the scraper records a retryable error instead of treating
the project as missing or writing an empty URL.

## Verification

```bash
npm test
npm run build
```
