# MoneyTamNgan: Thai OCR and Vertex AI implementation handoff

Status snapshot: 7 September 2026. Scope: current local code, prior implementation tests, and saved extraction artifacts.

## 1. Executive status

Local PDF text extraction and Thai OCR are implemented and have run successfully on real procurement documents. The worker now calls this stage before Vertex AI. Vertex has been changed to accept page-labelled text instead of PDF bytes. A subsequent live request authenticated successfully but returned HTTP 403 because project billing is disabled; cloud summarization has not yet succeeded.

The immediate next step is to configure Google Cloud authentication and Vertex, run one existing project through the worker, and inspect the saved summary and evidence in MongoDB. Additional quality and operational work is needed before calling this production-ready.

| Area | Current status | Evidence or qualification |
| --- | --- | --- |
| Government metadata ingestion | Existing implementation retained | Uses the official Open Data endpoint |
| e-GP ZIP/PDF acquisition | Previously implemented and tested | Project 68019088742 yielded a ZIP and three PDFs |
| Embedded PDF text | Implemented and live-tested locally | Four-page Thai announcement: four pages extracted, zero OCR pages |
| Thai OCR | Implemented and live-tested locally | 145-page TOR scanned document; four-page forced-OCR test |
| Page checkpoints and reuse | Implemented and tested | Interrupted-page unit test and real four-page cache reuse |
| Worker integration and status | Implemented; automated tests | No live database-backed OCR-to-Vertex completion verified in this work |
| Text-to-Vertex requests | Implemented; mocked request tests | No live Vertex response yet |
| OCR accuracy | Sample visual inspection only | No measured Thai character/word accuracy benchmark |
| Deployment | Not completed | Native OCR tools were installed on this Mac only |

### Repository state

- Branch: `develop-api_database`.
- Local HEAD at inspection: `269b98e`, merging the admin classification-keyword work.
- Earlier e-GP archive implementation: commit `4bfd04c`, previously pushed.
- The OCR/Vertex changes are being delivered as focused commits for extraction, integrated processing, and documentation. Use the branch log for their final commit IDs.
- Downloaded ZIPs, PDFs, and generated OCR artifacts are under Git-ignored `storage/`.
- Remote freshness was not rechecked for this document; this is a local-code snapshot.

## 2. Pipeline now implemented

```text
Official government metadata API
  → MongoDB project and queued processing job
  → Metadata classification using current keyword rules
      → clearly non-software: stop as irrelevant
      → eligible or uncertain: continue
  → Reuse stored PDF, or acquire official e-GP ZIP/PDF
  → Keep ZIP and extract/select the primary TOR PDF
  → Persist/hash PDF locally or in configured GCS storage
  → Extract embedded text page by page
      → usable text: keep embedded text
      → scanned/unusable text: render page and run Thai/English OCR
  → Save page checkpoints and combined document.json
  → Reclassify initially uncertain projects using extracted text
  → If no usable text: manual review
  → If Vertex disabled: ai_pending
  → Otherwise: summarize bounded text chunks with Vertex
  → Validate JSON and page references, combine chunk results
  → Save structured enrichment and processing metadata
  → completed or review_required
```

The OCR change does not add separate scrapers for every agency website. Document acquisition still uses known URLs or the aggregator-to-official-e-GP route. A project must already exist in MongoDB for the processing worker to handle it. The standalone OCR command can read a local PDF without MongoDB.

## 3. OCR implementation details

### Engines and execution

`lib/text-extraction.js` uses Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) and Tesseract. Installed versions observed in the saved tests are Poppler 26.09.0 and Tesseract 5.5.3. Tesseract language selection is `tha+eng`.

OCR runs on the worker machine. It does not call a cloud OCR API or require an OCR API key. It consumes local CPU, memory, and storage.

| Setting | Current implementation |
| --- | --- |
| Embedded-text extraction | Per page, UTF-8, layout-preserving Poppler mode |
| Rendering | 200 DPI, maximum image dimension 3500 pixels |
| OCR segmentation | Tesseract automatic page segmentation, `--psm 3` |
| OCR output | TSV word entries, assembled into text lines |
| Languages | Thai and English |
| Page limit | 1–1000 pages |
| Process timeout | 180 seconds per native command |
| Process output limit | 16 MiB |
| Tesseract thread setting | `OMP_THREAD_LIMIT=1` |
| Force OCR | `.env` variable `OCR_FORCE=true`, or CLI `--force-ocr` |

The text-quality heuristic requires at least 40 non-whitespace characters, fewer than 2% replacement/private-use characters, and more than 50% letters/numbers. These thresholds identify common empty or broken text layers; they do not prove that text is correct. A sparse title page can therefore be OCRed even when its embedded text is valid.

Tesseract TSV can split Thai characters into separate word entries. The parser removes inserted spaces between adjacent Thai runs while retaining English spacing and line breaks. This improves readability, but can also remove meaningful Thai phrase spacing. It does not reconstruct tables, preserve bounding boxes, or correct tone marks.

### Persistence and resuming

Each extraction is keyed by the PDF SHA-256 hash and an extraction-configuration fingerprint. The fingerprint includes the extraction version, reported engine versions, OCR mode, DPI, and languages.

```text
storage/tor/<project-id>/
  <source-archive>.zip
  extracted/
    <selected-TOR>.pdf
    <other-PDFs>.pdf
    text/
      <pdf-hash>-<configuration-fingerprint>/
        page-1.json
        page-2.json
        ...
        document.json
```

Each page stores `page_number`, `text`, `extraction_method`, and `confidence`. Embedded pages have null confidence. OCR confidence is the mean of recognized word confidences; it is not a measured probability that the page is correct.

Checkpoints are written through temporary files followed by rename. Completed page files are reused after a retry. Temporary render images are removed after each OCR operation. Raw text stays in files, rather than being embedded in the MongoDB project record.

With GCS storage configured, the combined JSON is uploaded through the existing document-storage helper. Per-page checkpoints remain local, so durable local storage is necessary to resume individual pages after a worker host is replaced. Automatic retrieval of remote checkpoints has not been implemented.

## 4. Vertex summarization changes

`lib/vertex/tor-extractor.js` now sends JSON containing page numbers and extracted text. The previous inline/GCS PDF input is no longer the worker's summarization input.

- Text is split into chunks of at most 24,000 text characters. This is a character bound, not an exact token/request-byte bound.
- A long page can span chunks while retaining its original page number.
- Chunks are processed sequentially.
- The system prompt requests Thai summaries, supported facts, and empty arrays for missing information. It treats document text as untrusted source material.
- Qualifications, scope, tech stack, and flagged clauses require page references in the response schema.
- The validator rejects references to pages outside the current chunk.
- Missing content, malformed JSON, non-success responses, and incomplete/blocked generation are rejected.
- Chunk summaries are joined; exactly matching evidence objects are deduplicated.
- Final confidence uses the lowest chunk confidence. Token usage is summed.
- Prompt version is now `tor-thai-text-v2`.

There is no final whole-document synthesis call. Joined chunk summaries may repeat themselves, and deduplication does not merge semantically equivalent wording. Validation checks page membership, but does not verify that each claimed fact is actually supported by a quotation on that page.

Completed AI results can be reused when the recorded document hash, text hash, prompt version, and model name match. Individual successful Vertex chunks are not checkpointed, so a later chunk failure can cause earlier chunks to be called again on retry.

## 5. Worker, classification, and database changes

The worker reuses an existing local PDF when available, avoiding a new download for ordinary OCR/AI retries. It renews the job lease every 30 seconds because OCR can exceed the original ten-minute lease. Renewal failures are logged; comprehensive lost-lease ownership handling remains a production-hardening task.

The existing overall job retry limit still applies. Separate counters track download attempts, OCR stage attempts, and AI attempts; these counters do not provide independent retry budgets for each stage.

Manual classification overrides are preserved. Initially uncertain projects are classified again using extracted text and the database keyword rules. Projects classified as clearly non-software before acquisition still skip OCR.

| Fields | Purpose |
| --- | --- |
| `document.text_uri` | Local combined JSON path or GCS URI |
| `document.text_sha256` | Hash of page-level extracted content |
| `document.page_count` | PDF page count |
| `ocr.status` | pending, running, completed, or retry_pending |
| `ocr.provider`, `ocr.processor_version` | Engine identity and configuration fingerprint |
| `ocr.pages_processed`, `ocr.ocr_pages` | Progress and count of OCR pages |
| `ocr.attempts`, `ocr.error`, `ocr.completed_at` | Stage history and latest error |
| `ocr.needs_review` | Extraction-quality heuristic flag |
| `processing.text_sha256` | Text version used for saved AI enrichment |
| `processing.download_attempts`, `processing.ai_attempts` | Stage counters |

New processing states include `text_extraction_pending` and `text_extracted`. Existing `ai_pending`, `completed`, `review_required`, `retry_pending`, and `failed` states remain in use.

No usable text sends a project to review. Any weak/unreadable page or OCR confidence below 0.65 marks extraction for review. After AI, completion also requires the configured Vertex confidence threshold, default 0.8. These heuristics can over-flag blank pages and under-detect confidently wrong OCR.

The status endpoint now accepts `GET /api/processing/status?projectId=<id>` and returns document, OCR, and processing information. There is no new browser OCR viewer or correction screen.

## 6. What was tested

The last implementation verification reported 34 passing automated tests, a successful production build, and a clean whitespace check. These checks were not rerun merely to create this handoff document.

Automated coverage includes Thai text-quality checks, TSV parsing, chunk coverage, invalid page references, mixed embedded/scanned pages, interrupted OCR resume, cache invalidation on changed input, mocked Vertex request/auth-header formatting, rejection of truncated responses, worker progress, retry state, cached-summary reuse, and empty-output review routing.

| Real local test | Result | Qualification |
| --- | --- | --- |
| `001-TOR ERP.pdf` | 145 pages processed through OCR | Full run began before the engine-fingerprint and Thai-spacing fixes |
| `002-annoudoc_0800600020_68019088742.pdf` | Four embedded-text pages, zero OCR pages | Current code path |
| Same announcement with forced OCR | Four pages OCRed | Current Thai-spacing handling tested |
| Repeated forced-OCR announcement run | Same text hash and unchanged page-file timestamps | Confirmed checkpoint reuse |

The saved 145-page artifact has an empty Poppler engine field and older Thai spacing. It proves that a full large document was processed, but must not be treated as validation of the final code on all 145 pages. Rerun the large PDF with the final code before using its text for a final summary; the updated fingerprint can cause OCR to run again.

No live Vertex summary, end-to-end MongoDB enrichment, GCS upload for OCR artifacts, production load test, or formal Thai accuracy measurement was completed in this work. A `needsReview: false` artifact value is only the heuristic result, not a human quality approval.

## 7. How to use and inspect the result

Run commands from the MoneyTamNgan repository root.

### Local OCR only

The native dependencies are installed on this Mac. Other hosts need them:

```bash
brew install poppler tesseract tesseract-lang
```

For Debian/Ubuntu deployments, install `poppler-utils`, `tesseract-ocr`, `tesseract-ocr-tha`, and `tesseract-ocr-eng`.

```bash
npm run extract:text -- 'storage/tor/68019088742/extracted/001-TOR ERP.pdf'
```

The CLI prints progress and then `artifactPath`. It does not write MongoDB records or call Vertex. To test rendering/OCR even when text is embedded, append `--force-ocr`.

Use the emitted artifact path below:

```bash
ocr_file='/absolute/path/printed/as/artifactPath/document.json'
jq '{pageCount, ocrPages, needsReview, config}' "$ocr_file"
jq -r '.pages[] | select(.page_number == 2) | .text' "$ocr_file"
jq -r '.pages[] | "=== Page \(.page_number) ===\n\(.text)\n"' "$ocr_file" | less
```

Replace the placeholder first. Press `q` to exit the text browser. OCR output is JSON, not a searchable PDF or a standalone `.txt` file.

### Configure Vertex and run the worker

After the initial inspection, a service-account credential file and the Google Cloud project were configured locally. The live request authenticated but returned HTTP 403 because billing was disabled. Vertex was left disabled pending billing activation; local storage remains selected. Credentials are permission-restricted and excluded from Git. The current code uses Application Default Credentials through `google-auth-library`; it does not read a Vertex API-key environment variable.

Configure a Google Cloud project with billing, the Vertex AI API, and appropriate access for the account running the worker. See the [official Vertex setup guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart). The prior setup guidance uses `gcloud auth application-default login` for local development. Verify model availability and project permissions during the first live test.

```env
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_CLOUD_LOCATION=global
VERTEX_AI_ENABLED=true
VERTEX_MODEL=gemini-2.5-flash
TOR_STORAGE_BACKEND=local
OCR_FORCE=false
```

Retain the existing MongoDB settings. Restart the application and worker after changing their environment. Vertex use is billable; no live cloud call is needed just to inspect existing OCR JSON.

With the development server running and the project present in MongoDB:

```bash
curl -s -X POST http://localhost:3000/api/processing/trigger \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"68019088742"}' | jq

npm run worker
```

`npm run worker` processes the queue continuously. `npm run worker:once` processes one available job, which may be another project if it was queued earlier. If a job already completed as `ai_pending` while Vertex was disabled, enqueue it again after enabling Vertex.

```bash
curl -s 'http://localhost:3000/api/processing/status?projectId=68019088742' | jq
curl -s 'http://localhost:3000/api/projects/68019088742' | jq
```

Inspect `extracted_data.summary`, qualifications, scope, tech stack, evidence, and processing status in the project response. Enabling Vertex does not itself start a worker or requeue completed jobs.

## 8. Remaining work, in execution order

### A. Required to demonstrate the complete feature

1. **Enable billing and retest Google Cloud.** Local service-account authentication succeeded, but billing blocked the request. Enable billing, rotate the key shared in chat, replace the local credential file, and verify model access. Done when a small real text request succeeds.
2. **Rerun the large TOR using the final OCR code.** Inspect pages containing Thai tone marks, qualifications, dates, budget figures, and tables. Done when the final-version artifact exists and representative errors are recorded.
3. **Run one project through the real worker and MongoDB.** Verify progress fields, artifact location, completed/review status, and persisted enrichment. Done when results can be fetched from the project API and traced back to source pages.
4. **Review a live Vertex summary.** Check Thai readability, missing fields, hallucinations, page references, and preservation of authoritative metadata. Record actual latency and token usage. Done when a reviewer approves the result or creates specific defects.
5. **Deliver focused commits.** This delivery groups code, tests, environment example, README, and this handoff into reviewable commits; `.env`, credentials, and generated storage artifacts remain excluded.

### B. Required before broader or production use

1. **Measure Thai OCR quality.** Build a manually transcribed sample set spanning scanned, digital, mixed, rotated, low-resolution, and tabular pages. Measure character errors and correctness of critical numbers/clauses. Tune rendering and preprocessing based on evidence.
2. **Improve whole-document summaries.** Add a bounded final synthesis step, cross-chunk deduplication, and conflict handling. Keep provenance when combining facts.
3. **Checkpoint Vertex chunks.** Persist successful chunk outputs using text hash, prompt, model, and chunk identity. Retry transient failures with bounded backoff so one late failure does not repeat all paid calls.
4. **Strengthen evidence checks.** Store supporting quotations and test their relationship to source text. Existing page-range checks alone cannot establish factual support.
5. **Harden cache identity and validation.** Include traineddata identity and all rendering/parser settings; bump extraction versions for algorithm changes. Validate checkpoint structure and integrity more thoroughly. Prevent reuse of stale review decisions when quality thresholds change.
6. **Package the worker environment.** Pin native dependencies, provide durable storage, verify GCS permissions if used, and test recovery after host replacement. Local page checkpoints are not currently restored from GCS.
7. **Test concurrency and leases.** Handle lost lease ownership, duplicate processing, and heartbeat failure under load. Add operational logs and resource limits suited to long OCR jobs.
8. **Finish API documentation and review tools.** Update the OpenAPI contract for OCR fields/status responses. Add an OCR-text viewer, source-page comparison, and a correction/retry flow if required by the product.

### C. Optional later enhancements

- Benchmark a managed OCR engine against Tesseract if Thai accuracy is insufficient.
- Support structured table extraction and document rotation/deskewing.
- Process multiple relevant PDFs together; the current worker selects one primary PDF.
- Add a final-document summary with citations and a downloadable human-readable text export.

## 9. Code map

| File | Responsibility |
| --- | --- |
| `lib/text-extraction.js` | Embedded text, native OCR, quality checks, page cache, JSON artifact |
| `scripts/extract-text.js` | Standalone local OCR CLI |
| `lib/vertex/tor-extractor.js` | Text chunks, authenticated Vertex requests, page validation, result combination |
| `lib/vertex/response-schema.js` | Structured response schema and prompt version |
| `lib/processing-pipeline.js` | Stored-PDF reuse, OCR stage, classification, AI and database orchestration |
| `models/Project.js` | OCR/progress fields and new processing states |
| `scripts/worker.js` | Queue execution and lease renewal |
| `app/api/processing/status/route.js` | Per-project OCR/processing status |
| `test/text-extraction.test.js` | Extraction, resume, chunking, and mocked Vertex tests |
| `test/ocr-pipeline.test.js` | Worker-stage state and cache tests |
| `.env.example`, `README.md`, `package.json` | Configuration, setup instructions, and CLI registration |

This handoff documents the implementation and remaining work. Repository delivery does not enable cloud billing or start processing jobs.
