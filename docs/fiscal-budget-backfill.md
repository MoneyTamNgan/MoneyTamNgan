# Fiscal-budget coverage backfill

## Behavior

The backfill combines the current announcement and primary TOR's stored page text. Regex runs first, reusing source-grounded LLM evidence from existing summaries when available. Only unresolved projects can make new Vertex calls, and only with `--llm`. Unsupported quotations are rejected. Explicit project-funding context is preferred, then actual budget headings; section 9 alone is not proof of funding. Conflicting funding years within or between documents produce `ambiguous`, never a silently selected year.

Context parser `thai-fiscal-context-v2` excludes explicit historical/reference and future-maintenance references from the selected years while retaining their quotes with `selected:false`, context labels and warnings. Actual maintenance procurement is not excluded merely for being maintenance. These are conservative Thai-text heuristics, not guaranteed semantic interpretation. The Vertex prompt is versioned separately as `tor-thai-risk-fiscal-v8`; existing summaries remain historical records.

The unified cache version is now `fiscal-backfill-context-v2`. Older analyses are preserved. Reads reject stale caches and retain the established legacy-source fallback until stored-text backfill refreshes them. Run the preview before applying; deployment does not silently rewrite every existing project.

## Offline accuracy comparison

```sh
npm run fiscal:evaluate
npm run fiscal:evaluate -- --dataset=/absolute/path/labeled-cases.json
```

The bundled 24 synthetic excerpts cover Thai digits, OCR spacing, history, future maintenance, actual maintenance funding, section headings and conflicts. The reconstructed previous selection baseline matches 15/24 cases; context-aware selection matches 24/24, with no false positives on the nine synthetic no-year cases. This is a regression fixture result, **not measured production PDF/OCR accuracy**. For representative accuracy, manually label real extracted excerpts (including negative cases), mark them `label_source:"human_reviewed"`, supply `reviewed_by`, and run the same evaluator. No database, cloud calls or downloads occur during evaluation.

A read-only Atlas preview on 23 October 2026 evaluated five software projects with linked stored text under the context parser: four years remained unchanged (2569, 2570, 2565, 2565), and one remained document-unavailable. Zero errors, database changes, downloads and new Vertex calls. This preserves existing examples but is not an independent human accuracy assessment. Version-v2 results were previewed, not applied to production caches in this check.

Results distinguish:

- `found`: one supported fiscal year.
- `ambiguous`: multiple supported fiscal years; requires review.
- `not_found`: available readable announcement/TOR text was checked without a supported fiscal year.
- `document_unavailable`: missing/unreadable source coverage prevents a complete negative assessment.

A found year can still carry incomplete-coverage or OCR-review warnings. Calendar years, project IDs and publication dates are not fiscal-year evidence.

## Storage and display

`moneytamngan.projects.fiscal_budget` is the unified current-result read cache. It includes years, status, method, warnings, source coverage and page-numbered evidence tagged with `announcement` or `tor` and document/run IDs. The API projects it through the existing `extracted_data.fiscal_budget` / `fiscalBudget` fields.

The canonical immutable record is in `fiscalbudgetanalyses`, referenced by `projects.latest_fiscal_analysis_id`. Its unique deterministic `input_key` includes source pointers, document/text hashes, existing summary identities, parser version and optional LLM policy. Unchanged retries do not create history duplicates or rewrite an intact cache. A changed source/policy creates a new historical analysis. OCR pages, Vertex summaries, risk flags and schedule fields are not overwritten.

Analysis creation and project linking are transactional and guarded by the source-pointer snapshot. If a source changes mid-run, linking fails and rolls back. API hydration ignores stale caches immediately when a source pointer changes. The new collection disables automatic creation/indexing so dry-run reads cannot initialize it; apply mode explicitly creates its unique index before writing.

## Safe defaults

- CLI is read-only unless `--apply` is supplied.
- Default selection prioritizes projects with stored extraction-run pointers. `--include-missing` additionally scans projects without stored extraction pointers to report gaps or acquire eligible documents.
- Classification uses the existing software rules and honors manual exclusions.
- No new PDF downloads or Vertex calls by default.
- Stored text from ended projects can be analyzed. New acquisition still requires fresh official **open-bidding** verification.
- The worker refreshes the unified result after normal `process_project` processing, using stored data only. This does not provision a running worker/server automatically.
- Failures are isolated per project; results include an ObjectId continuation cursor, coverage statuses, errors and resource counters.

## Commands

Preview stored-text coverage:

```sh
npm run fiscal:backfill -- --batch-size=5 --scan-limit=1000
```

Apply a stored-text-only batch (no downloads, no new Vertex calls):

```sh
npm run fiscal:backfill -- --apply --batch-size=5 --scan-limit=1000
```

Supply `--after-id=RETURNED_NEXT_AFTER_ID` to continue. Continue until `exhausted:true`; an empty/skipped scan page does not necessarily mean the entire collection has been examined. Default `_id` ordering is stable for pagination, not a promise of imported `created_at` ordering. Rerunning the first page reuses its results; it does not automatically move to the next page.

Optional bounded LLM fallback requires `VERTEX_AI_ENABLED=true` and valid credentials:

```sh
npm run fiscal:backfill -- --apply --llm --max-llm-calls=2 --batch-size=5
```

LLM calls are preflight-budgeted per project, so a too-small remaining budget defers a project without repeatedly paying for only its first document. Download and LLM budgets are shared across the whole batch, not per project.

Optional current-open acquisition uses the existing main processing pipeline:

```sh
npm run fiscal:backfill -- --apply --include-missing --download-open --max-downloads=1 --batch-size=5
```

`max-downloads` bounds project acquisition attempts, not individual HTTP requests: official verification and the normal pipeline may fetch an announcement, TOR archive, and retry endpoints. The ordinary pipeline may also call Vertex if it is enabled; `max-llm-calls` bounds only the fiscal backfill's additional LLM fallback, not full-pipeline summarization. Use the default stored-only command for a guaranteed no-new-Vertex run. Closed/unknown bidding never reaches acquisition. This flag does not authorize historical downloads.

## Limits

Coverage cannot exceed the evidence available in source documents. Records without retained text or accessible eligible PDFs cannot receive a guessed year. Uncertain software titles remain for classification review rather than being silently included. Offline tests cover idempotency, cache restoration, provenance, Thai digits, conflicts, historical-text reuse, dry-run isolation, budget preflight, API contract compatibility and refusal to download closed documents.

On 23 October 2026, the initial live preview was blocked by Atlas server selection. After the user restored Atlas access, a stored-text-only preview and apply succeeded in `moneytamngan`. Five current software projects had linked stored extraction runs: four supported fiscal years and one incomplete-document result were saved as five fiscal analyses and unified project caches.

| Project | Year | Status |
| --- | --- | --- |
| 69099439550 | 2569 | found |
| 69099617982 | 2570 | found |
| 66089621472 | 2565 | found (OCR review warning retained) |
| 66089621504 | 2565 | found (OCR review warning retained) |
| 68019088742 | null | document_unavailable (incomplete coverage and OCR review) |

The exact same batch was applied again: `changed:0`, zero errors, and fiscal analysis count stayed at five. Existing document summary count stayed at 17 and page count at 378. Both runs made zero downloads and zero new Vertex calls; existing grounded LLM evidence was reused. Fresh project reads and the API response mapper returned the same years/statuses.

At this check, 22 projects were marked software and 17 of them lacked current stored extraction-run pointers. These are not automatically eligible for new downloads: software classification, current official bidding status and document availability still control admission. Completing the stored-text backfill does not mean every software project now has an extracted year.
