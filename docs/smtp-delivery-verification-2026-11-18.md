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
| Received real inbox message | Owner confirmed receipt on 18 November 2026 |
| Received-email screenshot and visible content | Owner supplied screenshot in conversation: Thai title, budget, 85% and settings link visible; image not yet attached to GitHub |
| Real TOR/settings navigation on the local app | Passed: summarized software TOR 66089621504 and /profile return 200; owner-scoped profile read 200, unauthenticated read 401 |

Initial connection failure: [sanitized JSON](evidence/notification-smtp-connection-2026-11-18.json). After the owner saved the updated private settings, SMTP verified and accepted one authorized sample: [accepted-send evidence](evidence/notification-smtp-delivery-2026-11-18.json). The owner subsequently confirmed inbox receipt in conversation. A received-email screenshot is not yet attached. Earlier evidence was preserved.

The owner saved updated private SMTP settings and the live authentication and sample send passed. After the owner enabled Atlas access, the disposable ledger test also passed. The owner confirmed inbox receipt; the owner supplied a screenshot in conversation showing the Thai title, budget, 85% score and settings link. Attach the image to GitHub separately; the screenshot alone did not prove navigation, so a separate real local-app check was performed successfully. Low text contrast is visible in this mobile client. No credentials are included in this report.

## Remaining before acceptance

1. Completed: updated SMTP settings loaded privately and connection/authentication verified. Still confirm provider credential ownership, sending limits and revocation of any previously exposed API key.
2. Completed: reran the disposable Atlas ledger test after IP access was restored. [Evidence](evidence/notification-atlas-2026-11-18.json). Its transport was mocked; no production users were emailed.
3. Completed: one sample was accepted by SMTP. Owner confirmed inbox receipt. Owner supplied a received-email screenshot in conversation; attach it to the GitHub card/PR for durable team evidence. No second send is needed unless the owner requests it.
4. Completed for the local app: generated links were checked against actual summarized TOR `66089621504` and `/profile`; the owner-scoped preferences API returned 200 and anonymous access returned 401. [Read-only check evidence](evidence/notification-links-2026-11-18.json). The received fixture email intentionally points to TEST-SMTP-001; its URL cannot be changed after sending. Localhost URLs work only on the app computer. Mobile/public reachability remains outside this local-only setup.
5. Obtain non-author review and merge approval. #164 remains a draft; do not infer acceptance from #39's existing Closed/Done status.

The PR's existing dependency-audit job also reports a high-severity `picomatch` advisory through the test-tool dependency tree. No audit suppression, forced dependency downgrade or unrelated package changes were made by this SMTP follow-up. The new PR run passes Build, Test, API contract, Semgrep and health-check; dependency audit still fails. CI cannot be described as fully green while that job fails.


## Dependency audit investigation

On 18 November 2026, `npm audit --package-lock-only` still reports five high dependency-tree findings rooted in `picomatch` and two moderate findings through `uuid`. The latest published `picomatch` version is 4.0.7. The [reviewed advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) lists versions through 4.0.7 as affected and no patched release. npm proposes a major Vitest downgrade rather than a compatible patched replacement. No audit exception, severity downgrade, false clean result or forced major tool migration was introduced. The audit blocker remains open for the security owner/upstream fix; #188's policy is preserved.

## Gmail operator handoff

The verified provider is Gmail SMTP (`smtp.gmail.com`, port 465 with implicit TLS). Only public server settings are documented; username, sender address, app password and keys remain private. The port determines implicit TLS in the shared application transport. For a clean example configuration, use `MAIL_ENCRYPTION=ssl` with 465; STARTTLS uses port 587 with `MAIL_ENCRYPTION=tls`.

The account owner provisions, rotates and revokes the private application credential. Google requires 2-Step Verification for [app passwords](https://support.google.com/accounts/answer/185833), which can become invalid when the account password changes. The owner identified **Watcharapat** as responsible for the sending account and credential rotation. Personal Gmail versus Google Workspace account class remains unconfirmed. Do not invent domain-verification or account-ownership evidence from an accepted send.

Standard Gmail has a published daily limit of 500 outgoing messages; exceeding provider limits can temporarily prevent sending. See [Google's sending-limit guidance](https://support.google.com/mail/answer/22839?hl=en). Workspace accounts have [separate limits](https://support.google.com/a/answer/166852); the operator must confirm which account and remaining quota apply. The application has durable deduplication and conservative SMTP retry handling, but no account-wide Gmail quota reservation. Immediate/digest sends share the provider account quota with other users of that account. Use this setup within the confirmed quota; do not represent it as bulk-mail capacity.

The application credentials must be supplied to every deployment privately. No SMTP service account or password is embedded in Docker images or Git. `APP_BASE_URL` must name the reachable frontend origin. The current owner-approved setup remains local-only at `http://localhost:3000`. A phone's localhost does not resolve to the app computer.

Owner response on 18 November: revocation of the previously exposed Resend key is not yet confirmed. This item remains unchecked. Explicit SMTP selection prevents use of the old Resend credential for these sends; it does not revoke the credential in the provider account. Credential owner was subsequently confirmed as Watcharapat; account type remains unconfirmed.
