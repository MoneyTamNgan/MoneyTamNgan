# TOR past-project value comparison

The worker reads embedded PDF text or OCR and stores page text in `documentpages`. The TOR extractor scans the readable pages for Thai past-work, minimum and currency cues. It includes likely clauses and adjacent page fragments in the existing Vertex requests. The prompt also asks Vertex to scan for prior-work minimums when there are no keyword hits.

The extractor verifies the reported page, quote, amount in baht and comparison operator against the source text. It supports Thai and Arabic digits, grouping separators, baht and Thai scale words such as ล้านบาท. Amounts expressed as percentages, combined values, conflicting clauses and incomplete evidence require manual review. The procurement budget, reference price and registered capital are separate figures.

Results are versioned at `documentsummaries.extraction.past_project_requirement`. A successful result contains `minimum_baht`, `operator` and `evidence` with page numbers and quotes. The current project points to the new summary through `latest_summary_id`.

| Result | Meaning |
| --- | --- |
| `found` | The source supports one explicit monetary minimum. |
| `not_stated` | The qualifications are readable and the scan found no minimum. |
| `manual_review` | The text, amount or comparison is unclear. A wholly unreadable OCR run is shown for review using the pipeline's existing unreadable status. |
| `pending_extraction` | The existing summary predates this extractor. |

The signed-in checklist request reads the saved amount and compares it to the highest value in the caller’s `past_projects`, using `highest_past_project_value` when no recorded project value is available. Equality meets an inclusive minimum and falls short of a strict minimum. Missing company data leaves the comparison blank. The TOR detail page shows the amounts and cites the PDF. Qualification decisions stay in the manual checklist.

## Run for one existing TOR

Configure `MONGODB_URI`, the intended database, `GOOGLE_CLOUD_PROJECT` and Google Application Default Credentials. Use a TOR that already has a completed OCR run with stored pages.

```powershell
npm run vertex:reanalyze -- PROJECT_ID
```

Replace `PROJECT_ID` with the TOR’s ID. The command writes a new versioned summary on its first run for the current OCR and prompt version. It prints the `pastProjectRequirement` result and summary ID. Add `--full` to see the complete extraction. Subsequent runs can reuse the saved version.

If the TOR lacks an OCR run or needs the PDF processed again, queue it through the existing [processing trigger](reference.md) and start the worker with `VERTEX_AI_ENABLED=true` in its environment. The worker reads the original PDF and runs the same extractor.

```powershell
npm run worker
```

Start the app with `npm run dev`, sign in, and open `/tors/PROJECT_ID`. The card reads `GET /api/bid-prep/tors/PROJECT_ID/checklist`. Update a past-project value in the company profile and reload the TOR page to verify the comparison changes.

## Local verification

```powershell
node --test tests/unit/past-project-requirement.test.js
npm test
npm run test:vitest
```

For a live check, select three TORs with stored pages, covering a clear minimum, no stated minimum and a clause that needs review. For each, record the project ID, page, source quote and saved status printed by the command. Confirm the result against the original PDF.
