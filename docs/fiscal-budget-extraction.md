# Fiscal budget year extraction

Unsupported LLM fiscal-year citations are rejected individually and recorded in `fiscal_budget.warnings`; they do not block otherwise valid summaries. Any such warning marks the summary for review. Rejected years are never treated as fiscal facts.

The existing PDF pipeline keeps raw embedded/OCR text in `documentpages.text`,
linked to a document and extraction run. Source PDF/ZIP retention remains link-only.

Fiscal budget extraction runs on this text as part of the Vertex summarization:

1. Regex recognizes explicit `ปีงบประมาณ` and `งบประมาณประจำปี` labels with Buddhist years, Thai
   numerals, OCR spaces, line breaks, and multiple stated years.
2. Gemini Flash also returns quoted fiscal-year evidence, including page numbers.
   Quotes and years are checked against the supplied source text.
3. Section 9 evidence is prioritized when identifiable. Section headings are
   determined from source text rather than trusting model-provided labels.
4. One supported year yields `found`. Multiple preferred years yield `ambiguous`
   and require review. No supported year yields `not_found`; years are never
   inferred from project IDs or calendar/contract dates.

The result belongs to the immutable summary version at
`documentsummaries.extraction.fiscal_budget`:

```json
{
  "year": 2570,
  "years": [2570],
  "status": "found",
  "method": "regex+llm",
  "evidence": [
    {
      "year": 2570,
      "page": 12,
      "clause_text": "ปีงบประมาณ 2570",
      "section": "9",
      "method": "regex"
    }
  ]
}
```

The example illustrates the field shape, not a verified government record.
`fiscal_year_evidence` also retains the model's supported evidence. The detail
and summary API responses expose `fiscalBudget`; older summaries return `null`.
Prompt version `tor-thai-risk-fiscal-v6` prevents reuse of older summaries when
reanalysis is requested. Existing summaries are preserved; run
`npm run vertex:reanalyze -- PROJECT_ID` to generate a new version
from stored text without scraping or OCR. See the command's usage for argument syntax.

Section 9 is a heuristic, not a universal TOR structure. Damaged OCR or ambiguous
historical/budget references can still need manual review. This release does not
backfill live MongoDB or add a fiscal-year display to the TOR page.
