# UI test plan: every user function as a flow

Version `v1.0.0`, plan written 22 Nov 2026. Results: [test-sheet.md](test-sheet.md). Review and defects: [review-and-defects.md](review-and-defects.md). Evidence (video per flow, screenshot per step): [../evidence/testing-2026-11-22-full/](../evidence/testing-2026-11-22-full/).

## 1. Objective
Show, with a recording of each sequence, that every function a user or an admin can reach on the website works as described, that the protections (login, roles, ownership) hold, and where it does not work. A failed step is recorded as a defect; it is not hidden or retried until green.

## 2. Scope
| Area | Functions covered | Flow |
|---|---|---|
| Public (no login) | Dashboard, hero slides, keyword search, filters and sort, paging, TOR card (sends a guest to sign-in), TOR detail (guest view), document page, Analytics (filter, clear, chart mode, CSV and JSON export), theme and sidebar toggles | F01 |
| Accounts | Register (rules: password match, 15+ characters, duplicate email), log in by email and by username (case-insensitive), wrong password, log out, Google button redirect | F02 |
| Access control | Guest on `/profile`, `/admin`, protected APIs (401); normal user on admin (403); another user's draft (404) | F03 |
| Profile | Company fields, past project (add, remove), skills, certification, notification settings, save, persistence after reload, invalid value, delete company data (all fields cleared), delete account, sign-in after deletion | F04 |
| TOR as signed-in user | Detail with the signed-in-only comparison and checklist cards, own status (pass / fail / back to system value), checklist paging, "เตรียมร่างข้อเสนอ" link, document view, dashboard card links | F05 |
| BidPrep draft | Open workspace, unknown TOR error, create draft, edit and save, add section, export blocked until checklist passes, confirm every checklist item (paged), save, export DOCX, reopen, delete | F06 |
| BidPrep AI | Queue an AI draft, progress state, result or failure message, AI notice, for a small TOR and a TOR with a large scope | F07, F07b |
| Admin | Console, ingestion status, review queue and filters, admin API status (read only) | F08 |
| Responsive | Key pages at 360, 768 and 1280 px | screenshots `screenshots-2026-11-22/` |

### Not run, and why
| Function | Reason |
|---|---|
| Complete Google sign-in | Needs a real Google account; only the redirect is tested (F02-10) |
| "ทดสอบส่งอีเมล" and match-score emails | Needs SMTP/Resend credentials and a real inbox; would send mail |
| Trigger the ingestion pipeline from the admin page | Writes to the live database and starts OCR/AI; covered by `docs/admin-pipeline-control.md` and the isolated test, not by this run |
| Database or AI outage in the browser | Would take the demo machine down; covered by the API-level tests of 19 Nov |
| Classification override in the admin review queue | Changes live records; the queue is read only here |
| Microsoft Word opening the exported DOCX | No Word on the machine; the file is checked as a valid zip |
| Project-summary expand toggle, past-project evidence cards | The TORs used have no long summary; no data-correctness check of the comparison numbers |

## 3. Approach
- **Black box through the browser.** Playwright (Chromium) drives the real pages like a user: clicks, typing, navigation. Sign-in for flows other than F02 uses the login API to save time; F02 exercises the real form.
- **Every sequence is recorded** as one video (1280x720). A banner at the bottom shows the flow id and the step being performed, so the video explains itself. A screenshot is taken after every step.
- **Each step has an expected result** written before the run; the script checks it and records PASS or FAIL with what was actually observed.
- **Throw-away data.** Each flow creates its own test accounts (`e2e-ui-*@example.test`) and deletes them at the end. No real user data is used.
- **Negative and boundary cases** sit beside the happy path (wrong password, short password, mismatch, duplicate email, unknown TOR, negative number, export before the checklist passes, other user's draft).
- **Independent check.** A second reviewer (the `agy` agent) read the tests, results and product code in three rounds and challenged every step; disputed steps were fixed and re-run. Outcome and remaining limits: [review-and-defects.md](review-and-defects.md).

## 4. Environment
| Item | Value |
|---|---|
| Code | tag `v1.0.0` (`origin/main` 1df8573) |
| Machine | `napat-gf63-8rd`, Docker Compose: `app`, `worker`, `mongo` (database not used here), `scheduler` off |
| Database | MongoDB Atlas, real data (838 TORs) via `docker-compose.real-db.yml` |
| AI | First run: local model `qwen2.5:3b` through Ollama. Re-runs after 22 Nov 2026 (F07, F07b): migrated to Gemini through the `agy` CLI and the agy bridge ([../agy-bridge.md](../agy-bridge.md)); Vertex billing is not available |
| Browser | Chromium 1.49 in `mcr.microsoft.com/playwright:v1.49.1-noble`, locale `th-TH`, 1280x720 |
| Test TORs | 69109345522 (browse), 69109232352 (BidPrep, 11 checklist items), 66089621504 (large scope, 47 items) |

## 5. Entry and exit criteria
- **Entry:** `/api/health` returns 200 with `database: connected`; the machine's IP is on the Atlas access list; the app answers on `http://localhost:3000`.
- **Exit:** every planned step has a result with evidence; every FAIL has a defect note; no blocker is hidden. A flow with a FAIL is not reported as passed.

## 6. Risks
| Risk | Effect | Handling |
|---|---|---|
| Machine IP changes | Atlas refuses connections, pages hang | Re-add the IP in Atlas; check health first |
| AI is slow (76 to 92 s with the local model) | AI flows time out | Wait up to 5.5 minutes; record the outcome as is |
| Live data is shared | Tests could alter real records | Only throw-away accounts are written; admin is read only |
| UI text changes | Selectors break | Selectors use visible Thai labels; a break shows as a failed step, not a silent pass |

## 7. Evidence layout
```
docs/evidence/testing-2026-11-22/
  results.json                      every step: result, actual, time in the video, screenshot
  F01-guest-browse/
    F01-guest-browse.webm           the whole sequence
    01-01.png ... NN-NN.png         one screenshot per step
  F02-auth/ ... F08-admin/
  F06-bidprep-draft/exported-draft.docx
```
The test sheet maps each step to its video and time (`mm:ss`).

## 8. How to run again
```bash
# on the demo machine, stack up with the real database
docker run --rm --network host -v $PWD:/work -v ~/pw/node_modules:/work/node_modules:ro \
  -w /work/tests/e2e/ui -e EVIDENCE_DIR=/work/docs/evidence/testing-run \
  -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... mcr.microsoft.com/playwright:v1.49.1-noble node flows.mjs
python3 tests/e2e/ui/make-sheet.py docs/evidence/testing-run docs/testing/test-sheet.md
```
`F08-admin` needs an account promoted with `docker compose run --rm worker npm run user:promote -- <email>`; the flow deletes it afterwards. Set `FLOWS=F01-guest-browse,F02-auth` to run a subset.

## 9. Defect handling
A failed step is copied to the "Defects found" section of the test sheet and analysed in [review-and-defects.md](review-and-defects.md) with its video, severity and cause. Product code is not changed by the tester in this run.
