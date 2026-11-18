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
| SMTP connection using newly saved private configuration | Passed authentication/connection verification |
| Single authorized sample send | SMTP accepted one marked test email; no automatic retry or subscriber sweep |
| Live disposable Atlas ledger/transaction test | Passed after IP allowlisting: concurrency, immediate/digest deduplication, transaction rollback, stale-owner fencing; own fixture database removed |
| Received real inbox message / screenshot | Not verified |

Initial connection failure: [sanitized JSON](evidence/notification-smtp-connection-2026-11-18.json). After the owner saved the updated private settings, SMTP verified and accepted one authorized sample: [accepted-send evidence](evidence/notification-smtp-delivery-2026-11-18.json). SMTP acceptance does not prove inbox receipt. Earlier evidence was preserved.

The owner saved updated private SMTP settings and the live authentication and sample send passed. After the owner enabled Atlas access, the disposable ledger test also passed. Inbox confirmation and a redacted received-email screenshot are still pending. No credentials are included in this report.

## Remaining before acceptance

1. Completed: updated SMTP settings loaded privately and connection/authentication verified. Still confirm provider credential ownership, sending limits and revocation of any previously exposed API key.
2. Completed: reran the disposable Atlas ledger test after IP access was restored. [Evidence](evidence/notification-atlas-2026-11-18.json). Its transport was mocked; no production users were emailed.
3. Completed: one sample was accepted by SMTP. SMTP acceptance alone does not complete #165: confirm receipt and attach a redacted screenshot. No second send is needed unless the owner requests it.
4. Check a real TOR link and notification-settings link in the received email.
5. Obtain non-author review and merge approval. #164 remains a draft; do not infer acceptance from #39's existing Closed/Done status.

The PR's existing dependency-audit job also reports a high-severity `picomatch` advisory through the test-tool dependency tree. No audit suppression, forced dependency downgrade or unrelated package changes were made by this SMTP follow-up. The new PR run passes Build, Test, API contract, Semgrep and health-check; dependency audit still fails. CI cannot be described as fully green while that job fails.
