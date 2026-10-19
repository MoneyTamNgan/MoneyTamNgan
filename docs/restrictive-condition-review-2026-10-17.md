# Restrictive-condition review

Implemented on `develop-api_database`; prompt version `tor-thai-risk-fiscal-v7`.

## Behavior

Vertex reviews readable TOR text for existing tenure, hardware and vendor restrictions, including proprietary partner/certificate requirements without equivalents. The new `excessive_team_capacity` category compares explicit staffing requirements with the visible scope, duration and workload. A large number alone is not sufficient evidence.

Findings are potential restrictions for human review, not legal conclusions. Explanations are concise Thai summaries with source quotations and page numbers. Quotations not found in the supplied source page are excluded and recorded as analysis warnings.

## MongoDB storage

- `projects.flagged_clauses`: bounded current-result cache containing clause text, reason, explanation, highlight reason, page, category, severity and confidence.
- `projects.flagged_clauses_meta`: summary/document/extraction provenance, prompt/model, coverage status, skipped pages, warnings and truncation information.
- `documentsummaries.extraction`: complete versioned findings and coverage; remains the canonical history.

The project cache is updated transactionally with the latest summary pointer and cleared when its document or extraction changes. Cached-summary retries restore the cache without another Vertex call. It is capped at 100 findings and bounded text lengths; metadata reports truncation, while the canonical summary retains the complete result.

## Missing or unreadable content

Blank pages and unusable text are excluded from Vertex input. Readable sections of mixed pages remain available, and original page numbers are preserved. Raw OCR storage is unchanged. Partial coverage requires review. If nothing is readable, processing returns `review_required` without calling Vertex or creating an empty summary.

This does not mask operational failures: OCR/rendering failures, missing tools, authorization errors, network failures and invalid model responses still use the existing error/retry behavior. Missing sections cannot be assessed; their absence never proves compliance.

## Validation

155 backend tests passed and the production build passed. A live Gemini/Atlas test used a controlled text fixture, not a government PDF: it produced two vendor-lock-in findings and one excessive-team-capacity finding, parsed fiscal year 2570, and recorded two skipped pages. It verified direct project storage, summary provenance, cached retry without another AI call and an all-unreadable case without an empty summary.

The isolated test database is `mtn_risk_review_mvcbhlm1`. Inspect `projects` with:

```json
{"project_id":"risk-fixture-mvcbhlm1"}
```

Production records were not changed by this live test. It validates Vertex and persistence integration, not real-PDF OCR accuracy or government scraping availability.

## Running it

Reanalyze an existing project's stored OCR text (writes to the configured database and may incur Vertex charges):

```sh
npm run vertex:reanalyze -- PROJECT_ID
```

Existing records are not automatically backfilled. The new prompt version creates a new summary rather than silently reusing an older prompt's result. Normal pipeline runs use the same implementation.

Repeat the isolated integration test:

```sh
node scripts/test-restrictive-review.js
node scripts/test-restrictive-review.js --live-vertex
```

The live option calls Vertex and retains an isolated test database for inspection. Assessments remain dependent on readable source evidence and model judgment; completeness and perfect restriction detection are not guaranteed.
