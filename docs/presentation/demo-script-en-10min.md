# MoneyTamNgan presentation and demo script

Issue #130. Owner preference: **English, 10 minutes**, confirmed 16 November 2026. The organizer's formal time limit must still be confirmed. The editable deck is [moneytamngan-demo-en-10min.pptx](moneytamngan-demo-en-10min.pptx). This is presentation preparation, not a recorded or rehearsed demo.

## Timing and narration

The allocations total 600 seconds, including the live walkthrough. Practice against a timer before delivery. Notes identify supported claims and limitations; do not read source URLs aloud.

### 1. MoneyTamNgan (0:00–0:30, 30 seconds)

Introduce the users: software contractors reviewing Thai government procurements. Our system helps locate relevant projects, read evidence and prepare a draft. It does not submit bids or make procurement decisions.

### 2. The contractor’s task (0:30–1:20, 50 seconds)

Explain why a metadata record alone cannot establish an open bidding window. Official announcements carry the submission dates. Missing or uncertain evidence stays unknown instead of becoming an eligible opportunity.

### 3. Government document acquisition (1:20–2:25, 65 seconds)

The implementation uses official RSS B0/D0 links and an HTTP acquisition path. Browser fallback uses Puppeteer. Explain that anti-bot challenges and government downtime still limit retrieval. A successful metadata request does not prove that a TOR PDF is available.

### 4. Thai document analysis (2:25–3:30, 65 seconds)

Explain embedded text versus scanned images. Gemini Flash produces structured summaries and restrictive-condition explanations such as vendor lock-in, extreme experience requirements and disproportionate hardware demands. Year extraction must refer to evidence, not the current calendar year. OCR errors or missing sections remain limitations.

### 5. MongoDB provenance (3:30–4:15, 45 seconds)

Show the physical collections: projects, documents, extractionruns, documentpages, documentsummaries and processingjobs. Source-file retention is configurable. The usual link-only flow retains URLs, extracted text and summaries, while cleaning temporary files. Do not promise every historical project has a usable PDF or fiscal year.

### 6. Bid preparation walkthrough (4:15–5:55, 100 seconds)

Live demo: open a prepared fixture TOR, show the company profile, open a saved draft, edit one section and save. Reload to demonstrate persistence. Show source labels and a placeholder, export DOCX and show checklist status/reason/page plus proposal sources. The screenshot uses fictitious test data. Generation may use the existing worker and Vertex, but the demo should use a prepared record to avoid relying on government availability.

### 7. Security controls (5:55–6:55, 60 seconds)

Explain 401 versus 403 and 404 ownership protection. Password login stores scrypt hashes and Google OAuth remains available. Show the ASVS/STRIDE and SAST/DAST evidence without exposing credentials. CI green is not proof that every threat has been eliminated. Documentation PR 196 still needs review and merge at preparation time.

### 8. Verified behavior (6:55–7:55, 60 seconds)

Use the committed evidence rather than inventing current production counts. PR 166 documents live isolated company-profile tests. PR 168 documents real Atlas/browser draft testing, including eight concurrent creates under a cap of five. Those fixtures simulate the generator response shape and do not establish new live Vertex or government reliability.

### 9. Operational limits (7:55–8:55, 60 seconds)

Describe the new proposed health policy: latest 100 acquisition attempts, minimum sample 20, proposed success target 90 percent, and a degraded state after five consecutive failures. These are thresholds, not achieved measurements. Source telemetry excludes benchmark probes. The user explicitly deferred SMTP setup issue 165. No claim of actual inbox delivery.

### 10. Team ownership and next steps (8:55–10:00, 65 seconds)

Ownership reflects the project board snapshot on 16 November 2026, not a claim of exclusive authorship. Close with the user workflow and honest remaining acceptance: screenshots in Word/Google Docs, live reliability cohort, actual SMTP delivery, team review and deployment rehearsal. The owner selected English and ten minutes; organizer time-limit confirmation remains an external planning check.

## Live demo actions (slide 6, 100 seconds)

1. Before recording, prepare a disposable account and a processed fixture TOR on the deployed demo instance. Confirm the TOR summary and source references are already available. Use no production personal data.
2. 0–20s: show profile fields and a fictitious past project. Explain that saving belongs to the signed-in user.
3. 20–40s: open the saved draft, point to its source labels and AI/non-submission warning.
4. 40–65s: change one sentence, save, reload and show persistence. Keep a second tab available to demonstrate a version conflict only if time permits.
5. 65–100s: export the reviewed saved version, open the DOCX and show the checklist reason/page and highlighted missing-information placeholder. Explain that manual checklist status is not a pass.

If live connectivity fails, show the committed fixture screenshots/sample DOCX and label them as a recorded test fixture. Do not claim a new live government retrieval or Vertex run. SMTP delivery remains deferred to #165.

## Video recording and rehearsal checklist

- Record the actual deployed app at 1920×1080 with English narration, within the confirmed organizer limit. A slide animation or fixture render alone is not evidence of a deployed-system video.
- Hide environment files, tokens, connection strings, real emails, billing pages and notifications. Use fictitious contractor details.
- Refresh every displayed number and screenshot on demo day. Avoid promising an achieved 90% acquisition rate or universal fiscal-year coverage.
- Keep the recording on the demo machine and a team-accessible Drive folder. Do not change sharing permissions until the intended team destination is known.
- Conduct one timed whole-team rehearsal. A teammate who did not author the deck checks spelling, content and sources.
- Attach final deck/video links and rehearsal duration to #130. These human/team checks are pending, not automatically completed.

## Source evidence

- [Company profile PR #166](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/166) and [fixture evidence](../evidence/company-profile/http.json).
- [Draft/editor/export PR #168](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/168) and [fixture evidence](../evidence/bid-drafts/http.json).
- [Security specification PR #196](https://github.com/MoneyTamNgan/MoneyTamNgan/pull/196), still subject to its review/merge gate.
- [Current scraper work](../scraper-resilience-health.md) and dated benchmark evidence.

The deck includes speaker notes and editable text. Its screenshot comes from the actual fixture editor and contains fictitious data. Package/layout checks and slide renders passed locally; no native PowerPoint check is claimed.
