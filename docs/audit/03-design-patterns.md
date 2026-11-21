# Design patterns used

Each pattern lists where it lives, why it was chosen and how it can be checked. Only patterns that exist in the code are listed.

| # | Pattern | Where | Why | How to verify |
|---|---|---|---|---|
| 1 | **Middleware / Chain of responsibility** | `proxy.js` runs before every request: trailing-slash redirect, CORS and origin check, session verify, account-active check, scope check, rate limit, security headers | One place enforces the cross-cutting rules, so a new route cannot forget them | `tests/security/rbac-route-matrix.test.js` (58-route matrix), [RBAC_SPEC](../security/RBAC_SPEC.md) |
| 2 | **Decorator / Higher-order handler** | `withRouteSecurity` (`lib/route-security.js`), `withBidPrep` (`lib/bid-prep/security.js`) wrap a route handler with auth, per-user rate limit, uniform error body | Handlers hold only business logic; failures are converted to one safe error shape | `tests/security/bid-prep-access.test.js` |
| 3 | **Adapter** | `lib/ai/ollama.js` translates the Gemini-style request built for Vertex into Ollama `/api/chat` and back | Switch AI provider with `AI_PROVIDER` without touching extraction or drafting code | `tests/unit/ollama-provider.test.js` |
| 4 | **Strategy** | Storage backend (`TOR_STORAGE_BACKEND` = `local` / `gridfs` / `gcs`) in `lib/document-storage.js`; email transport (`EMAIL_TRANSPORT`); AI provider | Swap infrastructure by configuration | env vars in `.env.example`; `Document.storage.backend` enum |
| 5 | **Producer–consumer job queue with leases** | `lib/job-queue.js` (`enqueue*`, `claimNextJob`, `completeJob`, `failJob`, `requeueExpiredJobs`); `ProcessingJob.lease_until` | Slow AI/OCR work runs outside the request; a crashed worker's job is reclaimed when the lease expires | `tests/unit/processing-recovery.test.js`, `job-priority.test.js` |
| 6 | **Idempotency keys + unique indexes** | `ExtractionRun.run_key`, `FiscalBudgetAnalysis.input_key`, `AcquisitionAttempt.attempt_key`, `DocumentSummary` unique `(document, text hash, model, prompt)`, `NotificationDelivery (user, project)` | Retries and re-runs never create duplicates or send a second email | unique indexes in [02-data-model-er.md](02-data-model-er.md); `scripts/ensure-indexes.js` |
| 7 | **Distributed lock via partial unique index** | `IngestionRun.lock_key`, `ProcessingJob.active_key`, `NotificationBatch.active_key` + `lease_until` | At most one active run per key without an external lock service; stale locks expire | `tests/unit/ingestion-scheduler.test.js` |
| 8 | **State machine** | `Project.processing.status` (13 states), `Document.processing_status`, `ProcessingJob.status`, `IngestionRun.status`, `DiscoveryCandidate.status` | Every record has a named state and an `error_code`; recovery sweeps retry only `retry_pending` | [pipeline.md](../pipeline.md); enums in `models/` |
| 9 | **Pipeline (staged processing with checkpoints)** | `lib/processing-pipeline.js`; `VertexChunk.checkpoint_key` stores each AI chunk | A failure resumes from the last checkpoint instead of restarting | `tests/unit/vertex-resume.test.js`, `pipeline-stress.test.js` |
| 10 | **Optimistic concurrency** | `BidPrepDraft.version`, `User.bid_checklist_revision`, `bid_prep_revision` | Two tabs or users cannot silently overwrite each other; the API answers 409 | `tests/integration/bid-draft-editor-export.integration.test.js` |
| 11 | **Ownership filter (row-level access)** | Every BidPrep query adds `userId`; a foreign id returns 404 (not 403) so existence is not leaked | Prevents BOLA / IDOR | `tests/security/bid-prep-access.test.js`; 2-account E2E step "B cannot read A draft" |
| 12 | **Fail closed** | Dependency audit gate, expired exceptions, registry errors, unreadable checklist, corrupt stored draft all refuse rather than continue | Safe default when a check cannot run | `scripts/check-dependency-audit.js`, `lib/bid-prep/drafts.js` (`exportDraft`) |
| 13 | **Gate before export (policy enforcement)** | `exportDraft` returns 409 `CHECKLIST_NOT_PASSED` until every checklist item is `pass` | The system never produces a "ready" document for unmet qualifications | E2E report 22 Nov |
| 14 | **Read cache beside canonical record** | `Project.flagged_clauses`, `announcement_fiscal_budget` copy data whose canonical form is in `DocumentSummary` and carry `summary_id` links | Fast list and detail reads while the evidence stays versioned and immutable | comments in `models/Project.js` |
| 15 | **Append-only audit log** | `PipelineTriggerAudit`, `ClassificationOverride` (before and after snapshot), `AcquisitionAttempt` | Who did what, when, from which IP and with what result | `docs/admin-pipeline-control.md`, `docs/evidence/admin-pipeline-http.json` |
| 16 | **Factory + injectable clock** | `createRateLimiter({ windowMs, now })` | Deterministic tests of limits | `tests/security/rate-limit.test.js` |
| 17 | **Schema-first AI output (guard)** | `lib/vertex/response-schema.js`, `lib/proposal/draft.js` | Model output is validated as JSON against a schema; rows without a source are dropped; unknown facts are written as `[to fill in: ...]` | `tests/unit/proposal-draft.test.js` |
| 18 | **Soft-secret handling (`select:false`)** | `User.passwordHash`, `session_version`, `NotificationBatch.payload`, `Project.vectorEmbedding` | Sensitive or heavy fields are never loaded unless a query asks for them | `models/User.js`; `toJSON` transform removes `passwordHash` |
| 19 | **Configuration by environment (12-factor)** | `.env` / `.env.example`, `lib/load-local-env.js` | No secret in code; same image on every machine | `.env.example`; secret scan (see [04](04-controls-and-evidence.md)) |
| 20 | **Container-per-role deployment** | `docker-compose.yml`: `app`, `worker`, `scraper`, `scheduler`, `mongo` | Roles scale and fail independently; only `app` is exposed | [01-architecture.md](01-architecture.md) |

## Not used (so nobody is told otherwise)
- No message broker: the queue is a MongoDB collection (adequate for the volume; a limit if load grows).
- No ORM-level repository layer: modules use Mongoose models directly.
- No microservices: one Next.js application plus workers.
- No automatic bid submission: by design the seller submits on e-GP.

## Trade-offs an auditor may probe
| Choice | Benefit | Cost / limit |
|---|---|---|
| MongoDB as queue and lock | One system to run | Polling; throughput bounded by one database |
| In-memory rate limiter (`createRateLimiter`) | Simple, no extra service | Per-process: limits reset on restart and do not span several `app` instances |
| JWT session in a cookie (24 h, HttpOnly, SameSite=Lax) | Stateless reads | Logout revokes the token and bumps `session_version` (ASVS V7.4.1 DONE in [ASVS_CHECKLIST](../security/ASVS_CHECKLIST.md)); the README's older known-gap line about copied tokens after logout should be reconciled with that before the audit |
| Local small model for drafts on the demo machine | Works without cloud billing | Slow (76 to 92 s), lower quality; the AI draft is only a draft the user must review |
