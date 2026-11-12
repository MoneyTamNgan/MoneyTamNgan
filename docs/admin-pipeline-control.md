# Admin pipeline control — issue #78

The canonical endpoint is **POST /api/admin/pipeline/trigger**. There is no `/api/admin/ingestion/trigger` alias. As confirmed by the owner, this card keeps the existing full runner: RSS/HTTP discovery, TOR/announcement acquisition with the existing Puppeteer fallback, OCR/Vertex, matching and notifications. It does not migrate the browser engine to Playwright.

## Behaviour

- An admin session with `admin:write` reserves the run in MongoDB, writes the audit, registers work using Next `after()`, and returns **202** before execution. `jobId`, the backward-compatible `runId`, and `startedAt` are top-level fields. The `run` snapshot and `statusUrl` remain compatible with AdminTorConsole.
- Missing/invalid authentication returns **401**; a normal user or pipeline-only token returns **403**. Proxy and the route guard independently enforce this. Browser mutations also require an approved Origin.
- One atomic MongoDB singleton `_id=admin_pipeline` excludes simultaneous triggers across processes. A second trigger receives **409 PIPELINE_ALREADY_RUNNING** and schedules no task. DELETE cannot reset an active job to bypass the lock.
- GET `/api/admin/pipeline/status` reads MongoDB rather than module memory. It reports idle/running/completed/failed, phase, progress, summary and last `startedAt`. A terminal reset preserves the last start time.
- The lease is renewed every 15 seconds and on progress. After 90 seconds without a successful renewal, GET/POST/DELETE recovers a running record to failed with `PIPELINE_INTERRUPTED`; a new trigger is then allowed. Owner fencing prevents obsolete callbacks from changing a newer job's state. No TTL index deletes failure evidence.
- Accepted, conflicting and invalid authorized trigger attempts are recorded in `pipelinetriggeraudits`: request ID, job ID when available, user ID/role, timestamp, IP, outcome and HTTP status. Denials at Proxy/handler are structured server-log events, avoiding database work for unauthenticated callers. No cookies, Authorization values, passwords, full request bodies or credentials are logged.
- If MongoDB, audit persistence or scheduling fails, the route fails closed with 503 and does not launch work. Public control errors are generic.
- The endpoint is always asynchronous. Existing `sync:false` requests work; `sync:true` returns 400. Raw `tenders` injection is rejected. `limit` is 1–50; departments are four digits; project IDs are eleven digits and cannot exceed limit. Bodies are bounded to 8 KiB.

## Storage and deployment

Two additive collections are introduced: `adminpipelinestates` for the singleton current status/lease and `pipelinetriggeraudits` for trigger history. Existing projects, documents, OCR and summaries keep their schemas. `npm run db:ensure-indexes` includes both models; MongoDB's built-in unique `_id` index is the lock boundary.

`after()` is not an external durable worker. Self-hosted `next start`/Docker keeps work in its server process; stopping that process interrupts work and lease recovery permits a manual retry. Serverless hosts may terminate background work at the route's 300-second platform limit. The controller also stops renewing jobs beyond its 30-minute budget. A long external operation already in flight can finish before a fencing checkpoint notices lost ownership; subsequent state writes and stage transitions are fenced. Retry-safe document persistence remains important. Complete old in-memory runs before the first rollout of this change.

## Response examples

Illustrative shapes (IDs/times are examples); the integration tests validate actual 202/409/200 responses against OpenAPI.

```json
{
  "status": "accepted",
  "jobId": "pipe_1794499200000_example-uuid",
  "runId": "pipe_1794499200000_example-uuid",
  "startedAt": "2026-11-12T16:00:00.000Z",
  "statusUrl": "/api/admin/pipeline/status",
  "message": "Data pipeline run started in background",
  "run": { "id": "pipe_1794499200000_example-uuid", "status": "running", "phase": "starting", "startedAt": "2026-11-12T16:00:00.000Z" }
}
```

The abbreviated `run` above also includes `completedAt`, progress, summary, error and errorCode in the actual response.

```json
{"error":{"code":"INSUFFICIENT_SCOPE","message":"Required permission is missing"}}
```

That response has HTTP status 403 for a non-admin session.

```json
{"status":"conflict","error":{"code":"PIPELINE_ALREADY_RUNNING","message":"A data pipeline run is already in progress"},"currentRun":{"id":"pipe_1794499200000_example-uuid","status":"running"}}
```

The 409 example abbreviates the same current-run snapshot. No second background callback is registered.

## Validation and evidence

Commands:

```sh
npx vitest run tests/unit/ingestion-trigger-route.test.js tests/integration/admin-pipeline.integration.test.js tests/integration/admin-pipeline-recovery.test.js tests/integration/admin-pipeline-execution.test.js
npm test
npm run test:vitest
npx @redocly/cli lint docs/api/openapi.yaml
npm run build
node scripts/test-admin-pipeline-http.js /tmp/admin-pipeline-evidence.json
```

The HTTP script uses its own localhost port 3127 and random `mtn_admin_test_*` database. It tests five independent MongoDB claimants, actual 401/403/409 responses, lease recovery, a real admin-session 202 followed by polling to completion, and durable audit provenance. Its explicit non-software fixture prevents government scraping, Vertex charges and email. It cleans up only its own server/database and never prints tokens. For running against a disposable local MongoDB instead of Atlas, provide `MONGODB_URI` in the command environment.

Local evidence so far: 29 targeted tests passed; 280 Node tests passed; 305 Vitest tests passed; production build and Redocly lint passed. The first live Atlas attempt was blocked by the IP/network allowlist; do not count it as a passed live/manual test. CI and Semgrep evidence are attached to the PR. Update this paragraph when the live check succeeds.

## Manual admin demo

1. Allow your current IP in Atlas and run `npm run dev`. Sign in through the real admin account (ADMIN_EMAILS alone does not turn an unverified password account into an admin).
2. Open `/admin` and use the existing pipeline button, or make this same-origin request from your app's browser console:

```js
const r = await fetch('/api/admin/pipeline/trigger', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({limit: 1})
});
console.log(r.status, await r.json());
```

3. Confirm 202, jobId and startedAt. Repeat while running: expect 409. Poll GET `/api/admin/pipeline/status` and observe progress until completed/failed. External government acquisition may fail independently; errors remain visible in the run summary.
4. Sign in as a normal user and repeat: expect 403. Sign out and repeat: expect 401.
5. In a disposable test environment only, interrupt a running server and restart it. After the last lease renewal +90 seconds, GET reports failed/PIPELINE_INTERRUPTED and a new trigger is permitted. Do not use DELETE as cancellation.
6. Inspect `adminpipelinestates` and `pipelinetriggeraudits`, and structured denial logs. Never paste session cookies or tokens into issue/PR evidence.

## Review / team acceptance

The PR closes #78 and includes this runbook and test evidence. A real teammate who is not the author must approve before merge to develop; author self-review/bot approval does not satisfy this card. The owner demo and any external STRIDE sheet update remain human acceptance items until evidence is attached. The separate STRIDE sheet link has been requested; the repository cross-reference is proposed in THREAT_MODEL.md without overwriting existing TH-2/TH-6 meanings.
