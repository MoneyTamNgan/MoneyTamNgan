# Security audit: SAST (Semgrep) and DAST (OWASP ZAP baseline)

BidPrep FR-4.7 (issue #142) is recorded in [bid-prep-fr-4.7.md](bid-prep-fr-4.7.md), [THREAT_MODEL.md](THREAT_MODEL.md) and [ASVS_CHECKLIST.md](ASVS_CHECKLIST.md). TH-11 onward cover prompt injection, BOLA, Vertex cost, company-data leakage and AI-draft accuracy.

## Automated in CI (issue #106)

| Workflow | Runs | What it does | Fails the build when |
|---|---|---|---|
| `.github/workflows/semgrep.yml` | push/PR to `develop` and `main`, weekly, manual | `semgrep --config p/owasp-top-ten` over the repo; uploads `sast-report.json` as an artifact and writes a summary to the run page | any **ERROR** (High) finding, or a scan error that is not a warning-level parse issue |
| `.github/workflows/zap-dast.yml` | PR to `main`, weekly, manual | builds the production Docker image against a throwaway MongoDB, runs the ZAP baseline container against `http://localhost:3000`, uploads `zap-dast-report.json/.html` | any **High**-risk alert, or a ZAP scan error |

Both gates are implemented in `scripts/ci/summarize-sast.py` and `scripts/ci/summarize-zap.py`, which also work locally: `python3 scripts/ci/summarize-sast.py docs/security/reports/sast-report.json`. Checked against the committed files: the current SAST report passes (0 ERROR) and `sast-report.before-fix.json` fails (1 ERROR), as intended. WARNING-level findings do not fail the build. The 2026-11-12 snapshot has 47 WARNING; the original audit further down had 17. Warning-level Semgrep parse errors (for example an unknown YAML escape, or a GitHub Actions expression a rule cannot parse) are also listed and do not fail the build.

`sast-report.json`, `zap-dast-report.json` and `zap-dast-report.html` are the committed snapshot from the latest green runs below. `sast-report.before-fix.json` and `zap-dast-report.before-fix.json` stay as the pre-fix baselines from the 2026-11-03 audit. Refresh the snapshot by downloading the artifacts from a green Semgrep run on `main` and a green ZAP baseline run.

Limitations: the workflows use `actions/checkout@v4` and `actions/upload-artifact@v4` by tag, like the existing ones (the mutable-tag warning in the latest snapshot applies to them too). ZAP stays a passive, unauthenticated baseline.

## Latest snapshot (2026-11-12, Asia/Bangkok)

Refreshed from green GitHub Actions runs for issue #106. High and Critical counts are 0 in both reports. This snapshot does not close #106: later schema work is still open, and teammate review is still required.

| Scan | When (Asia/Bangkok) | Run | Commit |
|---|---|---|---|
| Semgrep `p/owasp-top-ten` 1.185.0 | 2026-11-12 10:40 | [43149747703](https://github.com/MoneyTamNgan/MoneyTamNgan/actions/runs/43149747703) | `97ed9d7e373f860a0f85a872f7bc9d83e5dcbe86` (`main`, after #151) |
| OWASP ZAP baseline 2.17.0 | 2026-11-12 10:41 | [43149638506](https://github.com/MoneyTamNgan/MoneyTamNgan/actions/runs/43149638506) | `85cb4d597267d306c0640ea77ca72629e7b336ca` (develop-to-main promotion PR, includes BidPrep #149) |

The ZAP artifact also contains `zap.yaml` (the automation plan for that run). It is not part of the repo snapshot. The committed names stay `zap-dast-report.json` and `zap-dast-report.html`.

### SAST

263 files scanned. 0 ERROR (High), 47 WARNING, 0 INFO. Two warning-level scan errors do not fail the build: an unknown escape in `docs/api/openapi.yaml`, and a GitHub Actions expression in `.github/workflows/ci.yml` that a rule cannot parse as Bash.

| WARNING rule | Count | Status |
|---|---|---|
| `github-actions-mutable-action-tag` | 17 | Still planned. Actions are pinned to a tag, including `semgrep.yml` and `zap-dast.yml` (the November audit had 13). Pinning to a commit SHA needs a workflow-scoped change. |
| `plaintext-http-link` | 25 | Only inside the ZAP HTML that was already committed at this Semgrep commit (`http://localhost` from the baseline). Not application code. Treated as report noise. The next Semgrep run will recount these lines against the HTML replaced here. |
| `gha-workflow-env-secret` | 4 | Still planned. The same four workflow-level secrets in `ingestion-schedule.yml` as the November audit. |
| `raw-html-format` | 1 | `lib/oauth-security.js` builds the HTTP 429 HTML redirect. The interpolated value is the rate-limiter reset time (`Date.now()` plus the window), not an OAuth query parameter. Treated as a taint false positive, not an open fix. |

No ERROR findings in application code. The Dockerfile non-root fix from the November audit is still clean.

### DAST

Passive baseline, two-minute spider, production image on a throwaway MongoDB. ZAP risk code 3 (High) is 0. This baseline report has no separate Critical risk code.

| Risk | Alerts | What remains |
|---|---|---|
| High | 0 | none |
| Medium | 1 | `CSP: style-src unsafe-inline` |
| Low | 3 | COEP, COOP and CORP headers missing |
| Informational | 4 | missing Content-Type on `/profile`; cacheability notes; ZAP's own `password=ZAP` query |

**Fixed relative to the committed 2026-11-03 ZAP snapshot:** the Medium alert "Content Security Policy (CSP) Header Not Set" is gone. The scanned image sends a policy with a per-request script nonce, `strict-dynamic` and `frame-ancestors 'none'`. The clickjacking headers from that audit are still absent as findings.

**Accepted:** `style-src 'unsafe-inline'` is the exception already recorded for React chart style attributes; production scripts do not get `unsafe-inline` (see [the HTTP security report](../http-security-implementation-report.md)). COEP, COOP and CORP stay off so they do not break the Google OAuth redirect or third-party images. "Sensitive Information in URL" is the scanner appending `password=ZAP` to `/`; the application does not put a password in the URL. Cache findings are `no-store` on pages and a long `max-age` on `/_next/static` assets.

## Original audit (2026-11-03, `develop`)

Counts in this section are the original before/after audit. The files without a `.before-fix` suffix are the 2026-11-12 snapshot above, not these totals. The "no CSP" follow-up below is superseded by the nonce policy in the latest DAST snapshot.

### SAST: Semgrep `p/owasp-top-ten` (256 rules, 215 files)

| | Before | After |
|---|---|---|
| ERROR (high) | 1 | **0** |
| WARNING | 17 | 17 |

- **Fixed:** `Dockerfile` ran the app as root (`dockerfile.security.missing-user`). The runner stage now ends with `USER node` and creates `/app/storage` owned by that user. Verified: container runs as uid 1000, `/api/health` returns 200, `/app/storage` is writable.
- **No findings in application code** (`app/`, `lib/`, `models/`, `scripts/`).
- **Open, all in `.github/workflows/`:** 13 `github-actions-mutable-action-tag` (actions pinned to a tag instead of a commit SHA) and 4 `gha-workflow-env-secret` (secrets exposed at workflow level in `ingestion-schedule.yml`). Not fixed here: they are warnings, and editing workflow files needs a token with the `workflow` scope.

Existing volumes: a Docker named volume created by an earlier run of the old (root) image stays root-owned. Recreate it, or `chown -R 1000:1000` its contents, before running the new image against it.

### DAST: OWASP ZAP baseline (passive, spider 2 min)

Target: the production Docker image on a throwaway MongoDB (Atlas was not touched).

| Risk | Before | After |
|---|---|---|
| High / Critical | 0 | 0 |
| Medium | 2 (no CSP, no anti-clickjacking) | 1 (no CSP) |
| Low | 6 | 3 (COEP, COOP, CORP) |
| Informational | 3 | 3 |

- **Fixed in `next.config.js`:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and the `X-Powered-By` header is removed.
- **Accepted / follow-up:** no Content-Security-Policy. A `frame-ancestors`-only policy was tried and made ZAP raise four CSP-quality alerts (no fallback directive, wildcard, `unsafe-inline` for scripts and styles), so it was dropped. A real policy needs per-request nonces for Next.js inline scripts. COEP/COOP/CORP are left off because they can break the Google OAuth redirect and third-party images.
- The baseline scan is passive and unauthenticated; it does not exercise the admin pages or any state-changing API.
