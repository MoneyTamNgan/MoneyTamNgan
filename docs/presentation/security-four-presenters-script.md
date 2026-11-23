# MoneyTamNgan security presentation — four-person script

Language: English. Target: approximately 10 minutes of speaking. Evidence baseline: 19 November 2026. This script follows the 19-slide Google Slides template and its audit-based revision. The optional application demo is separate; shorten narration if the instructor includes the demo in the same time limit.

Working copy: https://docs.google.com/presentation/d/1mTG31WwqlRZB40gAs-CpSM5dxHJvmu2soBhiTcJvZ8Y/edit

Original template: https://docs.google.com/presentation/d/1T1ozUpT7HXvsqIm-a6VkMrSkguil7gcni3pwOoQiwJ8/edit

**Deck status:** The native Google Slides working copy contains 19 revised slides, saved to Drive and visually checked from its PDF export. The original template is preserved. Script headings below follow the final slide order; rehearse to confirm the 10-minute timing.

## Speaker allocation

| Presenter | Slides | Target time | Main topics |
| --- | --- | --- | --- |
| Phruek Chantarasittiphon | 1–5 | 0:00–2:30 | Introduction, application/team, password, OAuth, roles and principles |
| Napat Sirichan | 6–10 | 2:30–5:00 | Ownership, validation, credentials, CORS, errors |
| Peerawat Theerasakul | 11–15 | 5:00–7:30 | Logging, headers, testing, scanners, STRIDE priorities |
| Watcharapat Pathanutpong | 16–19 | 7:30–10:00 | ASVS/Top 10, four advanced controls, archive security and conclusion |

The names and allocation above describe presenters, not exclusive ownership of implementation work. Keep the slide wording brief; the paragraphs below are spoken narration.

## Phruek Chantarasittiphon — slides 1–5

### Slide 1 — MoneyTamNgan Security

Good afternoon. We are presenting the security work on MoneyTamNgan for Software Development Security. Our evidence comes from the code and audit reviewed on 19 November. We will explain the implemented controls, how we tested them, and the weaknesses that remain. Our assessment covers selected ASVS requirements; we do not claim full Level 2 compliance.

### Slide 2 — Application, features and team

Our team members are listed here. MoneyTamNgan helps software contractors discover Thai procurement projects, read Thai TOR documents, compare requirements with their skills, and prepare bid drafts. The system also provides notifications and admin review tools. It uses Next.js, React and MongoDB. External website availability, OCR errors and AI accuracy still affect the functional pipeline.

### Slide 3 — Password authentication

Users can register and sign in with an email address or username. Passwords must contain 15 to 128 characters. We store a salted scrypt hash rather than the password, compare derived values in constant time, and hide hashes from public responses. Rate limits and a concurrency cap reduce hashing abuse. Password recovery and breached-password screening remain future work.

### Slide 4 — Google OAuth sign-in

Google is our alternative sign-in method. The server verifies a random state value, exchanges the authorization code, and requires a verified Google email. It then issues the same scoped application session as password login. Existing password accounts are not automatically linked. We tested the flow with mocks; a live provider login should also be demonstrated on the presentation machine.

### Slide 5 — Roles, scopes and security principles

We follow least privilege and complete mediation. Users, administrators and machine credentials have different permissions. Registration cannot grant an admin role. Both the Proxy and route handlers enforce permissions, and private-resource queries check the owner. This provides independent checks instead of relying on hidden buttons in the frontend.

**Handoff:** Napat will now explain how these controls protect private data and incoming requests.

## Napat Sirichan — slides 6–10

### Slide 6 — Protecting each user’s data

Profiles, drafts and checklists use the authenticated session identity. Supplying another user’s ID does not grant access. A request for somebody else’s draft returns 404, and our tests cover reads, editing and export. We distinguish missing authentication with 401 from insufficient permissions with 403. These checks apply on the server.

### Slide 7 — Input validation and injection defenses

We validate types and allowed fields, bound sensitive request bodies, and construct MongoDB queries from controlled values. Output escaping and archive checks add protection. However, the audit found legacy raw search regex, a category allowlist issue, notification input gaps and incomplete private-host URL checks. Mongoose alone does not prove that every query is safe. These remain explicit follow-ups.

### Slide 8 — Environment variables and credentials

Secrets belong in private environment configuration, not Git or client code. The example file contains placeholders. Our bounded history scan checked 1,532 text blobs and found no matching secret patterns, but this is not a complete guarantee. The owner still needs to confirm revocation of the previously exposed key. Ignoring a file does not revoke an old credential.

### Slide 9 — CORS and browser mutations

The app accepts exact configured origins and rejects wildcard, null and foreign origins. Browser mutations require an allowed Origin. We tested accepted and rejected preflight requests on an isolated local server. Authentication remains necessary because CORS only constrains browsers; it does not replace authorization for scripts or other clients.

### Slide 10 — Error handling

Password and BidPrep services return generic errors in sensitive cases. Wrong-password responses do not distinguish unknown accounts from Google-only accounts. Coverage is still partial: some legacy handlers expose exception messages or provider details. Our next step is consistent generic responses with sanitized server-side events, while preserving useful validation errors.

**Handoff:** Peerawat will explain the security evidence and the gaps in our event trail.

## Peerawat Theerasakul — slides 11–15

### Slide 11 — Security logging

We have allowlisted logging helpers for OAuth rejections, pipeline triggers and BidPrep operations. They capture useful metadata without intentionally logging passwords or draft contents. But registration, successful and failed password login, and logout do not all produce a consistent audit trail. Central retention and alerting also need definition. We therefore mark logging as partially complete.

### Slide 12 — HTTP security headers

The application sends CSP, HSTS, anti-framing, nosniff and referrer-policy headers. Live checks confirmed that script nonces change and match the HTML. The team can show the custom configuration and DevTools response headers during the demo. We still permit inline styles in existing components, and localhost HTTP does not demonstrate production TLS or HSTS enforcement.

### Slide 13 — Security testing and SAST

We pinned the code version, installed its lockfile, reviewed documents against source, and ran the tests and production build. All 340 Node tests and 460 Vitest tests passed. Separate local checks exercised headers, origins and denied access. The documentation audit still failed, including missing endpoint documentation. Passing tests does not mean every security requirement is complete.

### Slide 14 — Dynamic security scan

We use Semgrep for SAST and OWASP ZAP for a passive baseline. The latest same-code artifacts report zero High SAST findings with 50 warnings, and zero High DAST alerts with one Medium alert. The raw dependency audit reports zero findings on our audit date. ZAP is unauthenticated, so separate ownership and scope tests provide the authenticated-access evidence.

### Slide 15 — STRIDE threats and priorities

Our STRIDE model considers spoofing, tampering, repudiation, information disclosure, denial of service and privilege escalation. We map threats to controls and tests. The audit proposes credential revocation as P0, and session reuse, URL checks, errors and logs as P1 work before public deployment. The team still needs to adopt these priorities and synchronize the shared checklist.

**Handoff:** Watcharapat will connect the controls to ASVS and summarize the four advanced features.

## Watcharapat Pathanutpong — slides 16–19

### Slide 16 — ASVS 5.0.0 and Top 10:2025 mapping

We use versioned ASVS 5.0.0 references and the current Top 10:2025 categories. For example, owner-bound authorization addresses broken access control, scrypt supports password storage, and validation addresses injection. The report also maps partial logging and error handling. This is selected coverage with documented gaps, rather than a claim that all Level 1 or Level 2 requirements pass.

### Slide 17 — Advanced features one and two

Our first advanced feature is scoped authorization: a token with read-only permission cannot perform a write, and machine credentials cannot become general administrators. The second is login-attempt limiting by IP, identifier and account. The limiter uses fixed windows and returns 429 with Retry-After. The counters are process-local, so multiple replicas need a shared store.

### Slide 18 — Advanced features three and four

The third feature is backend API rate limiting, including public-read budgets and BidPrep quotas. The fourth is JWT expiration checking. Tokens expire after 24 hours, and real account checks reject disabled accounts. A copied token still verifies after logout, so backend revocation remains a gap. We do not count absolute expiry again as an inactivity timeout, and we do not claim application MFA.

### Slide 19 — File handling and archive security

Downloaded files undergo signature checks before parsing. ZIP extraction rejects traversal paths and symlink entries while allowing valid members to continue. These controls have dedicated tests. Overall, the audit rates 13 rubric criteria covered and five partial. Our priority is to close the documented gaps, preserve the evidence, and demonstrate the implemented controls honestly. Thank you. We are ready for the application demo and questions.

## Optional application demo — actions, not spoken script

Use disposable accounts and a prepared TOR so government availability does not determine whether the security demo succeeds.

1. Demonstrate password login and Google login. Hide credentials, tokens and personal inboxes.
2. Show a protected admin action denied to a normal user.
3. Use two disposable users to demonstrate a foreign draft read or export returning 404.
4. Show an exact-origin success and a rejected foreign-origin request.
5. Open DevTools Network and show the five required response headers and fresh CSP nonce.
6. Show a controlled 429 response without flooding a real service.
7. Show the latest SAST/DAST reports and distinguish zero High findings from zero total findings.
8. Mention the logout replay limitation if asked. Do not present cookie deletion as server-side token revocation.

## Rehearsal notes

- Keep each presenter near two and a half minutes, including the handoff.
- Use the short slide points as prompts. Do not read file paths and ASVS numbers aloud unless explaining a specific requirement.
- Keep the audit baseline visible. Recheck numbers before the presentation if code or scanner results change.
- Do not claim all 18 criteria, full ASVS Level 1/2 compliance, universal generic errors, zero total scanner warnings, distributed rate limits, or a completed live Google demo without supporting evidence.
- The script is a speaking aid. The course report retains detailed evidence and residual risks.

## Sources

- [Detailed security audit](../security-assignment-audit-2026-11-19.md)
- [Coursework README](../../README.md)
- [STRIDE model](../security/THREAT_MODEL.md)
- [Authentication design](../security/AUTHENTICATION.md)
- [Fresh verification summary](../evidence/security-assignment-2026-11-19/verification-summary.json)
