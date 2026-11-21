# MoneyTamNgan - Security Evaluation & ASVS Cross-Check Report

- **Project:** MoneyTamNgan (Thai Procurement TOR Aggregator & BidPrep Assistant)
- **Framework:** Next.js 16 (App Router), React 19, MongoDB Atlas, Node.js
- **Standards:** OWASP ASVS v4.0.3 L2, OWASP Top 10, STRIDE Threat Model
- **Generated Date:** 21 November 2026 (Post-remediation verified)

---

## 1. Executive Summary
This document provides a comprehensive cross-check between the course presentation security evaluation criteria (Items 4 through 18) and the technical implementations in the `MoneyTamNgan` production codebase. Every listed requirement is verified against corresponding OWASP Application Security Verification Standard (ASVS) v4.0.3 requirements, automated CI/CD security pipelines (Semgrep SAST, OWASP ZAP DAST), and the STRIDE threat model.

---

## 2. Security Requirements Cross-Check Matrix (Items 4 - 18)

| No. | Evaluation Requirement | Mapped ASVS Requirements | Status | Primary Codebase Implementation |
|---|---|---|---|---|
| 4 | **Password authentication** | V6.2.1 - V6.2.8 | Fully Implemented | `lib/password-auth.js`, `app/api/auth/login/route.js`, `app/api/auth/register/route.js` |
| 5 | **Social SSO with OAuth/OpenID** | V10.4.1 - V10.4.5, V6.2 | Fully Implemented | `app/api/auth/google/callback/route.js`, `lib/oauth-security.js` |
| 6 | **Authorization (Roles)** | V8.1.1, V8.2.1, V8.3.1 | Fully Implemented | `lib/admin-auth.js`, `app/api/admin/*`, `docs/security/RBAC_SPEC.md` |
| 7 | **Access Control (IDOR / BOLA)** | V8.2.2 | Fully Implemented | `app/api/profile/route.js`, `lib/bid-prep/security.js` |
| 8 | **Input validation & SQL/NoSQL Injection** | V1.2.4, V2.1.1, V2.2.1, V2.2.2 | Fully Implemented | `models/Project.js`, `app/api/tors/route.js`, `lib/bid-prep/drafts.js`, `docs/API_VALIDATION.md` |
| 9 | **Environment variables & credentials** | V9.1.3, V13.4.1 | Fully Implemented | `lib/auth.js`, `.env*` in `.gitignore`, `.dockerignore` |
| 10 | **Proper CORS setup (No wildcard *)** | V3.4.2, V3.5.2 | Fully Implemented | `lib/security-policy.js`, `proxy.js` |
| 11 | **Error Handling** | V6.2, V14.2.1 | Fully Implemented | `lib/route-security.js`, `lib/password-auth.js` |
| 12 | **Logging (Auth & Error events)** | V14.2.1, STRIDE TH-4/TH-20 | Fully Implemented | `lib/auth-audit.js`, `models/PipelineTriggerAudit.js` |
| 13 | **HTTP Security Headers** | V3.2.1, V3.4.1 | Fully Implemented | `lib/security-policy.js`, `next.config.js` |
| 14 | **SAST Code Analysis (Semgrep)** | V15.2.1 | Automated in CI | `.github/workflows/semgrep.yml`, `docs/security/reports/sast-report.json` |
| 15 | **DAST Dynamic Analysis (OWASP ZAP)** | V15.2.1 | Automated in CI | `.github/workflows/zap-dast.yml`, `docs/security/reports/zap-dast-report.json` |
| 16 | **Threat Modeling & Mitigation Verification** | STRIDE TH-1 to TH-20 + TH-03 | Fully Implemented | `docs/security/THREAT_MODEL.md` |
| 17 | **OWASP ASVS & Top 10 Mapping** | Chapters 1 to 15 | Fully Implemented | `docs/security/ASVS_CHECKLIST.md`, `docs/security/README.md` |
| 18 | **4 Advanced Security Features** | V6.3.1, V7.2.1, V8.1.1, V9.2.1 | 4 Features Done | `lib/rate-limit.js`, `lib/request-authorization.js`, `lib/auth.js`, `lib/account-status.js` |

---

## 3. Deep-Dive Details: Items 4 through 17

### Item 4: Password Authentication (ASVS V6.2.1 - V6.2.8)
- **Location:** `lib/password-auth.js`, `app/api/auth/login/route.js`, `app/api/auth/register/route.js`
- **Technical Details:**
  - Dual login via email address or unique alphanumeric username.
  - Password length constraints: 15 to 128 characters.
  - Salted key derivation using Node.js `crypto.scrypt` (`N=131072`, `r=8`, `p=1`) with 16-byte random salt per user.
  - Constant-time verification using `crypto.timingSafeEqual` to prevent timing side channels.
  - Password hashes excluded from queries via Mongoose `select: false`.

### Item 5: Social SSO with OAuth / OpenID (ASVS V10.4.1 - V10.4.5, V6.2)
- **Location:** `lib/oauth-security.js`, `app/api/auth/google/callback/route.js`
- **Technical Details:**
  - Google OAuth 2.0 / OpenID Connect authorization code flow.
  - Cryptographically random 256-bit state parameter (`crypto.randomBytes(32)`) stored in HttpOnly cookie to block OAuth CSRF.
  - Authorization code exchanged server-side for user identity claims.

### Item 6: Authorization & Role-Based Access Control (ASVS V8.1.1, V8.2.1, V8.3.1)
- **Location:** `lib/admin-auth.js`, `app/api/admin/*`, `docs/security/RBAC_SPEC.md`
- **Technical Details:**
  - RBAC matrix separates `user` and `admin` roles.
  - Admin endpoints verify `session.role === 'admin'` before execution; unprivileged users receive HTTP 403.
  - No default admin accounts; privileges assigned dynamically via configured email allowlists.

### Item 7: Access Control & IDOR / BOLA Prevention (ASVS V8.2.2)
- **Location:** `app/api/profile/route.js`, `lib/bid-prep/security.js`, `docs/security/bid-prep-fr-4.7.md`
- **Technical Details:**
  - Profiles, BidPrep drafts, and checklist actions are scoped strictly to `session.sub`.
  - Client-supplied user IDs in queries or bodies are discarded.
  - Attempting to access another user's draft returns HTTP 404.

### Item 8: Input Validation & Injection Protection (ASVS V1.2.4, V2.1.1, V2.2.1, V2.2.2)
- **Location:** `models/`, `app/api/tors/route.js`, `lib/bid-prep/drafts.js`, `docs/API_VALIDATION.md`
- **Technical Details:**
  - Mongoose ODM parameterizes all database queries.
  - Search inputs in regular expressions are escaped with regex sanitizers to prevent ReDoS.
  - Route bodies validated against allowlists with a 128 KiB limit.
  - CLI background runners use `child_process.spawn()` with parameter arrays.

### Item 9: Environment Variables and Credentials (ASVS V9.1.3, V13.4.1)
- **Location:** `lib/auth.js`, `.gitignore`, `.dockerignore`
- **Technical Details:**
  - Secrets (`JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, `MONGODB_URI`) loaded exclusively from environment variables.
  - Local `.env*` files and `.git` metadata excluded from production builds and containers.

### Item 10: Proper CORS Configuration (ASVS V3.4.2, V3.5.2)
- **Location:** `lib/security-policy.js`, `proxy.js`
- **Technical Details:**
  - Wildcard `*` CORS is rejected. Origins checked against `APP_ORIGIN` and `CORS_ALLOWED_ORIGINS`.
  - Browser mutations require a valid Origin header and `Content-Type: application/json`.

### Item 11: Error Handling (ASVS V6.2, V14.2.1)
- **Location:** `lib/route-security.js`, `lib/password-auth.js`
- **Technical Details:**
  - Standardized error envelopes; OAuth failures omit `tokenData` and unexpected 500/503 catch blocks across `/api/*` routes return safe static messages without leaking stack traces.

### Item 12: Logging of Auth and Security Events (ASVS V14.2.1, STRIDE TH-4, TH-20)
- **Location:** `lib/auth-audit.js`, `models/PipelineTriggerAudit.js`
- **Technical Details:**
  - `logAuthAudit()` logs allowlisted authentication events (register, login, rate-limits, OAuth callbacks/denials, logout) with timestamp, path, client IP, and non-secret metadata under a 90-day retention policy.
  - Passwords, OAuth tokens, and document draft content are stripped from logs.

### Item 13: HTTP Security Headers (ASVS V3.2.1, V3.4.1)
- **Location:** `lib/security-policy.js`, `next.config.js`
- **Technical Details:**
  - `Content-Security-Policy: default-src 'self' ... base-uri 'none'; frame-ancestors 'none'`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `X-Powered-By` header disabled.

### Item 14: SAST Security Code Analysis (ASVS V15.2.1)
- **Location:** `.github/workflows/semgrep.yml`, `docs/security/reports/sast-report.json`
- **Technical Details:**
  - Semgrep runs in CI with ruleset `p/owasp-top-ten`.
  - Blocks builds on High/Error findings; current baseline shows 0 findings in application code.

### Item 15: DAST Dynamic Security Analysis (ASVS V15.2.1)
- **Location:** `.github/workflows/zap-dast.yml`, `docs/security/reports/zap-dast-report.json`
- **Technical Details:**
  - OWASP ZAP baseline container scans the production Docker build.
  - Verified 0 High/Critical alerts in committed reports.

### Item 16: Threat Modeling & Verification (STRIDE Matrix)
- **Location:** `docs/security/THREAT_MODEL.md`
- **Technical Details:**
  - STRIDE threat model covering 20 application threats (TH-1 to TH-20) plus Zip Slip (TH-03).
  - Explicit mitigations, test paths, and status tracking.

### Item 17: OWASP ASVS & OWASP Top 10 Mapping
- **Location:** `docs/security/ASVS_CHECKLIST.md`, `docs/security/README.md`
- **Technical Details:**
  - Full traceability across ASVS Chapters 1 through 15 and Semgrep OWASP Top 10 rules.

---

## 4. Item 18: The 4 Selected Advanced Security Features

### Feature 1: Authorization Process with Scope
- **Implementation File:** `lib/request-authorization.js`, `lib/auth.js`
- **Evidence Test:** `tests/security/scopes-cors-headers.test.js`
- **Description:** Fine-grained capability scopes are embedded within tokens (`profile:read`, `profile:write`, pipeline scopes). Tokens with read-only scope cannot perform mutations, and internal pipeline service tokens are restricted from user profiles or admin routes.

### Feature 2: Rate Limit for Login Attempts
- **Implementation File:** `lib/oauth-security.js`, `lib/password-auth.js`, `lib/rate-limit.js`
- **Description:** Sliding-window in-memory rate limiter tracking failed login attempts per client IP and targeted account identifier. Returns HTTP 429 Too Many Requests with `Retry-After` header when thresholds are exceeded.

### Feature 3: Rate Limit for Backend APIs
- **Implementation File:** `lib/rate-limit.js`, `lib/bid-prep/security.js`, `proxy.js`
- **Description:** Protects backend APIs from flooding and resource exhaustion. Rate limiters govern search operations, document acquisition, and Vertex BidPrep operations (capping draft creation at 5/hour, hourly export caps, and 128 KiB body restrictions).

### Feature 4: JWT Expiration Checking and Management
- **Implementation File:** `lib/auth.js`, `lib/account-status.js`, `app/api/auth/logout/route.js`
- **Evidence Test:** `tests/security/session-disabled.test.js`
- **Description:** Stateless JWT session management with 24-hour expiration (`exp`) signed with HS256. Includes real-time database account status checks (ASVS V7.4.2) and immediate logout JWT/JTI and `User.session_version` revocation (ASVS V7.4.1).

---

## 5. File Handling & Additional ASVS V5 Safeguards
- **Zip Slip Path Traversal Defense (ASVS V5.3.2 / STRIDE TH-03):**
  In `lib/archive-extractor.js`, all ZIP archive members are resolved and validated to remain strictly within the scoped target extraction directory. Path escaping entries (`../`, absolute paths, drive letters) and symlinks are rejected and logged.
- **Magic-Byte Validation (ASVS V5.2.2):**
  In `lib/scraper.js` and `lib/archive-extractor.js`, downloaded files are verified by inspecting initial magic bytes before passing them to parsers (%PDF- for PDFs and PK headers for ZIPs). Empty files and spoofed HTML are rejected immediately.
