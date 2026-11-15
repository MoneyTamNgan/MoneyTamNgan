# Draft editor and DOCX export implementation report

Issues #140 and #141 extend the existing bid preparation security layer into a usable personal draft workspace and a combined checklist/proposal document. The implementation preserves the existing generator API and queue, uses MongoDB ownership and version checks for stored edits, and exports plain-text OOXML without executing supplied markup. The changes are on a separate feature branch, with review and merge tracked independently.

## User workflow

1. Open a TOR and choose the new bid-preparation link, or visit `/bid-prep` and enter a project ID.
2. Create a draft to edit, or request an AI draft through the existing `/api/tors/{id}/proposal-draft` job API. AI generation still needs the worker. The workspace polls that owner's job, then imports its completed output into an owned saved draft.
3. Edit the title, sections, plain-text content and source references. Add/remove sections as needed. Each imported statement has its own section and its original TOR page or company-field source. User-created sections can record references explicitly.
4. Save to MongoDB. The response updates the visible version and last-modified time. A stale save returns 409 and leaves the local edits visible; it does not overwrite the newer server version. The editor offers an explicitly labeled reload/discard action.
5. Review the caller-specific checklist and any missing information. Export is disabled while there are unsaved changes. Standard `[to fill in]`/`[to fill in: ...]` placeholders are highlighted in the preview and summary. Missing sources/checklist pages also cause an export warning.
6. Confirm an incomplete export if needed. The downloaded DOCX retains highlighted placeholders, reference labels and human-review notices. It contains one checklist and proposal, not an e-GP submission.

The AI warning and non-submission notice are shown on the workspace and editor. The editor warning stays visible while scrolling. React text nodes, form controls and `<mark>` elements display text without rendering raw HTML. The mobile form stays clear of the fixed navigation rail; the checklist scrolls inside its own container.

## Storage and indexes

The existing `bid_prep_drafts` collection remains the only draft-content collection:

| Field | Meaning |
| --- | --- |
| `_id` | MongoDB draft identifier |
| `userId` | Owner from authenticated `session.sub`; immutable through the draft API |
| `projectId` | TOR identifier verified at creation; immutable through updates |
| `title` | Editable plain-text title |
| `sections[]` | Editable heading, body and source-reference strings |
| `version` | Positive version incremented after each successful conditional update |
| `createdAt`, `updatedAt` | Original creation and latest successful modification times |

The existing `{userId: 1, updatedAt: -1}` and `{userId: 1, projectId: 1}` indexes remain in the model; the model is already listed in `scripts/ensure-indexes.js`. No new draft collection or forced migration is introduced.

### Atomic draft quota

A count followed by an independent insert could previously overfill the last draft slot. Creation now runs in an Atlas transaction:

- Increment the authenticated user's internal `bid_prep_revision` field to serialize creations for that user.
- Count that user's existing drafts within the same transaction.
- Reject if the configured cap is reached; otherwise create the owned draft in the transaction.

Concurrent conflicts retry under MongoDB's transaction mechanism. The hidden revision is coordination metadata, not a saved-draft count, so deletions cannot cause counter drift. Existing users receive the field on first increment without migration. The default cap is 50, and `BID_PREP_MAX_DRAFTS` can lower it. The list endpoint returns at most 50 owned drafts.

Updates use one atomic filter containing `_id`, `userId` and `version`, then increment the version. Another owner's record returns 404, including attempts with an invalid version. Missing and foreign IDs share the same error. Versions protect overlapping writes; this phase does not retain a full history of previous edited text.

## Validation and privacy

| Limit | Value |
| --- | --- |
| Request JSON | 128 KiB |
| Draft title / section heading | 200 characters each |
| Sections | 40 |
| Body per section | 8,000 characters |
| Sources per section | 20 strings, up to 200 characters each |
| Total title, headings, bodies and sources | 100,000 characters |
| Drafts per user | 50 maximum, or a lower configured value |
| DOCX export | 2 MiB |

Wrong types and overlong fields are rejected rather than silently truncated. Text is trimmed and forbidden control/XML characters are removed. Sources and draft text remain plain strings. Unknown body fields cannot change ownership or TOR linkage. The export validates the saved draft again so a corrupt database record produces a clear error instead of an invalid document.

A meaningful body section is required for export; a title-only or empty draft returns `EMPTY_DRAFT`. The editor's save request carries the version. The optional export `version` query parameter rejects exporting a newer saved version than the one currently reviewed by the editor.

Every endpoint still uses the independent scope guard and existing FR-4.7 rate limits. Owners come from the authenticated session or scoped Bearer token, never a body/query user ID. Admin permissions do not bypass draft ownership. Another user's GET/PATCH/DELETE/export returns 404. Anonymous requests return 401. Cookies retain Origin checks.

Drafts are not cached in localStorage. Existing individual deletion removes the selected owner's document; the FR-4.7 company-data deletion action removes that owner's drafts and preserves other users. The existing account deletion flow continues to remove the account's drafts.

## API behavior

| Endpoint | Success | Selected errors |
| --- | --- | --- |
| `GET /api/bid-prep/drafts` | 200, owned summaries | 401, 403, 429 |
| `POST /api/bid-prep/drafts` | 201, saved draft | 400 invalid/quota, 404 TOR/user, 413 body/total text, 415, 429 |
| `GET /api/bid-prep/drafts/{id}` | 200, owned draft with notices/sources | 401, 404, 429 |
| `PATCH /api/bid-prep/drafts/{id}` | 200, incremented version | 400 invalid, 404 missing/foreign, 409 stale save, 413, 429 |
| `DELETE /api/bid-prep/drafts/{id}` | 200, deleted | 401, 404, 429 |
| `POST /api/bid-prep/drafts/{id}/export?version=N` | 200, binary DOCX | 400 empty/corrupt/version, 404 missing/foreign, 409 stale export, 413, 429 |

Example owned draft request:

```json
{
  "projectId": "BIDPREP-E2E",
  "title": "ร่างข้อเสนอระบบสารสนเทศ",
  "sections": [
    {
      "heading": "แนวทางดำเนินงาน",
      "body": "ดำเนินการตามขอบเขต TOR\n[to fill in: delivery plan]",
      "sources": ["tor.page.10", "profile.company_name"]
    }
  ]
}
```

A later PATCH includes the last returned `version` alongside the edited title/sections. Error responses use `{error: {code, message}}`, including `DRAFT_LIMIT`, `INVALID_DRAFT`, `DRAFT_NOT_FOUND`, `DRAFT_CONFLICT`, `EMPTY_DRAFT` and `PAYLOAD_TOO_LARGE`.

## Generator integration and source handling

`proposalToSections` maps the existing generator's `company_overview`, `project_understanding`, `scope_responses` and `past_projects` output into editable sections. TOR sources become `tor.page.N`; company sources become `profile.FIELD`. Missing facts stay as placeholders. Imports exceeding editor limits fail visibly instead of dropping statements.

The existing generator remains responsible for producing grounded AI output. Its queue, Vertex prompt and worker behavior were not replaced. The workspace polling stops when the page closes or after 15 minutes; an already queued server job can continue. The live editor integration test simulates the generator API response shape to avoid a cloud charge, then uses real owned storage. It does not claim a new live Vertex execution.

Sources apply to an entire editable section. Manual edits can change the claim, so the UI explicitly asks the user to recheck the references. Editing a source label does not automatically prove the new wording is supported.

## Combined DOCX format

The server reads the owned saved draft and builds the current owner's checklist. Checklist lookup uses the project's `latest_summary_id` when present. It retains the existing manual-comparison behavior; automatic eligibility rules belong to the checklist/comparison work, and `manual` is never presented as `pass`.

The file includes:

- A title, project ID, original creation date, last edit date and export timestamp in ISO format.
- The AI-draft warning and English/Thai notice that MoneyTamNgan does not submit to e-GP.
- A checklist table with requirement, status, reasoning and TOR source page.
- Missing profile fields and a warning when the checklist is truncated.
- Proposal headings, bodies and source references.
- Yellow/red highlights on unfilled standard placeholders.

Unavailable/unprocessed checklist data becomes an explicitly manual row with a placeholder and reason. Missing source pages stay visibly unfilled; the export does not fabricate a page or pass result.

The OOXML ZIP contains only `[Content_Types].xml`, package relationships, `word/document.xml`, internal document relationships and `word/styles.xml`. It has no macros, external relationships, executable fields, HTML or embedded remote content. Supplied markup is XML-escaped text; formula-looking strings are neutralized and remain text runs. The safe ASCII filename is sent in `Content-Disposition: attachment`, with the DOCX MIME type, `private, no-store` and `nosniff`.

A4 page dimensions and one-inch margins bound the checklist table to the printable width. Column widths are explicit, rows wrap/expand and the header repeats on later pages. Tahoma is requested as a Thai-capable font. The rendered sample was checked with the installed font available; another viewer still needs a suitable Thai font. **PDF export is not part of this release (#145).** A temporary PDF used for render QA is not an application export endpoint.

Successful exports emit the existing structured audit event with user ID, timestamp, IP and draft/project IDs. No draft content or company facts are included in that audit. Audit storage/forwarding is deployment logging; a new MongoDB audit collection is not introduced. Export rate limiting is inherited from the existing per-process FR-4.7 limiter; distributed deployments need a shared limiter for a cluster-wide limit.

## Verification and evidence

The reusable live command is:

```sh
npm run build
node scripts/test-bid-draft-editor-http.js /tmp/bid-draft-evidence
```

It creates an isolated `mtn_drafts_*` Atlas database, its own local Next server and a headless browser, then cleans up its own resources. It never scrapes government websites, sends emails or makes live Vertex calls.

The live checks passed:

- Eight concurrent creates under a cap of five produce exactly five drafts.
- Foreign read/update/delete/export are 404; anonymous draft endpoints are 401.
- Content limits, empty export and stale export return the expected errors.
- Two simultaneous saves using the same version produce one success and one 409.
- The editor adds/edits/saves/reloads real MongoDB content, shows references and highlights, and fits desktop/mobile screens.
- The confirmed browser download opens as a valid DOCX with Thai checklist data, reasoning, page references, draft sources and placeholders.
- A generator-shape fixture imports into real owned storage without losing references.
- Delete-all removes owner drafts and preserves the other owner's draft.
- The export audit contains metadata without draft content.

See [live HTTP evidence](evidence/bid-drafts/http.json), [desktop editor](evidence/bid-drafts/editor-desktop.png), [mobile editor](evidence/bid-drafts/editor-mobile.png) and the [sample DOCX](evidence/bid-drafts/sample.docx). All attached content is fictitious test data. The initial browser harness used DevTools response-body reconstruction, which yielded corrupt binary bytes; verification now checks both direct HTTP bytes and the actual downloaded file. Bounded test cleanup prevents browser/server shutdown from hanging. A precisely identified orphaned fixture from debugging was removed.

The sample was rendered with the bundled LibreOffice runtime. Its initial environment lacked the installed Thai font configuration; explicit font discovery resolved that, and the final page was visually checked for Thai glyphs, table fit and highlights. Native Word and browser control are unavailable, and no connected document session exists. The owner reviewed the sample and reported that it looked correct on 2026-11-15. No per-viewer screenshot was supplied, so **the requested native Word/Google Docs screenshot evidence remains pending**. A headless render is not labeled as a native-viewer screenshot.

## Acceptance status and follow-up

The application implementation, automated security/format checks and real Atlas/browser workflow are complete. After integrating the merged #136 company-profile work from develop, all 280 Node tests and 340 Vitest tests passed locally (620 total), along with the production build. Redocly validation passed with 9 nonblocking existing warnings, using the installed cached CLI after registry/cache lookup errors. CI results are tracked in the PR. Remaining acceptance is the native Word/Google Docs screenshot evidence, a non-author teammate's approval and merge into `develop`. No acceptance checkbox is marked complete solely on the basis of a test mock. The #136 company-profile changes are included from current develop and retain their existing API/form behavior. The separate SMTP setup card can continue independently.

### Upstream integration

Develop advanced to include PR #166 while this work was in progress. It was merged into the feature branch. The only textual conflict was the appended CSS; both scoped profile and draft rules were preserved. User schema and OpenAPI merged cleanly. The combined 620-test suite, build and OpenAPI lint passed; both live company-profile and draft/editor/export fixtures passed again before pushing the resolution. The company-profile regression evidence is in [company-profile-regression.json](evidence/bid-drafts/company-profile-regression.json).
