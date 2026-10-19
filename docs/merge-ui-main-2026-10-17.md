# UI/main merge decisions — 17 October 2026

Branch: `feat/redesign-tor-cards-and-details-theme`.
UI head: `df0aec3`; incoming main: `7d943c1`.

## Preserved

- Dashboard: redesigned fixed cards, separate TOR phase and live bidding status,
  exact countdown, software and agency filters, 10-item paging and prefetching.
- Details: redesigned layout, separate bidding date/session times, constrained
  document names, summary expansion and existing qualification/observation cards.
- Analytics: full-width redesigned layout, bidding deadline charts and the third
  document-readiness chart mode.
- Incoming main: pipeline recovery/consistency (#59), paired acquisition/storage
  (#60), guest access/rate limiting (#62), public spending/export APIs (#63),
  and guest routing/banner improvements (#68). PR numbers come from local merge history.

## Combined data rules

- Confirmed fiscal year: `Project.latest_summary_id` → `DocumentSummary.extraction.fiscal_budget`.
  Validate the document and extraction-run references before using a summary.
  Prefer `status: found` and `year`; ambiguous years require review. When no
  confirmed/ambiguous extraction exists, retain the Thai fiscal-year estimate
  from the Bangkok bidding deadline. Dashboard tooltip and detail label identify
  that fallback; analytics items expose `fiscalYearSource`.
- Keep `tender.status` as TOR phase, distinct from bidding availability derived
  from the current time and the submission deadline. Preserve tender acquisition
  fields, submission schedule and both document pointers in one Project schema.
- Keep the public document metadata needed by the UI and incoming checks against
  stale OCR/summary pointers. Card data now batch-hydrates normalized records for
  fiscal evidence and matching, rather than reading Project alone.
- Document readiness uses resolved artifact links; it does not verify stored PDF
  bytes or guarantee extraction quality.

## Analytics contracts

- `/api/analytics/search` and `/api/analytics/export` retain main's public catalog
  contract, aggregates, category filters and export protections.
- `/api/analytics/overview` and `/api/analytics/overview/export` serve the redesigned
  tender-only UI, with its bidding/fiscal/software filters and readiness charts.
- Both export families cap downloads at 10,000 rows, report truncation and protect
  CSV cells from formula execution. The overview software toggle off means all
  categories, not only non-software.

## Verification

- Production build passed.
- Pipeline tests: 122 passed.
- Vitest/API tests: 110 passed, including fiscal-field and overview-export regressions.
- Windows sandbox prevented some temporary files/subprocesses; suites and build
  passed with normal local permissions.
- No database migration, ingestion run, commit or push performed by this resolution.
  Live database content and rendered-page visual QA were not verified in this pass.
