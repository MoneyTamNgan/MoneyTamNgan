# Resumable processing and backlog recovery

## Main pipeline

Government API ingestion → software candidate → queued official verification → verified-open project → unique `process_project` job → announcement schedule → TOR acquisition or existing document → OCR/embedded text → Vertex → normalized summary/history and current project pointers.

API ingestion now defaults `enqueueProcessing` to true. Explicit false preserves ingestion-only mode. RSS ingestion also queues processing by default; `--no-enqueue` opts out. Existing paired RSS documents without a summary no longer skip the processing handoff. A worker must still be running: the web server does not execute queued jobs.

## Recovery entry points

The same recovery service is used by the CLI, bulk `/api/processing/trigger`, and idle watch workers. It scans a bounded descending `_id` page, reports project/workflow statuses and skip reasons, and enqueues through the existing unique active-job key. `document_downloaded` projects are included. Already summarized, terminal/manual-review, non-software and uncertain classifications are not blindly reprocessed.

The cursor is an ObjectId, not an offset or timestamp. This ordering is deliberately stable for pagination; it need not match an imported record's `created_at`. Follow `nextAfterId` until `exhausted` is true. A page may queue nothing but still have more records to scan. `batchSize` caps new scheduling attempts; `scanLimit` caps records inspected.

For new acquisition, known closed/not-yet-open procurements are skipped. Unknown eligibility can be queued **for verification**, not admitted directly to OCR. The existing worker rechecks current official eligibility before new acquisition. Matching durable OCR can finish Vertex analysis after closure without downloading a new TOR, preserving existing pipeline behavior.

Matching documents/OCR/summaries continue to use the worker's existing hash, run and prompt identities. Recovery does not overwrite OCR history or force model/prompt upgrades. A non-null summary pointer is preserved; explicit single-project processing/reanalysis remains available for intentional reruns or repairing pointers.

## Commands

Read-only preview (no job/project writes, keyword seeding, government requests or Vertex calls):

```sh
npm run processing:recover -- --batch-size=5 --scan-limit=240
```

Queue up to five candidates after inspecting the preview, then run the existing worker:

```sh
npm run processing:recover -- --apply --batch-size=5 --scan-limit=240
npm run worker
```

`npm run worker:once` still processes one existing queued job and does not auto-scan the backlog. `npm run worker` watches continuously. While idle, it scans up to 100 projects and queues at most 10 per 60-second interval, retaining its cursor between sweeps. It does not start a scheduler or provision an always-on server for you. Restarting a worker restarts its scan; active-key uniqueness and prior attempts prevent duplicate work.

Environment controls:

```dotenv
WORKER_RECOVERY_ENABLED=true
WORKER_RECOVERY_INTERVAL_MS=60000
WORKER_RECOVERY_BATCH_SIZE=10
WORKER_RECOVERY_SCAN_LIMIT=100
```

Set `WORKER_RECOVERY_ENABLED=false` to keep the previous queue-only watch behavior. These controls apply to watch mode only. Vertex remains gated by `VERTEX_AI_ENABLED=true` and valid cloud credentials. Running the watch worker can now resume backlog work and incur Vertex costs when enabled.

Bulk HTTP requests remain protected by the existing processing-route access controls:

```json
{"batchSize":5,"scanLimit":240,"dryRun":true}
```

Omit `dryRun` or set it to false to enqueue; supply the returned `nextAfterId` as `afterId` to continue. Explicit `projectId` and `candidateId` requests retain their existing behavior and worker safeguards. Combining them with bulk-only options is rejected, so a caller's dry-run is never silently turned into a write.

## Retry and review controls

- Existing queued/running jobs are reused; the worker's leases and retries are unchanged.
- Exhausted failed jobs require `--retry-failed` or bulk `retryFailed:true`; no automatic infinite retry loop.
- Recent completed attempts have a 24-hour cooldown before recovery can schedule them again. Explicit retry bypasses this cooldown; scheduling still uses all classification/closure/review safeguards.
- `ai_pending` with durable OCR waits if Vertex is disabled. Enabling Vertex permits immediate resumption, including within the cooldown.
- Unreadable documents and other manual-review states remain visible rather than being retried endlessly.
- Recovery failures are reported per project. A failed sweep does not stop the watch worker from processing existing jobs.

## Verification

Offline tests cover recovery planning, closed/non-software/manual exclusions, downloaded-document recovery, read-only preview, duplicate prevention, cursor progress, cooldown, explicit retries, API default/opt-out behavior, idle sweeps, and a catch-up → existing queue → existing OCR/Vertex pipeline → summary-write handoff. External OCR/Vertex and Mongo persistence in that handoff are controlled test doubles; it is not a new live government-PDF end-to-end test.

A read-only Atlas planner check on 2026-10-20 scanned 240 records in descending `_id` order. It identified five candidates pending official verification (three acquisition and two existing-document paths), skipped ten closed procurements, 112 non-software and 113 uncertain classifications, and reported zero errors. This sample is not necessarily the same batch as an earlier check ordered by `created_at`. No production jobs were queued or summaries generated by this check.

Limitations: government availability and OCR accuracy are unchanged. Uncertain software records need classification review; the recovery service intentionally does not widen admission to make counts look complete. Backlog processing is not guaranteed to produce a summary for every project, and queuing is not proof of successful extraction.
