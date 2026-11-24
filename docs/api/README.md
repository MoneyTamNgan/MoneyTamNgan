# API Contract

SRS mapping: [traceability.md](../traceability.md). Design index: [design/README.md](../design/README.md). Main SRS: [MoneyTamNgan_SRS](https://docs.google.com/document/d/1_o6RmB_G54MWgXHGiePvBzy-vLkhECAzDnhtU15rz0A/edit).

[openapi.yaml](openapi.yaml) describes the implemented Next.js route handlers under
`app/api`. The local base URL is `http://localhost:3000/api`. Paths in the spec
are relative to that base URL, so `/tors` resolves to `/api/tors`.

## Endpoint status

The spec covers the current TOR, PDF summary, anomaly, analytics, authentication,
company profile, BidPrep, admin, pipeline, notification, and diagnostics routes.
Use the operation's description and `security` field to check its access rules.

Both `/api/profile` and `/api/profiles` are implemented. Use `/api/profiles` for
the profile example below. `/api/auth/google/login` is a compatibility alias
for `/api/auth/google/start`. The combined admin pipeline runs asynchronously
through `POST /api/admin/pipeline/trigger` and exposes its state through
`GET /api/admin/pipeline/status`. The standalone ingestion, scraping, and
processing routes have their own paths and authorization rules.

## View and validate

Run these commands from the repository root after installing dependencies.

```sh
npx @redocly/cli lint docs/api/openapi.yaml
npx vitest run tests/contract
```

To render the API reference, generate the HTML and open it in your browser.

```sh
npx @redocly/cli build-docs docs/api/openapi.yaml -o docs/api/preview.html
```

## Example requests and responses

The spec contains example JSON request bodies and responses for these operations.
The sample account, project IDs, and draft IDs are illustrative. Use an account
and records from your local environment when sending requests.

| Area | Example request | Response |
| --- | --- | --- |
| Auth | `POST /api/auth/login` with `identifier`, `password`, and optional `next` | `200` with `user` and `redirectTo`, plus an HTTP-only `mtn_session` cookie. Invalid credentials return `401`. |
| TORs | `GET /api/tors?isSoftware=true&page=1&limit=1` | `200` with pagination and matching TOR records. This request can be made as a guest. |
| Profiles | `PATCH /api/profiles` with `company_name`, `skills`, or `past_projects` | `200` with the updated profile in `data`. A supplied `past_projects` array replaces the previous array. |
| Admin pipeline | `POST /api/admin/pipeline/trigger` with `limit` and optional `projectIds` | `202` with the run ID and `statusUrl`. Follow that URL with `GET` to read `run.status` and `run.progress`. |
| BidPrep generation | `POST /api/tors/69110000001/proposal-draft` with no body | `202` with a `jobId`. Pass it as `?jobId=...` in a `GET` to the same path to read the job status. |
| BidPrep drafts | `POST /api/bid-prep/drafts` with `projectId`, `title`, and `sections` | `201` with the saved draft and `version`. Send the latest `version` to `PATCH /api/bid-prep/drafts/{id}`. A stale version returns `409` with `DRAFT_CONFLICT`. |
| BidPrep checklist | `GET /api/bid-prep/tors/69110000001/checklist` | `200` with the checklist and item IDs. To set an override, `PATCH` the same path with `itemId` and `status`. |
| BidPrep export | `POST /api/bid-prep/drafts/6550f1b2d4e6a7c809123458/export?version=1` | `200` with a DOCX attachment when the complete checklist has passed. An incomplete checklist returns `409` with `CHECKLIST_NOT_PASSED`. |

TOR search also accepts `q` and the inclusive `budgetMin` and `budgetMax`
filters. Use `pageSize` for `/api/analytics/search`. Analytics overview accepts
`limit` or its `pageSize` alias.

Send `Content-Type: application/json` with JSON bodies. Include
`Origin: http://localhost:3000` for local sign-in and session-cookie mutations
when testing outside the browser. Reuse the login cookie on subsequent calls.
Operations that allow a scoped JWT can also use `Authorization: Bearer <token>`.
The combined admin pipeline requires the admin role and `admin:write` to start a
run or `admin:read` to poll it. Profile and BidPrep requests use the signed-in
user as the owner.

## Error responses

Most JSON errors use the `Error` schema. For example, requesting a missing TOR
with `GET /api/tors/missing-tor` returns HTTP `404` with this body.

```json
{
  "error": {
    "code": "TOR_NOT_FOUND",
    "message": "No TOR exists with id: missing-tor"
  }
}
```

Use the HTTP status and `error.code` for client logic. Use `error.message` for
display. The operation's response description lists its structured error codes.
Profile validation can include `error.fields` with messages keyed by
field name. Pipeline errors can include `status` and, on a conflict, `currentRun`.
Some existing operations use the `MessageError` schema (`{ "error": "..." }`),
and Google OAuth routes can return redirects or HTML. Follow the response schema
for the specific operation and status. For `429` responses with `Retry-After`,
wait the indicated number of seconds before retrying.
