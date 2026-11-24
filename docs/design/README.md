# Design document

MoneyTamNgan has no separate software design specification. This page is the design document: it indexes the design material that already describes the running code, and it maps each part to the SRS. It does not add behaviour that the code does not implement.

Requirement ids follow the convention in [traceability.md](../traceability.md#requirement-id-convention). Main SRS ids stay `FR-1.x` … `FR-4.2.x` and `NFR-1` … `NFR-6`. Bid Preparation ids are written `BidPrep FR-4.x`.

The main SRS still has empty use-case and UI-design placeholders. Those drawings are not in this repository, so they are not reproduced here.

## Design set

| Part | What it describes (as implemented) | SRS |
|---|---|---|
| [Architecture, data flow, trust boundaries](../audit/01-architecture.md) | Next.js app, worker, scraper, scheduler, MongoDB, and the external edges (e-GP, AI provider, Google OAuth, SMTP). The AI edge is Vertex, a local Ollama model, or Gemini through the agy bridge. | FR-1.1.1, FR-1.1.2, FR-2.1.1, FR-2.1.2, FR-2.3.3, NFR-3, NFR-5 |
| [Data model and ER diagram](../audit/02-data-model-er.md) | Collections, relations and the unique indexes that prevent duplicate projects, documents, pages, summaries and notification deliveries. | FR-1.1.2, FR-1.1.3, FR-1.3.1, FR-2.2.1, FR-4.1.1, BidPrep FR-4.1, BidPrep FR-4.3 |
| [Design patterns](../audit/03-design-patterns.md) | Patterns that exist in the code (security wrapper, AI adapter, job queue, idempotency, ownership filter, export gate) and the trade-offs of those choices. | FR-1.1.3, FR-2.1.1, FR-4.2.2, BidPrep FR-4.3.2, BidPrep FR-4.4.1, BidPrep FR-4.7.1 |
| [TOR pull pipeline](../pipeline.md) | Stage flowchart from e-GP metadata to a searchable record, with `processing.status` and the code that owns each stage. | FR-1.1.1, FR-1.1.2, FR-1.2.1, FR-1.2.2, FR-2.1.1, FR-2.1.2 |
| [Sequence: discovery, extraction, display](../tor-flow.md) | Actor sequence for the same pipeline. Source diagram: [tor-discovery-extraction-display.mmd](../diagrams/tor-discovery-extraction-display.mmd). | FR-1.1.1, FR-1.1.2, FR-1.3.1, FR-1.3.2, FR-1.3.3, FR-2.1.3, FR-4.2.1 |
| [API contract](../api/openapi.yaml) | HTTP interface of the Next.js route handlers. Overview: [api/README.md](../api/README.md). | FR-1.1 through FR-4.2, BidPrep FR-4.1 through BidPrep FR-4.7 (except the deferred ids below) |
| [Technical reference](../reference.md) | Pipeline, storage, Vertex, the AI provider switch and Thai OCR. Fallback behaviour: [agy-bridge.md](../agy-bridge.md). | FR-2.1.1, FR-2.1.2, NFR-5 |

Security design (threat model, authentication, RBAC, ASVS notes, BidPrep privacy) lives under [security/](../security/README.md). It traces to BidPrep FR-4.7 and to NFR-4 for public rate limits. The rest of that catalog is ASVS, not an SRS functional requirement.

## Behaviour the code actually implements

These are the design decisions a reader would otherwise have to recover from the source.

- **Duplicate projects** are rejected by the unique `project_id` index on `projects` and on `discoverycandidates` (`models/Project.js`, `models/DiscoveryCandidate.js`). That is FR-1.1.3.
- **Revision lineage** stores `previous_document_id` and supersession fields and is covered by `tests/unit/tor-lineage.test.js`. The UI test sheet does not show a superseded TOR. See FR-1.3.1–FR-1.3.3 in the traceability matrix.
- **Budget baseline** is the historical category **median** once three earlier budgets of the same software/non-software class exist; otherwise the TOR's own budget is the baseline and the high-budget tag is not applied (`lib/budget-anomaly.js`, `baseline_method` `historical_category_median` or `tor_budget_fallback`). The main SRS text says "category average". The code and [budget-baseline-policy.md](../budget-baseline-policy.md) implement the median. Deviation multiplier is TOR budget / baseline, and `HIGH_BUDGET_ANOMALY` is set only when the multiplier is strictly above 1.5 (FR-3.1.2, FR-3.1.3).
- **Restrictive clauses** are stored with the clause text, category and reasoning (`lib/flagged-clauses.js`). Categories used by the API schema include irrelevant hardware, unrealistic tenure and vendor lock-in (FR-3.2.1–FR-3.2.3).
- **Executive summary** is the stored extraction summary, mapped onto the TOR response by `lib/services/project-mapper.ts` (FR-2.1.3).
- **Match score** is `calculateSkillMatchScore` (skill overlap). `lib/api/tor-response.js` returns it for a signed-in user. Threshold mail uses the same score (`lib/services/notification-service.js`). There is no separate weighted formula for contract size and team capacity in that score (FR-2.3.2). The profile stores capacity and past-project value for the checklist, not as extra score terms.
- **AI provider.** Vertex is primary. `AI_FALLBACK_PROVIDER=ollama` sends one refused Vertex generation to the Ollama adapter. The demo points that adapter at the agy bridge. Embeddings do not fall back.
- **Bid preparation** keeps drafts on the signed-in user, labels AI text, requires a source or a `[to fill in: ...]` placeholder, and exports DOCX only after the checklist passes. Nothing in this surface submits a bid to e-GP.

## Not implemented, so not designed here

| Id | SRS status | What the repository does |
|---|---|---|
| BidPrep FR-4.4.2 | PDF export, deferred | No PDF export of a bid draft |
| BidPrep FR-4.5 | Document pack, deferred | No user-upload pack |
| BidPrep FR-4.6 | Deadline email, deferred | Match-threshold mail exists (main SRS FR-2.3.3). A bid-deadline reminder does not |
| NFR-2 | Self-reported data is not verified | The profile stores what the user types. There is no document-check workflow and no card |

Audit controls, the incident-response runbook and the privacy notice are operational documents, not extra product design: [04-controls-and-evidence.md](../audit/04-controls-and-evidence.md), [05-incident-response-runbook.md](../audit/05-incident-response-runbook.md), [06-privacy-notice.md](../audit/06-privacy-notice.md).
