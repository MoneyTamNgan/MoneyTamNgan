# Security presentation: walkthrough for slides 11-15

Slides 11-15 of `MoneyTamNgan_Security.pdf`: audit logging, HTTP headers, SAST, DAST, STRIDE priorities.
Every claim below was checked against this repo on 22 Nov 2026. "Say" lines are in English because the slides are.

## 0. The project in 60 seconds (say this if asked "what is it?")

MoneyTamNgan finds Thai government software tenders (TORs) on e-GP, downloads and reads the PDFs (OCR for scans),
summarizes them with Vertex AI, shows them in a Next.js dashboard, matches them to a company profile, and helps a
seller draft a bid (Bid Prep). Stack: Next.js + React, Node route handlers, MongoDB, Docker. It handles accounts,
company data, AI output and downloaded files, so security matters.

Mental model for the five slides: **logging (what happened) -> headers (what the browser enforces) ->
SAST (scan the code) -> DAST (scan the running app) -> STRIDE (which threats, in what order)**.

## Slide 11: Security events and audit evidence

- **What it means:** an audit log is a record of who did what, when, and from where, so you can investigate later.
- **Code:** `lib/auth-audit.js`, function `logAuthAudit(request, event, reason, extra)`. It writes one JSON line
  (event, reason, timestamp, path, clientAddress, optional userId/role) with `console.warn`. It never logs
  passwords, tokens or OAuth query strings, and a logging failure cannot break login (it is wrapped in try/catch).
- **Events that exist (checked in code, including multi-line calls):** `auth_login_success`, `auth_login_failed`
  (wrong password or disabled account), `auth_register_success`, `auth_register_conflict`, `auth_rate_limited`,
  `auth_logout`, `oauth_login_success`, `oauth_callback_denied`, `oauth_callback_failed`, `oauth_invalid_state`,
  `oauth_rate_limited`, `oauth_callback_conflict`.
- **CORRECTION (22 Nov): the slide is out of date.** Slide 11 says password signup/login/logout logging is "not yet
  complete". That was true in the 19 Nov audit, but commit `212e1fd` (21 Nov) added the rest, and
  `docs/security/THREAT_MODEL.md` now marks TH-4 as Mitigated. **Update the slide** to say login success/failure,
  signup, rate limits and logout are logged. The remaining honest limits: logs go to stdout only (no central
  store, no tamper protection), and the "90-day retention" is a written policy, not something the code enforces.
  (An earlier version of this guide wrongly said failed logins were not logged; my grep missed multi-line calls.)
- **Say:** "We log security-relevant auth events with an allow-listed set of fields, so we never leak secrets into
  logs. Logs go to stdout; centralised storage and tamper protection are future work. This addresses STRIDE
  threat TH-4, repudiation."
- **Likely questions:**
  - *Why not log the password/token?* Logs are widely readable and long-lived; secrets in logs are a leak (OWASP logging guidance).
  - *Where do logs go?* stdout (container logs). No central store yet; we say so.

## Slide 12: HTTP security headers

- **What it means:** response headers that tell the browser to enforce safety rules.
- **Code:** `lib/security-policy.js` (builds the headers, CSP with a per-request nonce), `proxy.js`,
  `next.config.js` (`poweredByHeader: false`). Test: `tests/security/scopes-cors-headers.test.js`.
- **One line per header (memorize these):**
  | Header | Protects against |
  |---|---|
  | Content-Security-Policy | XSS: only our own scripts run; `frame-ancestors 'none'` blocks embedding; `object-src 'none'` |
  | Strict-Transport-Security | forces HTTPS for a year (`max-age=31536000`) |
  | X-Frame-Options: DENY | clickjacking (old-browser twin of `frame-ancestors`) |
  | X-Content-Type-Options: nosniff | browser guessing a file type and running it |
  | Referrer-Policy | leaking full URLs to other sites |
  | Permissions-Policy | camera, microphone, geolocation turned off |
  | X-Powered-By removed | hides that it is Next.js |
- **Honest caveat (a professor may ask):** `style-src 'unsafe-inline'` is allowed because the React charts use
  style attributes. **Scripts do not get `unsafe-inline`**; they use nonce + `strict-dynamic`. That is exactly
  the one Medium finding on slide 14.
- **Say:** "Headers are our browser-side defense layer. The CSP uses a per-request nonce so injected scripts won't run."
- **Live demo (30 s):** run the app, then `curl -I http://localhost:3000/` and point at the headers; or open
  DevTools -> Network -> click the page request -> Response Headers. The README says the team should show this.

## Slide 13: Security testing and SAST

- **What it means:** SAST = static analysis, scan the *source code* without running it. Tool: **Semgrep**,
  ruleset `p/owasp-top-ten`, run on every CI pipeline (`.github/workflows/semgrep.yml`).
- **Numbers on the slide:** 0 High, 50 warnings, 800 tests (340 Node + 460 Vitest).
  - **Warning count mismatch to know about:** the README quotes 50 warnings from the 19 Nov same-code run, but the
    committed `docs/security/reports/sast-report.json` (12 Nov snapshot) has **47**:
    25 `plaintext-http-link`, 17 `github-actions-mutable-action-tag`, 4 `gha-workflow-env-secret`, 1 `raw-html-format`.
    If asked, say "about 50, mostly low-risk hygiene warnings; none are High; the committed report shows 47."
  - Warnings do not fail the build; High (ERROR) does (`scripts/ci/summarize-sast.py`). The older
    `sast-report.before-fix.json` (1 ERROR, 18 findings) shows the gate really blocks. That's a good story:
    "we found a High, fixed it, and the gate now passes".
  - Security tests live in `tests/security/` (password storage, scopes/CORS/headers, rate limit, zip-slip,
    URL safety, file signature, disabled sessions, Bid Prep access).
  - The 800 includes tests unrelated to security; and the README admits the API documentation audit failed.
- **Say:** "SAST reads our code and flags risky patterns. We have zero High findings, and CI fails if a High appears."
- **Likely questions:** *Does 0 High mean secure?* No. SAST misses logic bugs like broken authorization, which is why
  we also have ownership/scope tests and DAST.

## Slide 14: Dynamic scan (DAST)

- **What it means:** DAST tests the *running* app from outside. Tool: **OWASP ZAP baseline**
  (`.github/workflows/zap-dast.yml`), which starts the production Docker image and scans `http://localhost:3000`.
- **Passive and unauthenticated:** it only watches normal responses, it does not attack, and it can't see pages
  behind login. That limit is on the slide; say it before they ask.
- **Result (checked in `zap-dast-report.json`): 0 High, 1 Medium, 3 Low, 4 Informational.**
  - Medium: CSP `style-src 'unsafe-inline'` (same trade-off as slide 12).
  - Low: missing Cross-Origin-Embedder/Opener/Resource-Policy headers.
  - Info: content-type header missing, sensitive info in URL, cacheability.
- **Say:** "ZAP crawled the running app and found no High issues. The one Medium is the inline-style allowance we
  chose for the charts. Because it is passive and unauthenticated, we cover logged-in behavior with separate tests."
- **Likely questions:** *Why not fix the Medium?* Removing inline styles means rewriting the chart components;
  scripts are already protected, so the real XSS risk is low, and we documented the trade-off.

## Slide 15: STRIDE threats, mitigations and priorities

- **STRIDE** = Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.
  Use one example each from `docs/security/THREAT_MODEL.md`:
  | Letter | Example in our project |
  |---|---|
  | S | forged session -> signed, role-scoped tokens (TH-1) |
  | T | malicious ZIP (zip slip), CSRF -> path checks, origin allowlist (TH-03, TH-16) |
  | R | AI draft treated as a submitted bid -> notices say "draft, you submit" (TH-15) |
  | I | one user reading another's draft -> `session.sub` in every query, 404 (TH-12) |
  | D | flooding / expensive AI calls -> rate limits, 5 drafts/hour (TH-7, TH-13) |
  | E | admin elevation -> signup always `role=user` (TH-8) |
- **Priorities (P0/P1/P2)** come from `docs/security-assignment-audit-2026-11-19.md` and are **audit
  recommendations, not something the team formally approved**. Say that.
  - **P0 credentials:** an API key was exposed earlier. The owner confirmed on 21 Nov that the old Resend key was
    revoked. Excluding `.env` from git cannot revoke a leaked key.
  - **P1 access/session:** **CORRECTION (22 Nov):** the slide says logout revocation is partial. Since commit
    `212e1fd` (21 Nov), `POST /api/auth/logout` revokes the presented token (`revokeSessionToken` in
    `lib/account-status.js`) and increments `session_version`, and `tests/security/session-disabled.test.js`
    ("revokes a copied JWT immediately when POST /api/auth/logout is called") covers it. The threat model also now
    lists URL checks (TH-10) as mitigated, with a DNS-resolution check in `lib/url-safety.js`. Still true: rate-limit
    counters are per process (several instances don't share them), and the 19 Nov audit found some routes exposing
    raw error details (not re-checked by me after 21 Nov). Update slides 15 and 18 accordingly.
  - **P2 residual risk:** review and adopt the priorities.
- **Say:** "STRIDE tells us what can go wrong; we mapped each threat to code and a test, and ranked what's left.
  The top item is credentials; after that, per-process rate limits and ongoing review."

## How to prepare (about 45 minutes)

1. Read this file once (10 min), then slides 11-15 aloud with the "Say" lines.
2. Run the app and show the headers live (slide 12) and one security test:
   ```bash
   npm ci && npx vitest run tests/security
   ```
3. Open these files once so you can say "it's here": `lib/auth-audit.js`, `lib/security-policy.js`,
   `.github/workflows/semgrep.yml`, `.github/workflows/zap-dast.yml`, `docs/security/THREAT_MODEL.md`.
4. Know your honest limits: logs only go to stdout (no central store), `unsafe-inline` styles (Medium),
   rate-limit counters are per process, 0 High does not mean secure. Admitting these *earns* marks (the rubric asks
   for known gaps); hiding them loses them.
5. **Fix the slides before presenting:** slides 11, 15 and 18 still describe the 19 Nov state (incomplete logging,
   logout not revoking a copied token). The code and `THREAT_MODEL.md` moved on 21 Nov. A grader who opens the repo
   would see a mismatch.

## Things not to claim

- "Fully OWASP ASVS compliant" (the audit rates 13 criteria covered, 5 partial; the slides say no full claim).
- "No vulnerabilities" (0 High is a scanner result, not proof).
- "Logging is centralised / tamper-proof" (it is stdout only), or "90-day retention is enforced" (it is a written policy).
