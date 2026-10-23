# Admin low-confidence TOR review

```http
GET /api/admin/classification/queue?page=1&pageSize=20&confidenceType=either
```

- Fixed threshold: numeric confidence **strictly below 0.70**. Exactly 0.70 is excluded.
- `confidenceType`: `either` (default), `classification`, or `extraction`.
- `either` uses the minimum of the available valid scores and returns both scores separately. Unknown/null, negative, >1, string and NaN scores do not become artificial zero-confidence findings. A genuine numeric zero is valid.
- Classification uses `classification.confidence`, with a legacy `classification_confidence` fallback.
- Extraction uses only the linked current primary TOR summary, validated against project, primary document, extraction run and document SHA. Legacy `processing.confidence` is used only when normalized primary/summary references are absent. Announcement confidence is not mixed into primary TOR confidence.
- Classifier-negative and uncertain records are included when their known score qualifies, since manual review can correct false negatives. No extra software-only restriction is silently applied.

## Authentication

Both the Next proxy and the route itself require either a signed `mtn_session` with `role: admin`, or `Authorization: Bearer <PIPELINE_ADMIN_TOKEN>`. The operator token must be explicitly configured and at least 32 characters long. Arbitrary bearer strings, forged role headers, ordinary user sessions and expired sessions are rejected. Authentication happens before database access. Responses are private/no-store.

The existing broader `GET /api/processing/review` is also admin/operator-only now. Its existing general review/failed-status selection and project-shaped response remain unchanged; use the new endpoint for the strict confidence threshold and compact payload. Public TOR browsing and processing-status reads remain unchanged.

Example request from an operator shell (use your configured token, do not commit it):

```sh
curl -s 'http://localhost:3000/api/admin/classification/queue?page=1&pageSize=20&confidenceType=either' \
  -H "Authorization: Bearer $PIPELINE_ADMIN_TOKEN"
```

An admin browser session sends its existing cookie automatically. The existing static operator token is not a Firebase/GCP access token and is not an arbitrary session JWT passed in a Bearer header.

## Response

```json
{
  "items": [{
    "projectId": "example",
    "projectTitle": "ชื่อโครงการ",
    "issuingAgency": "หน่วยงานเจ้าของโครงการ",
    "titleSource": "government_metadata",
    "agencySource": "government_metadata",
    "classificationTags": ["software"],
    "isSoftware": true,
    "classificationStatus": "software",
    "confidenceScore": 0.65,
    "confidenceScores": {"classification": 0.65, "extraction": 0.9},
    "reviewReasons": ["low_classification_confidence"],
    "primaryPdfUrl": "https://official.example/tor.pdf",
    "primaryDocumentUrl": "https://official.example/tor.pdf",
    "primaryDocumentType": "pdf",
    "primaryPdfEntryName": null,
    "processingStatus": "review_required"
  }],
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "threshold": 0.7,
  "confidenceType": "either"
}
```

The example is illustrative. Titles/agencies prefer existing extracted fields when present; otherwise they come from government procurement metadata and are labeled accordingly. This GET does not download/OCR/re-extract titles or call Vertex. No missing title, agency, confidence or PDF URL is invented.

If the primary PDF only exists as an entry in an e-Bidding ZIP/RAR source, `primaryPdfUrl` is null, `primaryDocumentUrl` is the archive URL, and `primaryDocumentType: archive` / `primaryPdfEntryName` identify the source and PDF entry. This respects link-only retention; there is no retained PDF hosting endpoint to fabricate. Missing primary documents return null links. Executable URLs and stale legacy URLs for an invalid normalized pointer are not exposed as PDF links.

## Pagination and validation

Page numbers are integers 1..1,000,000; page sizes 1..100 (default 20). Invalid inputs return 400. Sorting is lowest selected score first, newest update next, then `_id` for stable ties. Count and paginated items are produced in one aggregation facet after confidence filtering. An out-of-range page has no items but retains the actual total. As the live worker changes confidence values, results may naturally change between requests; this is not snapshot pagination across separate HTTP calls.

## Verification

Unit/route/proxy tests cover authentication, score selection, pagination, link mapping, parameter limits and the API contract. `node scripts/test-low-confidence-review.js` runs controlled MongoDB fixtures in a uniquely named isolated Atlas database. It checks the exact 0.70 boundary, zero/missing/invalid/NaN scores, stale document/run/hash references and page boundaries, then removes only its own fixture database. It never downloads PDFs or calls Vertex.
