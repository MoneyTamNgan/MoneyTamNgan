---
name: moneytamngan-security
description: Review or implement MoneyTamNgan security controls, authorization, security tests, ASVS/STRIDE mappings, dependency triage, and coursework security reports or presentation content. Use for a security-focused task, not every ordinary project edit.
---

# MoneyTamNgan security work

## Establish scope and evidence

Use the active user-selected MoneyTamNgan checkout; read its `AGENTS.md`, branch state and changed files. The usual repository is `/Users/phruekchantarasittiphon/Documents/Y3S1/CSP/MoneyTamNgan`, with separate worktrees under `/Users/phruekchantarasittiphon/Documents/Y3S1/Test`. Preserve unrelated work and the user's selected branch. This skill does not authorize merges, issue closure, board changes, live messages, credential rotation or production changes.

Distinguish implementation, offline tests, live verification and residual risk. Check source and dated evidence rather than copying claims from an old README or scanner report. Use [the security evidence map](references/security-evidence.md) for relevant code, tests and the historical audit baseline; repository paths there are relative to the selected checkout.

## Preserve the access boundaries

- Inspect `lib/auth.js`, `lib/account-status.js`, `lib/request-authorization.js`, `lib/route-security.js`, `proxy.js` and the actual route. A client-provided role/user/scope header is not trusted evidence. Keep Proxy checks and independent handler guards consistent.
- A missing or invalid identity should receive 401; an authenticated identity lacking permission should receive 403. A private resource belonging to another user can return 404 to avoid enumeration. Confirm the endpoint's documented contract instead of making every denial identical.
- Private profiles, drafts, checklists and exports must use owner-bound database queries from the verified session identity. Hidden UI buttons and token scopes alone do not prevent cross-user access.
- Pipeline and cron credentials have narrow machine permissions. They must not become general admin or profile access. Unknown mutations should fail closed.
- Keep signed scopes bounded by the server's role allowlist. Scope enforcement must cover both reads and writes, including route aliases and polling endpoints.
- Preserve exact CORS origins and state-changing browser origin checks. Browser CORS is not authentication; machine/Bearer handling has separate boundaries. Keep nonce-based CSP working with actual Next.js output rather than replacing it with a broad static policy. Local HTTP header presence does not prove production HTTPS/HSTS enforcement.
- Treat PDF text and AI instructions as untrusted input. Preserve page evidence checks, private BidPrep ownership, output escaping, cost limits, and safe archive extraction. Do not claim a system prompt alone prevents prompt injection.

## Implement and test proportionately

For auth or authorization changes, cover allowed and denied cases, including anonymous, ordinary user, admin, insufficient scope, disabled account and cross-owner access as applicable. Test the route handler independently from Proxy where feasible. For data validation, exercise wrong types, operator-shaped values, size limits and relevant boundary values; Mongoose is not blanket NoSQL-injection protection.

Use targeted existing suites before broad verification. Typical broad checks are `npm test`, `npm run test:vitest`, `npm run build`, API documentation audit, and the applicable contract tests. Read the current package scripts and CI commands first. A test count includes functional tests unless explicitly measured otherwise.

Use disposable accounts and isolated databases for live tests. Limit verification to the requested app/environment and stated workflow. Record the target, commit, command, outcome and limitations. Do not send another SMTP email or spend Vertex quota merely because a previous task permitted one test.

For dependencies, read `docs/security/VULNERABILITY_MGMT.md`, the current CI audit checker, lockfile and exception records. Preserve the raw audit finding and its dependency path. Prefer compatible fixes; do not apply `npm audit fix --force` blindly or weaken gates. A prior exception is limited to its advisory, scope and expiry; it does not approve unrelated findings. Verify whether an advisory was withdrawn or fixed before proposing a new exception.

For scanner evidence, use the scripts/workflows actually present. Separate Semgrep ERROR/High from warnings and parse errors. ZAP's passive unauthenticated baseline does not cover logged-in authorization or establish zero vulnerabilities. Tie artifacts to a commit and date; old committed snapshots and newer CI artifacts can differ.

Never output secret values from env files, cookies, tokens, service-account JSON or mail settings. Use env variable names and redacted evidence. An ignored env file or clean pattern scan does not revoke an exposed credential. Ask the account owner to perform credential changes rather than silently treating them as complete.

## Reports and presentation content

For coursework coverage use versioned requirements: the November 2026 audit uses **ASVS 5.0.0** and **OWASP Top 10:2025**. Older project documents contain other identifiers; verify each exact requirement in official material when updating a mapping. Do not relabel an old ID as a new version without checking it.

Map each claimed control to implementation, a meaningful test/evidence artifact, and known limitations. Distinguish implemented, tested, partial, planned and accepted risk. Describe security principles concretely: least privilege through scopes, complete mediation through route and owner checks, and defense in depth through independent layers.

When producing the assignment report, cover all six requested sections: application/team, functional features, security-to-ASVS mapping, prioritized threat model, implemented principles, and test process. Assess all 18 rubric criteria and identify four **distinct** advanced controls. Absolute JWT expiry is not an inactivity timeout; cookie deletion is not server-side token revocation; Google login is not application MFA.

Use the confirmed roster: Phruek Chantarasittiphon, Watcharapat Pathanutpong, Peerawat Theerasakul, and Napat Sirichan. Presentation requests should keep slide points brief and put detailed limitations and citations in the report/script. Preserve user-supplied templates. Include a concise controls/gaps/next-action view rather than concealing known weaknesses or claiming full ASVS certification.

Finish with what changed, checks that actually ran, and open risks. Do not mark a card Done or claim teammate approval/green CI from local test success alone. Follow the user's current request for commits, review or merge and verify the corresponding external state.
