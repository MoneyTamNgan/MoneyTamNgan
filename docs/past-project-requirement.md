# Past-project minimum from extracted qualifications

## Run it

New summaries start with `extraction.past_project_requirement` set to `pending_extraction`, with `minimum_baht` and `operator` set to `null`. The extractor replaces the pending status when it runs. Results with no verified amount keep both value fields set to `null`.

To add the fields to existing MongoDB summaries, run:

```powershell
npm run vertex:past-project -- --initialize
```

This fills missing fields and preserves saved values. It uses MongoDB only and prints counts for the fields it added.

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

## Bid-preparation checklist

The checklist checks the monetary minimum in a separate **ตรวจเฉพาะมูลค่าผลงานที่ผ่านมา** row. It matches the saved quote and page to a single qualification and displays the full qualification as a manual row. Compare the highest valid value in `past_projects`, using `highest_past_project_value` if no project record provides a usable value. An inclusive threshold accepts equality and a strict threshold requires a higher value.

Missing company values and flagged or low-confidence source qualifications stay manual. Without a verified and uniquely matched minimum, the checklist displays the original manual qualification rows. The separate value card can still show the amount and source for review. Lookback periods, contract count, certifications, registered capital, and other conditions require manual checks. Dashboard ranking and notification thresholds use the existing tech-stack score.

| TOR | Saved extraction | Checklist with a sample ฿5,000,000 company value |
| --- | --- | --- |
| 69099360837 | At least ฿4,500,000, page 6 | The value row passes when the source is clear. The full qualification, including the five-year lookback, stays manual. |
| 69109345522 | No minimum stated | Original qualification rows stay manual. |
| 69109115904 | Minimum requires review | Original qualification rows stay manual. |

To check through the API, sign in with a company profile and open `GET /api/bid-prep/tors/69099360837/checklist`. Inspect `items`, `summary`, and `evidencePages`. The Bid Prep draft checklist and DOCX export use these same items.

On the TOR detail checklist, use **กำหนดสถานะเอง** to save a status for one item. The checklist totals, Bid Prep draft, and DOCX use the saved status for the signed-in user. Choose **ใช้ผลจากระบบ** to clear the override. The API accepts `PATCH /api/bid-prep/tors/{projectId}/checklist` with `itemId` from the checklist response and a `status` of `pass`, `fail`, `manual`, or `null` to clear.

## Local verification

```powershell
node --test tests/unit/past-project-qualifications.test.js tests/unit/ocr-pipeline.test.js tests/unit/vertex-reanalysis.test.js
node --test tests/unit/bid-prep-checklist.test.js
```
