# TOR pipeline benchmark

Runs five TOR-fetching pipelines on the same project set and scores every
pipeline with the same rules (`evaluate()` in `adapters.js`).

| Key | Pipeline | Browser |
|---|---|---|
| P1 | `lib/scraper.js` — aggregator → Puppeteer → e-GP JSON APIs | yes |
| P2 | `egp_scraper.py` — team Playwright scraper (click-through) | yes |
| P3 | RSS `B0` → `downloadFileTest` ZIP | no |
| P4 | RSS `D0` → invitation PDF (closing date) | no |
| P5 | Hybrid: P4 + P3, fall back to P1 with retry + circuit breaker | when needed |

## Setup

```bash
python3 -m venv bench/.venv
bench/.venv/bin/pip install playwright pypdf
bench/.venv/bin/python -m playwright install chromium
export BENCH_PYTHON=bench/.venv/bin/python
```

## Run

```bash
npm run bench -- --discover-depts --from=0101 --to=2512   # slow, sequential
npm run bench -- --build-set=a --limit=200                # open tenders (RSS)
npm run bench -- --build-set=b --limit=50                 # older projects (govspending)
npm run bench -- --set=bench/set-a.json --pipeline=all --run-label=morning
npm run bench -- --compare=morning,afternoon,night
```

Keep RSS requests sequential: parallel requests made the feed stop responding.

## Metrics

- `coveragePct` — projects the pipeline has a route for
- `fetchedPct` — at least one PDF obtained
- `usefulTorPct` — a TOR-named PDF obtained (scanned TORs count; they go to OCR)
- `torTextReadyPct` — TOR PDF has embedded text (no OCR needed)
- `closingDatePct` — submission window parsed by `lib/egp-announcement.js`
