# Audit pack

Everything an auditor usually asks for, in one place. Written 22 Nov 2026 for `v1.0.0`. It describes what exists; weaknesses are listed, not hidden.

| # | Document | Answers |
|---|---|---|
| 1 | [01-architecture.md](01-architecture.md) | What are the components, how does data flow, where are the trust boundaries? |
| 2 | [02-data-model-er.md](02-data-model-er.md) | ER diagram, what personal data is stored, which integrity rules the database enforces |
| 3 | [03-design-patterns.md](03-design-patterns.md) | Which design patterns are used, where, why, how to verify; trade-offs |
| 4 | [04-controls-and-evidence.md](04-controls-and-evidence.md) | Control by control: what we do, proof, status, open gaps |

Existing evidence these point to: [security audit](../security-assignment-audit-2026-11-19.md), [threat model](../security/THREAT_MODEL.md), [RBAC matrix](../security/RBAC_SPEC.md), [ASVS notes](../security/ASVS_CHECKLIST.md), [vulnerability policy](../security/VULNERABILITY_MGMT.md), [E2E 22 Nov](../e2e-test-2026-11-22.md), [acceptance table](../acceptance-bidprep-2026-11.md), [handover](../handover.md).

## Likely questions and where the answer is
| Question | Short answer | Detail |
|---|---|---|
| Who can see a user's company data and drafts? | Only that user. Another user gets 404; admins have no draft route | 04 section A; E2E isolation steps |
| What personal data do you hold and for how long? | Account and company profile fields; until the user deletes; no automatic expiry | 02 data classification; 04 section B |
| How are passwords stored? | scrypt with per-password salt; hash never returned | AUTHENTICATION.md |
| What happens if the AI is wrong? | It only drafts; labelled, sourced, user must review; export gated by a confirmed checklist; nothing is submitted to e-GP | 04 section E |
| Can a user trigger the pipeline or see admin pages? | No: 401 for guests, 403 for users, tested on every route | RBAC_SPEC.md |
| How do you prevent duplicate processing or emails? | Unique and partial-unique indexes, job leases, idempotency keys | 03 patterns 5 to 7 |
| What if the database or AI is down? | `/api/health` 503 within 3 s, clear AI error in 20 ms, no hangs; fallback to local mongo | E2E 19 Nov |
| How is the code reviewed and tested? | PR into `develop`, CI (build, tests, contract, Semgrep, ZAP); 353 + 472 tests | 04 section C |
| How are dependencies and secrets managed? | npm audit gate with expiring exceptions; secrets only in `.env`; rotation procedure written | VULNERABILITY_MGMT.md; handover.md |
| How would you recover from a breach or data loss? | Rotation and revocation steps exist; **incident runbook and restore drill are not written yet** | 04 section D, open items |
| Is it compliant with ASVS / PDPA? | 13 of 18 selected ASVS criteria covered, 5 partial; **no claim of full compliance; no PDPA notice yet** | security audit |

## How to reproduce the checks
```bash
npm ci && npm run build && npm run test:vitest && npm test   # clean-clone checks
python3 tests/e2e/smoke-api.py                               # 34 steps on a running stack
python3 tests/e2e/checklist-variants.py 25                   # checklist across 25 TORs
npm run audit:dependencies                                   # dependency gate
```
