# Security audit: SAST (Semgrep) and DAST (OWASP ZAP baseline)

Run on 2026-11-03 against `develop`. Reports are in `docs/security/reports/`.

## SAST: Semgrep `p/owasp-top-ten` (256 rules, 215 files)

| | Before | After |
|---|---|---|
| ERROR (high) | 1 | **0** |
| WARNING | 17 | 17 |

- **Fixed:** `Dockerfile` ran the app as root (`dockerfile.security.missing-user`). The runner stage now ends with `USER node` and creates `/app/storage` owned by that user. Verified: container runs as uid 1000, `/api/health` returns 200, `/app/storage` is writable.
- **No findings in application code** (`app/`, `lib/`, `models/`, `scripts/`).
- **Open, all in `.github/workflows/`:** 13 `github-actions-mutable-action-tag` (actions pinned to a tag instead of a commit SHA) and 4 `gha-workflow-env-secret` (secrets exposed at workflow level in `ingestion-schedule.yml`). Not fixed here: they are warnings, and editing workflow files needs a token with the `workflow` scope.

Existing volumes: a Docker named volume created by an earlier run of the old (root) image stays root-owned. Recreate it, or `chown -R 1000:1000` its contents, before running the new image against it.

## DAST: OWASP ZAP baseline (passive, spider 2 min)

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
