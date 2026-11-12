# BidPrep FR-4.7 security and privacy

Issue #142. The live Next.js routes are under `/api/bid-prep` and the existing profile routes. Nothing in this surface submits a bid to e-GP. The seller reviews the draft and submits it with their own digital signature. That sentence is on the profile page, the TOR page, every draft and checklist response, and inside the DOCX export.

Draft generation itself is issue #139. Before it calls Vertex it must use `consumeBidPrepLimit('draft-create', session.sub)` and `buildVertexBidPayload` so the hourly quota and the field allowlist stay in one place.

## Endpoint, control, test

| Issue | Endpoint | Login | Limit | BOLA rule | Test |
|---|---|---|---|---|---|
| #136 | `GET /api/profiles` | 401 | `profile` per minute | `session.sub` only | `tests/integration/profiles-route.integration.test.js`, `tests/security/bid-prep-access.test.js` |
| #136 | `PUT/PATCH /api/profiles` | 401 | `profile` per minute | body user id ignored | `tests/integration/scoped-profile-route.integration.test.js` |
| #136 | `DELETE /api/profiles` | 401 | `profile` per minute | deletes that account and its drafts | profiles route test (audit record) |
| #142 | `DELETE /api/bid-prep/data` | 401 | `delete` per hour | clears only the caller's company fields and drafts, then re-reads | `deletes only the caller company data` |
| #140 | `POST /api/bid-prep/drafts` | 401 | 5 / hour (`BID_PREP_DRAFTS_PER_HOUR`) | owner is `session.sub` | `stores the session subject` |
| #140 | `GET /api/bid-prep/drafts` | 401 | `read` per minute | list is filtered by `session.sub` | same |
| #140 | `GET/PATCH/DELETE /api/bid-prep/drafts/{id}` | 401 | read or write | another user's id is 404 | same |
| #141 | `POST /api/bid-prep/drafts/{id}/export` | 401 | `export` per hour | another user's id is 404; file is plain text | same, plus `bid-prep-privacy.test.js` |
| #138 | `GET /api/bid-prep/tors/{projectId}/checklist` | 401 | `read` per minute | query `userId` ignored; profile is `session.sub` | `builds a checklist from the caller profile only` |

Mutations are `POST`, `PUT`, `PATCH` or `DELETE` with `Content-Type: application/json` and an allowed `Origin` (cookie sessions). A bearer token follows the existing machine-client rule. Errors use `{ error: { code, message } }` and the 500 message is fixed. `Retry-After` is set on 429.

Comparison of TOR qualifications stays `manual` here. Issue #137 owns the rules. This endpoint does not answer `pass` by guessing.

## Personal data

| Data | Purpose | Retention |
|---|---|---|
| Account email, username, name | Sign in and show who is logged in | Kept with the account. Not sent to Vertex. |
| Password hash | Email/username login | Kept with the account. Never logged or returned. |
| Company name, skills, capital, past-project value, capacity, certifications | Match a TOR and fill a draft | Until the user deletes company data or the account. |
| Registration number, address, authorized signatory, past projects (FR-4.1, when stored) | The same bid draft | Removed by the same delete, including fields not yet on the schema. |
| Proposal draft text and sources | The user edits and exports them | Until that draft or all company data is deleted. |
| Audit record: user id, ISO-8601 time, client address, draft id, project id | Draft created, exported, or data deleted | Operational log only. No draft text, profile or secret. |

The customer has not confirmed a retention period (SRS sign-off is #143). No automatic expiry is applied, and this file must be updated when they give one. Do not invent a period.

## Vertex and logs

`buildVertexBidPayload` sends the TOR summary, scope, qualifications and tech stack, plus the company fields a draft needs (including the signatory name and past projects limited to name, client, value and year). Email, username, Google id, picture, role and credentials are dropped. TOR text is wrapped as untrusted data with fixed instructions outside the delimiter.

`logBidPrepAudit` accepts only `userId`, `draftId`, `projectId`, `scope` and `draftsDeleted`.

## Real Atlas check

CI does not have Atlas credentials, so `npm run test:vitest` covers the controls with the route handlers and an in-memory stand-in. The check that reads and writes the project cluster is separate and refuses anything that is not Atlas:

```bash
npm run test:bid-prep-atlas
```

It reads `MONGODB_URI` from the environment or an uncommitted `.env`, creates `mtn_bidprep_test_<time>_<random>`, and drops only that database. It does not print the URI.

## Hand test

1. Sign in, open `/profile`, and confirm the note that the system does not submit to e-GP.
2. Save a company name. `DELETE /api/bid-prep/data` with `{ "confirm": "DELETE_COMPANY_DATA" }`, or use **ลบข้อมูลบริษัท**. Reload the page. The company fields are empty and the account still works.
3. `POST /api/bid-prep/drafts` for a processed TOR. With a second user, `GET` that draft id and expect 404.
4. `POST /api/bid-prep/drafts/{id}/export` and open the DOCX. It says the file is a draft and that the seller submits to e-GP.
5. Repeat draft creation until the hourly cap. Expect 429 and `Retry-After`.
