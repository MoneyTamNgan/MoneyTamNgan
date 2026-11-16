# Past-project minimum from extracted qualifications

## Run it

For an existing TOR with a saved `DocumentSummary`, run this from the repo root:

```powershell
npm run vertex:past-project -- 69099360837
```

The command prints the summary ID and the enrichment result. It uses the current summary in the configured MongoDB database. It only calls Vertex if the qualifications contain `มูลค่า` and that summary's qualification set needs enrichment. Use the existing Google Cloud project and Application Default Credentials for that call.

The worker runs the same step automatically after saving or reusing a primary TOR summary when `VERTEX_AI_ENABLED=true`. Restart a running worker after updating the code. `npm run vertex:reanalyze -- PROJECT_ID` also runs the step after the normal analysis and includes the outcome under `pastProjectEnrichment`. If the extra Vertex request fails, the normal summary stays saved. The next processing run or standalone command can retry it.

## How the minimum is extracted

1. Read `DocumentSummary.extraction.qualifications`. Send each full qualification whose `value` contains the literal Thai text `มูลค่า` to Vertex with an ID and its recorded page.
2. Ask Vertex for the monetary minimum attached to the bidder's past work, the operator (`>=` or `>`), the qualification ID, and the exact supporting quote. Registered capital, net worth, current bid prices, scoring weights, and lookback periods are separate figures.
3. Verify the quote, amount, and operator against the stored qualification. Copy the page from the qualification record. For TOR `69099360837`, the saved page 6 qualification gives **฿4,500,000 or more**. The five-year lookback is a separate condition.
4. Save `extraction.past_project_requirement` on the same summary with `source: 'qualifications'`. The enrichment version and hash of the qualification content determine whether a result can be reused.

| Result | Meaning |
| --- | --- |
| `found` | The extracted qualification supports a single monetary minimum. |
| `not_stated` | The available qualifications did not yield a prior-work minimum. |
| `manual_review` | Qualification data is missing or the amount could not be verified. |
| `pending_extraction` | The comparison is waiting for this enrichment to finish. |

The company-value comparison uses qualifying enrichment results. Its evidence quotes the extracted qualification and links to its recorded PDF page.

## Local verification

```powershell
node --test tests/unit/past-project-qualifications.test.js tests/unit/ocr-pipeline.test.js tests/unit/vertex-reanalysis.test.js
```
