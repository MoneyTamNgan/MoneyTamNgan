# MoneyTamNgan source map

Paths below are relative to the active repository root. This is a navigation aid, not a frozen schema or list of guaranteed current behavior. Read only the relevant files and verify names after branch changes.

| Work area | Source and documentation |
| --- | --- |
| Setup, runtime, environment names | `README.md`, `package.json`, `.env.example`, `docs/reference.md`, `docs/local-deployment.md` |
| Pipeline overview | `docs/pipeline.md`, `docs/tor-flow.md`, `docs/automatic-software-processing.md` |
| API ingestion and scheduler | `lib/egp-api.js`, `lib/ingestion-schedule.js`, `scripts/ingestion-scheduler.js`, `app/api/ingestion/` |
| RSS/open tender discovery | `lib/egp-rss.js`, `lib/discovery-candidates.js`, `scripts/ingest-open-tenders.js`, `models/DiscoveryCandidate.js` |
| Classification and eligibility | `lib/classifier.js`, `lib/classification.js`, `lib/procurement-eligibility.js`, `lib/project-announcement.js` |
| Acquisition and archive safety | `lib/tender-acquisition.js`, `lib/document-resolver.js`, `lib/scraper.js`, `lib/scrape-failure.js`, `lib/url-safety.js`, `lib/archive-extractor.js` |
| Worker, queue and recovery | `scripts/worker.js`, `lib/job-queue.js`, `lib/processing-pipeline.js`, `lib/processing-recovery.js`, `models/ProcessingJob.js` |
| Admin asynchronous run | `app/api/admin/pipeline/`, `lib/admin-pipeline-control.js`, `lib/admin-pipeline-store.js`, `lib/admin-pipeline-audit.js`, `lib/services/pipeline-runner.js`, `docs/admin-pipeline-control.md` |
| PDF text/OCR | `lib/text-extraction.js`, `lib/ocr-quality.js`, `docs/ocr-vertex-implementation-status.md` |
| Announcement schedule and fiscal evidence | `lib/announcement-schedule.js`, `lib/announcement-analysis.js`, `lib/fiscal-budget.js`, `lib/fiscal-cache.js`, `lib/fiscal-backfill.js`, `docs/announcement-schedule.md`, `docs/announcement-fiscal-analysis.md` |
| Vertex summary, restrictions and resume | `lib/vertex/tor-extractor.js`, `lib/vertex/response-schema.js`, `lib/vertex/readable-pages.js`, `lib/vertex/reanalyze-project.js`, `lib/flagged-clauses.js`, `models/VertexChunk.js` |
| Persistence and public view | `lib/mongo-artifacts.js`, `lib/document-storage.js`, `lib/project-compat.js`, `lib/db.js`, `lib/mongodb.js`, `models/` |
| Embedding, matching and budget anomaly | `lib/vertex/embedding.js`, `lib/embedding-config.js`, `lib/budget-anomaly.js`, `docs/vector-search.md`, `docs/budget-baseline-policy.md`; locate current score implementation before changing its formula |
| TOR display and public APIs | `app/tors/[id]/`, `app/projects/`, `lib/services/tor-service.ts`, `lib/services/live-project-record.js`, `app/api/tors/`, `app/api/projects/` |
| BidPrep | `lib/bid-prep/`, `models/BidPrepDraft.js`, `app/api/bid-prep/`, `app/bid-prep/`, `docs/company-profile.md`, `docs/bid-draft-editor-export-report.md` |
| Notifications and SMTP | `lib/services/notification-service.js`, `lib/email.js`, `scripts/send-daily-digest.js`, `app/api/notifications/` |
| Contract and tests | `docs/api/openapi.yaml`, `docs/API_VALIDATION.md`, `tests/unit/`, `tests/integration/`, `tests/contract/`, `tests/security/`, `tests/e2e/` |

## Normalized storage and projection

The principal lineage is:

```text
projects → documents → extractionruns → documentpages
                                    └→ documentsummaries
projects → processingjobs
```

`projects.primary_document_id`, `latest_extraction_run_id`, and `latest_summary_id` identify the selected artifacts. Announcement documents and fiscal analysis have additional pointers/caches; inspect `models/Project.js` and `models/FiscalBudgetAnalysis.js`. `lib/project-compat.js` assembles the public response, including `extracted_data` and fiscal fields. Summary extraction lives under `documentsummaries.extraction`; page text is in `documentpages` linked to an extraction run. Project-level flags and fiscal caches are deliberate read projections in current code, not grounds for blindly deleting fields as duplicates.

Inspect `models/Document.js`, `ExtractionRun.js`, `DocumentPage.js`, `DocumentSummary.js` and `ProcessingJob.js` for real unique/partial indexes and legacy constraints. Inspect `lib/mongo-artifacts.js` for transactional writes and idempotency. Existing migration/reconciliation scripts are not permission to run destructive cleanup.

## Useful commands and their boundaries

- `npm run dev`: interactive app. Running it does not by itself guarantee an ingestion scheduler and worker are alive.
- `npm run scheduler:once`: one ingestion cycle; requires configured credentials/admin token.
- `npm run worker:once`: one eligible queued job, not the entire backlog.
- `npm run worker`: watch mode; keep it alive only when requested operationally.
- `npm run fiscal:backfill`, `vertex:reanalyze`, `db:migrate-normalized`, `db:reconcile-normalized`, `processing:recover`: inspect CLI flags and write/dry-run behavior before use.
- `node scripts/audit-api-documentation.js`: API documentation coverage check; independent of passing route tests.

Avoid bare copied curl commands for protected mutations. Determine whether the endpoint expects an admin session, scoped Bearer token or pipeline machine credential. Keep real tokens in local configuration, out of output and version control.
