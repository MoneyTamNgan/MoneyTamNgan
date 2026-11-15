# Match threshold email dispatcher — issue #39

After the worker or admin pipeline processes a TOR, the notification service hydrates its current normalized document summary, calculates the current skill score for each opted-in user, and records matches meeting that user's threshold (default 70). IMMEDIATE users receive email during that hook. DAILY_DIGEST users accumulate pending matches until the daily command runs. Missing/unprocessed summaries are skipped; an explicitly extracted empty tech stack retains the matching engine's neutral 100 score.

## Scoring dependency

**#96 remains open and unmerged.** The owner explicitly selected the existing `calculateSkillMatchScore` for this change. Deliveries record `score_version: skill-v1`. This is not the weighted overall match formula promised by #96; the dependency acceptance item remains pending. Switch the adapter and version intentionally when #96 is integrated, with threshold regression tests. Already-sent user/project pairs remain deduplicated.

## Persistence and duplicate prevention

- `notificationdeliveries`: one unique `{user_id, project_id}` record, match snapshot, score version, frequency, status and batch reference. Reprocessing a TOR does not send a second email to the same user.
- `notificationbatches`: immutable provider payload and delivery membership (up to 15 TORs), attempt count, status, provider ID, timestamps and a short-lived owner lease. A sparse unique `active_key` serializes dispatch per user across servers.
- Batch creation and membership updates use a MongoDB transaction. Successful send state and delivery state are committed together. A stale owner cannot settle a newer claim. No TTL deletes the ledger.
- A failed send retries the **same frozen payload and Resend idempotency key** (`tor-match/<batch_id>`), at most three provider calls, with 1/2-minute backoff. A 2-minute lease recovers interrupted dispatches. Retries stop at 23 hours after the first attempt, before Resend's 24-hour idempotency retention expires. An ambiguous send outside that window is marked failed rather than risking a duplicate. A provider acceptance is recorded as sent; delivery to the inbox still requires provider/inbox confirmation.
- Resend transport has a 20-second caller timeout. Automatic sends require Resend; SMTP is only available for explicit local template tests because it has no provider idempotency guarantee. Failure logs never include raw provider errors, recipient addresses, HTML or keys.
- Preferences and the recipient are rechecked before sending. Disabled/invalid/changed recipients cancel existing batches; no emails are sent to opted-out users. Matches stay as durable snapshots of the score at ingestion; changing a profile does not rescore historical deliveries. Notification failures never fail TOR processing.

## Setup and scheduling

Add real values only to an uncommitted `.env.local` (scripts also load `.env`):

```dotenv
RESEND_API_KEY=
EMAIL_FROM=MoneyTamNgan <notifications@example.com>
APP_BASE_URL=http://localhost:3000
```

The sender must be allowed by your Resend account. `APP_BASE_URL` supplies TOR and profile/settings links. HTML content is escaped; project IDs are URL encoded. The footer links to `/profile`, where the user can disable notifications. No one-click unauthenticated unsubscribe endpoint is introduced.

```sh
npm run db:ensure-indexes
npm run worker
npm run notify:retry
npm run notify:digest
```

The worker and admin pipeline call the same notification service. Schedule `notify:retry` every minute to recover existing immediate/digest batches. Schedule `notify:digest` once daily, e.g. 09:00 Asia/Bangkok. The commands do not install a scheduler automatically. Each invocation drains at most 150 queued TORs per user, in batches of 15; an exceptionally large daily backlog requires additional digest invocations. The protected `/api/notifications/digest` endpoint dispatches the persisted queue; request bodies cannot inject projects. It no longer scans an arbitrary 200-project window or requires legacy `projects.extracted_data` fields.

## Verification and demo

```sh
npx vitest run tests/unit/notification-service.test.js tests/integration/notification-email.integration.test.js tests/integration/notifications-test-route.integration.test.js
node scripts/test-notification-atlas.js /tmp/notification-atlas-evidence.json
npm test
npm run test:vitest
npm run build
```

The Atlas command creates and removes only its own random `mtn_notify_test_*` database. It uses the real normalized-summary mapper, ledger, batches, transactions and concurrent claim operations, but mocks email transport and makes no government or Vertex requests. It verifies rollback and stale-owner fencing. It does not send to any real user.

For a real inbox test, sign in to the intended test account, open `/profile` and use its test-email action (POST `/api/notifications/test`). It sends only to the authenticated account, not a body-supplied recipient. Confirm the name, score, TOR link and notification settings link, and attach a received-email screenshot without exposing secrets. Template tests bypass the production delivery ledger intentionally. Test API success proves provider acceptance, not inbox delivery. A received-email screenshot and teammate approval remain separate acceptance evidence.

## Acceptance state

The implementation preserves the existing match-score API, worker processing and admin pipeline. The #96 merge dependency, a real received-email screenshot, teammate review/approval and merge must be checked separately; do not mark them complete based only on mocked tests. No production ledger is backfilled automatically and no historical users are emailed by migration.

### Verification recorded during implementation

- 280 Node tests and 312 Vitest tests passed locally (592 total).
- Production build passed; focused Resend tests use a mocked SDK and verify escaping, provider idempotency options and sanitized failure logs.
- After the owner enabled Atlas access, the isolated live fixture passed: normalized hydration, five concurrent hooks with one immediate send, queued digest, repeat-send deduplication, transaction rollback and stale-owner fencing. The test database name was shortened to fit Atlas limits. Evidence: [notification-atlas.json](evidence/notification-atlas.json). Transport was mocked; the disposable test database was removed.
- No real email was sent: `RESEND_API_KEY` and `EMAIL_FROM` were absent locally. The owner authorized one test inbox; credentials must be configured before sending. A received-email screenshot remains pending.
