# Budget baseline policy

The existing historical median policy now starts at three distinct valid samples, rather than five. Category means the project's current binary `is_software` classification (`software` or `non_software`); no technology/subcategory taxonomy is inferred. If a narrower business taxonomy is required, define it before comparing those categories.

## Calculation

- Use other projects of the same category with positive finite numeric TOR budgets. Exclude the target's project ID and count each peer ID only once.
- Historical means announced strictly before the target's announcement date. When the target has no valid announcement date, use records created strictly before its creation date instead. Undated/unknown-category targets conservatively have no eligible history.
- `N < 3`: baseline equals the target TOR budget, multiplier equals `1`, no high-budget tag. This means insufficient comparative evidence, not proof that a price is reasonable.
- `N >= 3`: baseline is the exact median historical category budget (average of middle two values for even counts).
- Deviation multiplier is `TOR budget / baseline`. Do not round before comparing or persisting.
- Strictly `> 1.5`: set `high_budget_flag:true` and add `HIGH_BUDGET_ANOMALY`. Exactly `1.5` is not flagged.
- A later recalculation removes a stale high-budget tag when no longer warranted, preserving unrelated tags and clause/risk evidence.
- Missing, zero, negative, nonnumeric or non-finite target budgets have no valid baseline: store `baseline_price:null`, `baseline_method:unavailable`, multiplier `1` as the existing API's neutral sentinel, and no high-budget flag. Do not interpret this sentinel as a successful price assessment.

The source is the canonical numeric `projects.budget`, not a guessed OCR figure or a bid-closing-year estimate. Historical samples can include older open projects; historical chronology does not itself assert a completed contract. No arbitrary first-500 sample cap is used. At larger data volumes the exact-median query should be profiled/indexed or replaced with an equivalent versioned baseline service; it currently reads eligible peer IDs and budgets only.

## Storage and execution

`projects.anomalies` stores `baseline_price`, `baseline_sample_count`, `baseline_method`, `baseline_category`, `baseline_reference_date`, `budget_deviation_multiplier`, `high_budget_flag` and `tags`. Clause evidence is not overwritten. These are project-level budget findings, not immutable Vertex-summary text.

The main project processor updates this assessment once software is confirmed, before document retrieval/Vertex, so missing documents or disabled AI do not prevent metadata-based budget evaluation. Stored-text reanalysis and cached-summary reuse also refresh it; the latter makes no additional Vertex call. Existing records are not bulk-rewritten by deploying this code and are refreshed when processed/reanalyzed. A summary-less record can still get its budget assessment through normal processing.

The list/anomaly APIs expose optional `baselinePrice`, `baselineSampleCount`, `baselineMethod` and `tags` after calculation. High-budget entries in the TOR detail's existing `anomalies` array include `tag:HIGH_BUDGET_ANOMALY` and baseline evidence. Existing names remain unchanged. The older project mapper prefers the stored baseline over reverse-calculating it from a rounded legacy multiplier.

This flag is a comparative review signal, not a conclusion of wrongdoing or a like-for-like scope assessment. Category breadth, project scope, procurement date, inflation and the quality of historical budgets limit its interpretation. No cloud calls or production backfill are required to test the policy.
