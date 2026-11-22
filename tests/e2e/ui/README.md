# UI flow tests (Playwright, recorded on video)

Plan: [docs/testing/test-plan.md](../../../docs/testing/test-plan.md). Results: [docs/testing/test-sheet.md](../../../docs/testing/test-sheet.md).

| File | What it is |
|---|---|
| `flows.mjs` | The flows F01 to F08 (guest, auth, access control, profile, TOR detail, BidPrep draft, BidPrep AI, admin) |
| `lib.mjs` | Runner: one browser context per flow, a video of the whole flow, a banner with the current step, a screenshot per step, `results.json` |
| `make-sheet.py` | Builds `docs/testing/test-sheet.md` and `.csv` from `results.json` |
| `discover.mjs` | Dumps the controls of each page (used to write selectors) |
| `screenshots.mjs` (in `tests/e2e/`) | Screenshots at 360, 768 and 1280 px |
| `debug-checklist.mjs` | Network trace of the checklist status buttons (used to tell a test timing problem from a product problem) |

## Run (Docker only)
The stack must be up (`docker compose up -d`, or with the real database override) and `http://localhost:3000/api/health` must return 200.

```bash
mkdir -p ~/pw && docker run --rm -v ~/pw:/pw -w /pw mcr.microsoft.com/playwright:v1.49.1-noble \
  sh -c "npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.49.1"      # once

docker run --rm --network host -u $(id -u):$(id -g) -e HOME=/tmp \
  -v $PWD:/work -v ~/pw/node_modules:/work/node_modules:ro -w /work/tests/e2e/ui \
  -e EVIDENCE_DIR=/work/docs/evidence/testing-run \
  -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... \
  mcr.microsoft.com/playwright:v1.49.1-noble node flows.mjs

python3 tests/e2e/ui/make-sheet.py docs/evidence/testing-run docs/testing/test-sheet.md ../evidence/testing-run
```
- `FLOWS=F01-guest-browse,F02-auth` runs a subset. `BASE_URL` points at another host. `TOR_ID`, `TOR2_ID`, `TOR_AI_ID` choose the TORs.
- `F08-admin` needs an account promoted with `docker compose run --rm worker npm run user:promote -- <email>`; the flow deletes it at the end. Without `ADMIN_EMAIL` the flow fails on purpose.
- Do not start two runs at once: the output folder is shared and the sign-in limit (30 per 15 minutes per address, `docs/security/AUTHENTICATION.md`) is shared. `apiLogin` waits for `Retry-After` if it is hit.

## Rules the tests follow
- Every step has an expected result written first and an assertion that fails when the feature breaks. A step that cannot apply is removed from the sheet, not passed.
- A failing step stays failed. Product defects are recorded, not worked around.
- Test accounts are `e2e-ui-*@example.test` and are deleted at the end of each flow.
- The test browser runs with `bypassCSP: true` because the page CSP forbids the polling Playwright uses (`waitForFunction`). The CSP header itself is checked in F03 step 07.
