# Develop integration validation — 23 October 2026

Direction: `origin/develop` at `ca7b476` into `develop-api_database` at `1dea65f`. No update to `develop` is part of this operation.

## Resolution choices

- Keep both ingestion scheduler and processing recovery/fiscal CLI commands and environment settings.
- Keep the canonical `pipeline-auth` bearer helper introduced by develop; the API branch's admin-session helper imports/re-exports it. Private review protection remains enabled.
- Retain the combined worker's recovery, fiscal refresh and post-completion notification behavior.
- Retain both branches' additive project fields, public document metadata and current fiscal-cache compatibility mapping.
- Adopt `tests/unit` and correct relocated imports/fixture paths. Explicitly include new Node and Vitest tests rather than silently excluding them. Also activate previously undiscovered notification/analytics tests.
- Run the Node backend suite in CI as well as Vitest.
- Fix `models/User.js` to destructure Mongoose from its default import. Native Node could not load the notification dependency with the named `models` import, despite the Next build succeeding. A subprocess regression test verifies that native worker dependencies load without a database connection or email delivery.

## Validation

- `npm ci --ignore-scripts`: merged lockfile installs successfully; no dependency version changes made during resolution.
- `npm test`: 235 passed, zero failed/skipped.
- `npm run test:vitest`: 172 passed across 27 files (includes API contracts, admin auth, overrides, review queue, notifications, analytics and pipeline trigger tests).
- `npm run build`: successful production compilation, TypeScript checking and route generation.
- `npm run fiscal:evaluate`: 24/24 synthetic cases matched; this is not real-PDF accuracy measurement.
- `git diff --check`: clean.

These checks are offline/mocked, apart from dependency installation. No production database writes, scraping, Vertex requests or email delivery were initiated for this merge. Live upstream availability is not guaranteed by these tests.

## Follow-up

Dependency installation reports nine advisories (five moderate, three high, one critical). This merge does not establish exploitability or remediate those advisories; dependency security review remains separate. Existing retrieval and source-document limitations remain unchanged. Workers and deployed app instances need a normal restart/deployment to load the merged code.
