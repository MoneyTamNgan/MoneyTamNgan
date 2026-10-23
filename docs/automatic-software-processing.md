# Automatic processing after software verification

Confirmed software is scheduled through the existing unique `process_project` queue. The HTTP request never performs OCR, downloads or Vertex analysis inline.

Already supported: API ingestion (unless `enqueueProcessing:false`), RSS ingestion (unless `--no-enqueue`), verified discovery-candidate promotion, and idle watch-worker recovery.

Added: manual `PATCH /api/projects/:id/classification` approvals and software results from `POST /api/admin/classification/run` now immediately enqueue processing. Manual approvals also reset a stale verification/review workflow to `document_pending`, so an old review marker cannot strand newly approved work. Non-software rejection and uncertain classifications do not enqueue new processing. The worker continues to recheck classification and current official bidding eligibility; confirming software is not permission to download closed tenders.

The manual endpoint preserves the existing project response on success. If queue creation fails after classification was saved, it returns 503 with `CLASSIFICATION_ENQUEUE_FAILED` and `classificationSaved:true`; retrying is safe because active jobs are deduplicated. A bulk rerun reports `jobsQueued`, `jobsReused`, `queueFailures` and bounded `queueErrors`, and continues other projects after an individual queue failure. A saved classification with a queue failure can be retried via the processing endpoint or idle recovery, rather than rerunning classification only on null flags.

## Execution prerequisite

New `process_project` jobs have priority 10; `verify_candidate` jobs have priority 0. Workers claim higher-priority available jobs first, then oldest jobs, without bypassing retry backoff or preempting a running lease. Existing jobs remain intact; an explicit enqueue priority can promote a queued job using `$max` without duplicating it or resetting attempts. Priority is best-effort scheduling, not a guarantee of document availability or freedom from starvation under sustained higher-priority arrivals. Restart/deploy workers to load this code; an already-running Node process does not hot-reload it.

An always-running worker is still required:

```sh
npm run worker
```

This watches the database, claims queued jobs, verifies admission, and runs document retrieval, embedded text/OCR, Vertex summaries, fiscal refresh and persistence using the existing pipeline. It may incur Vertex charges when enabled. `worker:once` claims only one existing job; it is not a background service. Starting the web app alone does not start the worker.

The repository's Docker Compose worker already uses `--watch` and `restart: unless-stopped`, but that Compose stack targets its local MongoDB service, not the Atlas URI in `.env`. Run/configure a worker against the same intended database as the app. Keeping a server/service up is a deployment task; queue implementation alone cannot run while every worker is stopped.

No bulk classifier, backlog worker or production Vertex run was started as part of this change. Offline tests verify true/false/uncertain paths, duplicate reuse, explicit queue-failure reporting, stale workflow reset, and preservation of manual-override exclusions during bulk classification.

## Later read-only audit: 23 October 2026

After the separately authorized worker run, Atlas showed 2,019 completed jobs, six failed jobs, and no queued/running jobs. Of 97 software-marked projects, workflow states were 85 `procurement_closed`, five `failed`, four `metadata_only`, two `ai_pending`, and one `review_required`. Only five software projects had current stored extraction pointers. These numbers are a point-in-time snapshot, not reliability or classifier-accuracy percentages.

The five failed software records reported official-page identity verification failure plus a downloaded response without a PDF signature. The four metadata-only records lacked aggregator official-detail links. Two retained-text projects remained `ai_pending`; that state alone does not prove a current Vertex error. These blockers were inspected, not retried or overwritten during the context-parser change. Closed tenders remain excluded from new document acquisition. A fiscal regex improvement cannot create missing source text or make a failed HTTP response into a PDF.
