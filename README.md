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

## Run with Docker

For evaluation hardware without a local Node/Mongo/Poppler/Tesseract/Chromium
setup, the whole stack runs via Compose instead:

```bash
cp .env.example .env
docker compose up --build
```

This starts `mongo` (local database, no Atlas/firewall dependency), `app`
(Next.js on http://localhost:3000), `worker` (polls for queued processing
jobs), and builds (but does not run) `scraper`. Trigger a scrape on demand:

```bash
docker compose run --rm scraper
```

### Docker against MongoDB Atlas (no manual IP allowlisting)

Use this to run the stack against the shared Atlas database instead of the
local `mongo` container. Before any service connects, a one-shot
`atlas-allowlist` service adds your current public IP to the Atlas IP Access
List through the Atlas Admin API. You no longer need to open the Atlas UI and
allow a new IP whenever your network changes.

**One-time setup**

1. In Atlas, open the project and go to **Project Settings → Access Manager →
   API Keys → Create API Key**. Give it the **Project Owner** role and copy the
   public and private keys. The private key is shown only once.
2. Copy the project ID from the Atlas URL
   (`cloud.mongodb.com/v2/<PROJECT_ID>#/...`) or from **Project Settings**.
3. Fill these values in `.env`:

   ```bash
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
   ATLAS_PUBLIC_KEY=<public key>
   ATLAS_PRIVATE_KEY=<private key>
   ATLAS_PROJECT_ID=<project id>
   ATLAS_ALLOWLIST_TTL_HOURS=168   # optional, max 168 (one week)
   ```

**Run**

```bash
docker compose -f docker-compose.yml -f docker-compose.atlas.yml up --build
```

The `atlas-allowlist` service should log `Atlas access list updated` and exit.
Then `app`, `worker` and `scraper` start against Atlas. To trigger a scrape:

```bash
docker compose -f docker-compose.yml -f docker-compose.atlas.yml run --rm scraper
```

Each IP added this way expires after `ATLAS_ALLOWLIST_TTL_HOURS`, so old
addresses don't pile up. Running the command again refreshes the current IP.

**Without Docker** (`npm run dev` against Atlas), allowlist the current IP
first:

```bash
set -a && . ./.env && set +a && sh scripts/atlas-allow-ip.sh
npm run dev
```

If `atlas-allowlist` fails with `401`, the API key or project ID is wrong. If
it fails with `403`, the key lacks the Project Owner role, or the key has its
own API access list that doesn't include your IP.

`Dockerfile` builds the Next.js app; `Dockerfile.worker` is shared by
`scraper` and `worker` and additionally installs Chromium, Poppler, and
Tesseract (with Thai data) for document acquisition and OCR.

## CI/CD and branch flow

Work goes into feature branches and is merged into `develop` through pull
requests. `main` is protected: nobody pushes to it directly, and it only
changes through the automated promotion below.

1. **PR into `develop` or `main`:** `.github/workflows/ci.yml` runs `Build`,
   `Test (mocked data)` and `API contract`, and `health-check.yml` runs the
   health check.
2. **Push to `develop`** (a merged PR): after those jobs pass, the `promote`
   job opens a `develop → main` PR (or reuses the open one), approves it as
   `github-actions[bot]`, and enables auto-merge.
3. **Auto-merge:** when main's required checks pass on that PR, GitHub merges
   it into `main` with a merge commit.

Protection on `main`: pull request required with 1 approval, required checks
`Build`, `Test (mocked data)`, `API contract` and `health-check`, no force
pushes, no deletion.

The promotion depends on the `PROMOTE_TO_MAIN_TOKEN` repository secret, a PAT
with `repo` scope (or a fine-grained token with Contents and Pull requests
write access). A PR opened with the default `GITHUB_TOKEN` would not trigger
the required checks. It also depends on the repository setting **Settings →
Actions → General → Allow GitHub Actions to create and approve pull requests**.

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

Create or verify the MongoDB uniqueness and lookup indexes after deployment:

```bash
npm run db:ensure-indexes
```

### Normalized schema maintenance

Document, OCR page, and Vertex summary data is stored only in the normalized
collections. API routes reconstruct the existing client response shape from
the project pointers, so clients do not need to understand the physical
storage layout.

For a database that still contains the former embedded project fields, run:

```bash
npm run db:ensure-indexes
npm run db:migrate-normalized -- --dry-run
npm run db:migrate-normalized
npm run db:reconcile-normalized -- --strict
npm run db:migrate-normalized -- --finalize-indexes
npm run db:cleanup-legacy
npm run db:cleanup-legacy -- --apply
```

The cleanup command is a dry run unless `--apply` is supplied. It refuses to
remove legacy fields when a document, OCR page, extraction run, or summary has
not been linked to normalized storage.

Duplicate prevention is enforced by unique indexes on the government project
ID and official project document URL. Extracted documents use the compound
identity `project_id + source_url + entry_name`, because multiple PDFs can
legitimately come from the same e-GP ZIP. OCR pages and Vertex summaries retain
their existing idempotent compound unique indexes.

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

`Document.source_url` retains the original remote URL for provenance, even when
that URL serves a ZIP. `Document.archive` records archive metadata, and each
valid extracted PDF receives its own `documents` record. A discovered link is
retained even when downloading the file fails so it can be retried later.

```bash
# Up to 10 projects whose normalized document is missing
npm run scrape

# One project
npm run scrape -- --project-id=67039549408

# A larger batch with a five-second delay between projects
npm run scrape -- --limit=20 --delay=5000
```

Set `MONGODB_URI` in `.env`. The batch delay defaults to four seconds and can
be configured with `SCRAPER_DELAY_MS` or `--delay`. Values below three seconds
are rejected to avoid overwhelming the e-GP service.

Set `TOR_STORAGE_DIR` to override the temporary working root. Downloads are
streamed to temporary files and atomically renamed before processing. By
default, `TOR_RETAIN_SOURCE_FILES=false`: after OCR is committed to MongoDB,
the ZIP/PDF working files are deleted while their official URL, hashes,
filenames, sizes, page text, and summaries remain stored. Set it to `true`
only when durable local/GCS source-file retention is required. The default maximum
file size is 250 MB; change it with `TOR_MAX_FILE_SIZE_MB`. Large e-GP files
have a bounded five-minute request timeout, configurable through
`EGP_DOWNLOAD_TIMEOUT_MS`. In production,
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
related-document service can intermittently return E1530. The scraper captures
the official ZIP-list request and resolves the latest archive through the
approval and upload services in the same browser session. Configure bounded
retry attempts with `EGP_DETAIL_RETRY_ATTEMPTS` (default 5).

## Verification

```bash
npm test
npm run build
```
