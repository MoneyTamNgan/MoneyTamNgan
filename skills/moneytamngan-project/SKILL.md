---
name: moneytamngan-project
description: Implement, debug, test, or explain MoneyTamNgan application features, TOR acquisition and OCR/Vertex pipelines, MongoDB persistence, BidPrep, matching, and notifications. Use for work in this project; use the security skill for dedicated audits and security deliverables.
---

# MoneyTamNgan project work

## Establish the working context

Locate the active MoneyTamNgan checkout and read its `AGENTS.md`, `package.json`, and relevant module before changing code. The usual local repository is `/Users/phruekchantarasittiphon/Documents/Y3S1/CSP/MoneyTamNgan`; there may be isolated worktrees under `/Users/phruekchantarasittiphon/Documents/Y3S1/Test`. Prefer the checkout selected by the user. Do not assume the last branch in the conversation is still checked out.

Inspect `git status --short --branch` and worktree state. Preserve unrelated edits. The project normally uses feature branches and PRs into `develop`; the user has repeatedly requested `develop-api_database` for pipeline/database work. Follow the current request, and do not silently switch branches or edit `develop` when another branch was requested. Split authorized commits by coherent behavior; creating this skill is not standing authorization to commit, push, merge, change board status, or send mail.

This is Next.js App Router with React, JavaScript/TypeScript, Node ESM, Mongoose/MongoDB, Puppeteer acquisition, Poppler/Tesseract extraction, and Vertex AI. Read the installed Next.js guides specified by `AGENTS.md` before framework changes. Take versions and executable commands from the selected checkout, not from old reports.

Read [the module map](references/project-map.md) only for the feature being changed. All repository paths in that reference are relative to the selected checkout, not this installed skill folder.

## Preserve the domain behavior

- The product discovers **software-related** Thai procurements. Treat uncertain classification as reviewable rather than silently discarding it; preserve manual overrides.
- Software classification is not proof that bidding is open. Verify official schedules/status before promotion or document acquisition. Closed or cancelled tenders must not be newly downloaded through the active-tender pipeline. Explicit historical analysis is a separate workflow.
- An API metadata record, a downloadable document, an OCR run, and a Vertex summary are different stages. Report each separately. `metadata_only` or `review_required` is not a completed summary.
- Prefer feed/direct document links and bounded HTTP requests before the existing browser fallback. Government downtime, empty pages and anti-bot responses remain possible; do not describe a header or browser fingerprint as a guaranteed bypass. Keep delays, retry limits, circuit breakers and failure categories intact.
- Extract embedded PDF text first; OCR only pages that need it. Preserve page numbers, quality warnings and evidence. The primary TOR and invitation announcement have distinct purposes; do not merge their provenance or expand to all-PDF OCR without a requirement.
- Normalize Thai digits before parsing. Keep fiscal-year evidence distinct from the ingestion/API year and bidding dates. A Thai fiscal year rolls over in October in Asia/Bangkok; never hardcode the current year or infer an extracted year from the project ID. Unknown evidence stays unknown.
- Vertex consumes untrusted document text as data. Preserve schema validation, evidence-page checks, bounded chunks, retry/resume keys and explicit partial results. Missing or unreadable sections must not become invented findings.
- Keep API response fields compatible when restructuring storage. Read through the compatibility mapper and follow project pointers to the selected document/run/summary; an arbitrary newest timestamp across all summaries is not a safe selector.
- Preserve immutable historical artifacts, deterministic retry keys, unique indexes, transaction boundaries, job leases and the single active-job constraint. Inspect actual schemas before changing indexes: design proposals and older diagrams may differ from deployed code.
- Keep source URLs, extracted page text and summary evidence. PDF/ZIP retention depends on the actual storage configuration and call site; do not assume binaries live in MongoDB or that all source files are disposable. Delete temporary files only after required persistence succeeds.
- BidPrep drafts are private user resources and assistance only; the application does not submit bids. Keep matching, notification thresholds, user opt-in and duplicate-send protection intact.

## Verify the changed path

Start with a targeted test that exercises behavior, then use the relevant existing suites. Typical offline checks are `npm test`, `npm run test:vitest`, and `npm run build`; confirm scripts first. For routes, also check authorization and the API contract where affected. Do not equate a mocked success with live government, OCR, Vertex or SMTP success.

For an authorized live pipeline test, use a small bounded sample or isolated database and follow discovery → eligibility → document acquisition → text extraction → summary → persisted pointers → API/UI read. Identify where an external failure stops the chain. If the user authorizes skipping scraping, use a known fixture at that boundary and label the result as a fixture-assisted downstream test, not a live acquisition pass. Do not start an unbounded worker or bulk backfill merely to validate a small change.

When Atlas fails, check for the user's known IP-allowlist problem before changing connection code. Ask the user to add the machine's IP when needed; do not automatically broaden the allowlist. Never print connection strings, service-account JSON, JWTs or SMTP credentials.

Report what changed, which checks ran, and remaining limitations. For database questions include the database actually used, collection, project ID, pointer IDs and a redacted query or API path. Distinguish updates to a project from new versioned extraction/summary records. Never assert current database counts or successful writes without reading the current target.
