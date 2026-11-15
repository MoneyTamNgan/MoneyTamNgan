# Match threshold email dispatcher — issue #39

After the worker or admin pipeline processes a TOR, the notification service hydrates its current normalized document summary, calculates the current skill score for each opted-in user, and records matches meeting that user's threshold (default 70). IMMEDIATE users receive email during that hook. DAILY_DIGEST users accumulate pending matches until the daily command runs. Missing/unprocessed summaries are skipped; an explicitly extracted empty tech stack retains the matching engine's neutral 100 score.

## Scoring dependency

**#96 remains open and unmerged.** The owner explicitly selected the existing `calculateSkillMatchScore` for this change. Deliveries record `score_version: skill-v1`. This is not the weighted overall match formula promised by #96; the dependency acceptance item remains pending. Switch the adapter and version intentionally when #96 is integrated, with threshold regression tests. Already-sent user/project pairs remain deduplicated.

## Persistence and duplicate prevention

- `notificationdeliveries`: one unique `{user_id, project_id}` record, match snapshot, score version, frequency, status and batch reference. Reprocessing a TOR does not send a second email to the same user.
- `notificationbatches`: immutable provider payload and delivery membership (up to 15 TORs), attempt count, status, provider ID, timestamps and a short-lived owner lease. A sparse unique `active_key` serializes dispatch per user across servers.
- Batch creation and membership updates use a MongoDB transaction. Successful send state and delivery state are committed together. A stale owner cannot settle a newer claim. No TTL deletes the ledger.
- A failed send retries the **same frozen payload and Resend idempotency key** (`tor-match/<batch_id>`), at most three provider calls, with 1/2-minute backoff. A 2-minute lease recovers interrupted dispatches. Retries stop at 23 hours after the first attempt, before Resend's 24-hour idempotency retention expires. An ambiguous send outside that window is marked failed rather than risking a duplicate. A provider acceptance is recorded as sent; delivery to the inbox still requires provider/inbox confirmation.
- Resend transport has a 20-second caller timeout. Automatic sends support explicitly selected SMTP or Resend. Each batch freezes its transport. SMTP has one automatic attempt: failures or interrupted attempts require operator reconciliation, since SMTP cannot deduplicate an ambiguous retry. A stable Message-ID alone would not guarantee deduplication. Resend retains the bounded idempotent retry policy. Failure logs never include raw provider errors, recipient addresses, HTML or keys.
- Preferences and the recipient are rechecked before sending. Disabled/invalid/changed recipients cancel existing batches; no emails are sent to opted-out users. Matches stay as durable snapshots of the score at ingestion; changing a profile does not rescore historical deliveries. Notification failures never fail TOR processing.

## Setup and scheduling

Add real values only to an uncommitted `.env.local` (scripts also load `.env`):

```dotenv
EMAIL_TRANSPORT=smtp
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_ENCRYPTION=tls
MAIL_USERNAME=
MAIL_PASSWORD=
EMAIL_FROM=MoneyTamNgan <notifications@example.com>
APP_BASE_URL=http://localhost:3000
```

For SMTP, use the credentials and allowed sender of your chosen mail provider; port 587 uses STARTTLS and port 465 implicit TLS. For Resend, set EMAIL_TRANSPORT=resend and RESEND_API_KEY, with a verified-domain sender. SMTP selection takes precedence even if an old Resend key remains configured. `APP_BASE_URL` supplies TOR and profile/settings links. HTML content is escaped; project IDs are URL encoded. The footer links to `/profile`, where the user can disable notifications. No one-click unauthenticated unsubscribe endpoint is introduced.

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

- 280 Node tests passed; after SMTP support, all 315 Vitest tests and the production build passed (595 tests total).
- Production build passed; focused Resend tests use a mocked HTTP transport and verify escaping, provider idempotency options and sanitized failure logs.
- After the owner enabled Atlas access, the isolated live fixture passed: normalized hydration, five concurrent hooks with one immediate send, queued digest, repeat-send deduplication, transaction rollback and stale-owner fencing. The test database name was shortened to fit Atlas limits. Evidence: [notification-atlas.json](evidence/notification-atlas.json). Transport was mocked; the disposable test database was removed.
- After local configuration was added, one owner-authorized live sample send was attempted on 2026-11-15. Resend rejected it with HTTP 403 because the configured sender used the unverified gmail.com domain. No email was accepted or delivered. Set a verified-domain sender (or an eligible Resend sandbox sender) before retrying. A received-email screenshot remains pending. The live test also exposed SDK development error logging; transport now uses the official Resend HTTP endpoint with sanitized logs and an abort timeout.

### SMTP update

At the owner’s request, SMTP now supports automatic threshold and digest notifications. Local EMAIL_TRANSPORT is set to smtp; SMTP host confirmation is pending before a live send. Production ledger uniqueness and per-user leases remain. SMTP provides no provider idempotency key, so an ambiguous send is not automatically replayed. This favors preventing duplicates over guaranteed delivery after a crash. Provider acceptance still requires a separate inbox check.
