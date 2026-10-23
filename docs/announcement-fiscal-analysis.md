# Fiscal-year analysis from announcement PDFs

Announcement PDFs now use the same `extractPdfText` embedded-first/Tesseract fallback and `extractTorWithVertex` grounded regex/LLM fiscal-budget pipeline as TOR PDFs. The main project worker invokes this path for linked announcements without an announcement summary. Only verified-open software procurements may enter it. The recovery planner can also identify missing announcement analysis on otherwise summarized projects.

## Storage

Canonical history remains in the existing normalized collections:

- `documents`: linked announcement PDF URL/hash; no retained source PDF by default.
- `extractionruns` and `documentpages`: immutable run identity and page-numbered announcement text.
- `documentsummaries.extraction.fiscal_budget`: year, evidence and regex/LLM methods, alongside the announcement summary.

Separate project pointers prevent announcement analysis from replacing TOR content:

```text
projects.announcement_document_id
projects.announcement_extraction_run_id
projects.announcement_summary_id
projects.announcement_fiscal_budget        (current-result read cache)
projects.announcement_analysis             (independent status/error)
```

The TOR pointers (`primary_document_id`, `latest_extraction_run_id`, `latest_summary_id`) and TOR risk cache are not modified by announcement analysis. Role-specific OCR/page/pointer writes and summary/cache/pointer writes use the same Mongo transaction helpers as TOR analysis, guarded against concurrent document changes. A changed announcement clears its old pointers/cache; a mismatched download hash requires refreshing discovery instead of attaching evidence to the wrong PDF.

The API compatibility layer uses announcement fiscal data only when the TOR has no extracted fiscal years and the announcement cache's document/run/summary provenance matches current pointers. This makes it available at `extracted_data.fiscal_budget` and TOR Detail's `fiscalBudget`, tagged `source: announcement`. It does not fabricate a full TOR summary when only an announcement has been processed.

Cached runs avoid another download/OCR; cached matching model/prompt summaries avoid another Vertex call and are not rewritten. With Vertex disabled, regex evidence and page text can still be retained as `ai_pending`. Empty/unreadable text returns `review_required` and an explicit `not_found`, without a Vertex call. Operational errors remain retryable. A fiscal year is never inferred from a project ID or bidding date.

## Live run, 20 October 2026 (Bangkok)

The earlier open-bidding examples `69099670517` and `69099668649` were construction procurements and were not processed. Two software-related procurements with future deadlines were selected instead. Current open bidding was verified through official announcement content before analysis.

| Project | Bidding closes (Bangkok) | Extracted fiscal year | Announcement summary |
| --- | --- | --- | --- |
| 69099617982 | 22 October 2026, 12:00 | 2570 | 6ad6f96961bb6af430155dc4 |
| 69099439550 | 21 October 2026, 12:00 | 2569 | 6ad6f97261bb6af430155dcc |

Both official announcement PDFs had two pages with usable embedded text; OCR fallback was not needed (`ocr_pages: 0`). Fiscal evidence on page 1 was confirmed by both regex and a live Vertex call. Results and page text were written to `moneytamngan` in Atlas, and the project read cache and API fiscal projections were verified afterward. Neither record had primary TOR pointers; those remain absent rather than being replaced by announcement pointers.

The first overall announcement summary has confidence 0.7 and remains `review_required` under the existing 0.8 threshold; its fiscal year is supported by explicit matching regex/LLM evidence. The second summary completed at confidence 1.0. The live run does not claim successful TOR/ZIP retrieval for either project.

## Running

```sh
npm run announcement:analyze -- 69099617982 69099439550
```

This command refreshes announcement discovery, verifies admission, writes to the configured database, and may incur Vertex charges when enabled. Normal queued `process_project` jobs use the same service. Do not run it indiscriminately across ended/non-software records.

For Atlas, open `moneytamngan.projects` and filter:

```json
{"project_id":{"$in":["69099617982","69099439550"]}}
```

Inspect `announcement_fiscal_budget`, or follow `announcement_summary_id` into `documentsummaries` and expand `extraction.fiscal_budget`.
