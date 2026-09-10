# MoneyTamNgan

## TOR processing pipeline

MoneyTamNgan uses an API-first pipeline:

1. Ingest structured project metadata from the e-GP Open Data API.
2. Classify obvious software/non-software projects from metadata.
3. Download a known `pdf_url` directly without opening a browser.
4. When no URL is known, resolve the project permalink through
   `egp-gprocurement.com`, then open its encrypted official e-GP detail URL.
5. Download the official draft e-Bidding ZIP from `gprocurement.go.th`, safely
   extract its PDFs, and select the most likely TOR document.
6. Validate and hash the document, then keep it locally or upload it to GCS.
7. Extract embedded text per page; OCR scanned/unreadable pages using Thai +
   English Tesseract, then send page-labelled text chunks to Vertex AI.
8. Store the summary, qualifications, scope, tech stack, evidence pages, and
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

The TOR resolver uses the third-party aggregator only to map a project ID to an
encrypted official detail URL. Document metadata and file bytes remain sourced
from the government Open Data and e-GP domains. It downloads the official
e-Bidding ZIP and stores it under `storage/tor/<project-id>/`. ZIP downloads are
kept as the source archive, while valid contained PDFs are safely extracted
under `storage/tor/<project-id>/extracted/`. The resolver selects the PDF whose
filename most strongly indicates a TOR or draft e-Bidding document.

`Project.pdf_path` points to the selected PDF and `Project.pdf_url` retains the
original remote URL for provenance, even when that URL serves a ZIP.
`Project.document.archive_path` records the downloaded ZIP and
`Project.document.extracted_files` records every valid extracted PDF. A
discovered link is retained even when downloading the file fails, so it can be
retried later.

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

ZIP extraction defaults to 200 entries, 100 MB per PDF, 200 MB total expanded
PDF data, and a maximum compression ratio of 200. Configure these with
`TOR_ZIP_MAX_ENTRIES`, `TOR_ZIP_MAX_PDF_MB`,
`TOR_ZIP_MAX_EXTRACTED_MB`, and `TOR_ZIP_MAX_COMPRESSION_RATIO`.

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

Vertex now receives text rather than PDF bytes. Long text is split into bounded
chunks; their Thai summaries are joined and duplicate evidence is removed.
Vertex responses use a fixed JSON schema
and are validated before database updates. Results below
`VERTEX_REVIEW_THRESHOLD` enter `review_required` instead of being silently
accepted.

## Thai OCR setup and operation

Install the native tools on every worker host (OCR runs locally):

```bash
# macOS
brew install poppler tesseract tesseract-lang
# Debian/Ubuntu
sudo apt-get install poppler-utils tesseract-ocr tesseract-ocr-tha tesseract-ocr-eng
```

The engines use embedded text first, falling back to Tesseract `tha+eng` at
300 DPI with a 5000-pixel maximum image dimension. Set `OCR_FORCE=true` if a
PDF has a misleading text layer. Reading order and table reconstruction are
heuristic, so visually check important clauses. Low-confidence OCR and blank
or unreadable pages route AI results to review.

OCR quality checks now compare monetary digits (Thai or Arabic) with adjacent
Thai amount wording. Financial or low-confidence pages receive a second OCR
pass using segmentation mode 6, in addition to the normal mode 3. Both readings,
raw text, selected segmentation mode, and warnings are retained in the JSON.
The code selects a reading but never silently changes an amount to match words.

All OCR pages with recognized financial language require source review, even
when both readings agree and confidence is high. Conflicts are exposed as
`ocr.review_pages` (page numbers and warning codes) through the project/status
APIs. Detailed conflicting values are kept in each page's JSON `warnings`.
This can over-flag pages and does not validate all dates or qualification terms.

Configure `OCR_DPI` (200–600, default 300) and `OCR_MAX_DIMENSION`
(3500–10000, default 5000). Rendering respects the requested DPI and reduces it
for oversized pages. The version/configuration fingerprint prevents older OCR
artifacts from bypassing the new checks. Old files are retained; the next run
may re-extract the document. Higher resolution and secondary passes increase
CPU time. Resolution guidance: [Tesseract quality documentation](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).

Test a local document without MongoDB or Google credentials:

```bash
npm run extract:text -- 'storage/tor/68019088742/extracted/001-TOR ERP.pdf'
```

Add `--force-ocr` to test the OCR path on a digital PDF. Page checkpoints and
the combined `document.json` are stored in a hash/version-keyed `text/` directory
beside the PDF. A retry reuses completed pages; changing the PDF, engines, or
OCR configuration creates a new cache. Raw text stays out of MongoDB. In GCS
storage mode the combined JSON is also uploaded and `document.text_uri` points
to it. Keep local storage persistent for page-level resume across worker restarts.

The existing worker now runs download → text extraction → Vertex. With
`VERTEX_AI_ENABLED=false`, it still produces OCR text and stops at `ai_pending`.
Enable Vertex using your Google project and Application Default Credentials
to run summarization. Neither the OCR CLI nor local OCR needs a cloud key.

Inspect `GET /api/processing/status?projectId=<id>` for OCR status, completed
pages, OCR page count, extraction error, and text location. Re-enqueue with the
existing processing trigger to resume a failure. The worker renews its lease
while OCR runs; OCR and AI attempt counters are tracked independently, while
the job queue retains its existing overall retry limit. Cached completed AI
results require matching document/text hashes, prompt version, and model.

## Legacy scraper commands

The API equivalents are `POST /api/scraping/trigger` and
`GET /api/scraping/status`. A trigger body can include `projectId`,
`batchSize`, `onlyMissing`, and `delayMs`.

The old e-GP search page uses Cloudflare verification, so it is disabled as a
fallback by default. Set `ENABLE_LEGACY_EGP_SEARCH_FALLBACK=true` only if that
search flow is usable in the deployment environment. Direct encrypted detail
URLs do not require the scraper to submit the public search form. The official
related-document service can intermittently return E1530; configure bounded
reload attempts with `EGP_DETAIL_RETRY_ATTEMPTS` (default 5).

## Verification

```bash
npm test
npm run build
```
