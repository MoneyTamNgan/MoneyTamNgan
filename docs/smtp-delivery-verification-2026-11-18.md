# SMTP dispatcher verification — 18 November 2026

Related: [dispatcher #39](https://github.com/MoneyTamNgan/MoneyTamNgan/issues/39), [provider setup #165](https://github.com/MoneyTamNgan/MoneyTamNgan/issues/165), [draft PR #164](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/164).

## What changed

- Continued from the SMTP-tested branch containing teammate commit `85d3e01`; integrated current `develop` (`0e86c36`) without conflicts.
- Preserved existing SMTP sends, immediate/digest dispatch, persistent duplicate prevention and conservative handling of ambiguous SMTP failures.
- Added `npm run notify:test-smtp`: verify connection/authentication without sending. Explicit `--send` and a private `NOTIFICATION_TEST_TO` are required for a single sample email. No database or production subscriber scan is involved.
- Added safe SMTP verification error codes and transport cleanup, with tests proving a connection check sends no mail and does not reveal raw authentication errors.
- Updated the authenticated test endpoint's failure guidance to cover SMTP and Resend.
- Updated scoring documentation: #96 is closed with the tech-stack-overlap scope already used by this dispatcher.

## Results

| Check | Result |
| --- | --- |
| Focused matching/dispatcher/template/authenticated-route tests | 35 passed |
| Full Node test suite | 340 passed |
| Full Vitest suite, including API contract tests | 442 passed across 49 files |
| Production build using locked dependencies | Passed |
| SMTP CLI missing-recipient guard | Refused before connection/send (`TEST_RECIPIENT_REQUIRED`) |
| Integrate current develop into isolated worktree | Clean merge |
| SMTP connection using this machine's current private configuration | Failed with sanitized `ESOCKET`; no message sent |
| Live disposable Atlas ledger/transaction test | Blocked at connect with `MongooseServerSelectionError`; application records unchanged |
| Received real inbox message / screenshot | Not verified |

Connection evidence: [sanitized JSON](evidence/notification-smtp-connection-2026-11-18.json). This is failure evidence, not delivery evidence. The previously committed 15 November accepted sample remains historical evidence and was not overwritten.

The local SMTP configuration still points to the previously used capture-service host. New real-provider settings must be installed privately on this machine before a real-inbox test can pass. The owner has been asked to update the settings and Atlas IP allowlist. No credentials are included in this report.

## Remaining before acceptance

1. Install the actual SMTP provider settings privately; confirm allowed sender, credential owner and sending limits. Confirm any previously exposed API key was revoked.
2. Allow this machine's IP in Atlas and rerun the disposable ledger test. It uses mocked transport and never emails production users.
3. Run the single authorized sample send. SMTP acceptance alone does not complete #165: confirm receipt and attach a redacted screenshot.
4. Check a real TOR link and notification-settings link in the received email.
5. Obtain non-author review and merge approval. #164 remains a draft; do not infer acceptance from #39's existing Closed/Done status.

The PR's existing dependency-audit job also reports a high-severity `picomatch` advisory through the test-tool dependency tree. No audit suppression, forced dependency downgrade or unrelated package changes were made by this SMTP follow-up. CI cannot be described as fully green while that job fails.
