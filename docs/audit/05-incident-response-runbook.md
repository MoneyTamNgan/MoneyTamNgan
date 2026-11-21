# Incident response runbook

Short, usable under pressure. Commands run on the host that runs Docker Compose, from the repository folder. Where a name, contact or decision is needed it is shown as **[fill in]**: complete those once, before an audit.

## 1. Roles
| Role | Who | Does |
|---|---|---|
| Incident lead | **[fill in: system owner]** | Decides severity, contains, keeps the timeline, decides on notification |
| Technical responder | **[fill in]** | Runs the containment and recovery steps below |
| Communications | **[fill in]** | Informs users, the customer and (if needed) the regulator after the lead agrees |
| Escalation contact | **[fill in: advisor / customer contact]** | Informed for High and Critical |

Keep these names and phone numbers somewhere that does not depend on the affected system.

## 2. Severity
| Level | Meaning | Examples | Start working within |
|---|---|---|---|
| Critical | Confirmed exposure of personal data or credentials, or an attacker has access | Leaked `.env`, database dump exposed, admin account taken over | immediately |
| High | Likely exposure or loss of integrity, or the service is down | Another user's draft readable, runaway job writing bad data, Atlas unreachable during a demo | 1 hour |
| Medium | Limited impact, contained | Rate-limit abuse, one disabled account, failed ingestion | same day |
| Low | No user impact | Single failed job, dependency advisory without reachability | next working day |

## 3. Detect: where to look
| Signal | Where |
|---|---|
| Service health | `curl http://localhost:3000/api/health` (200 healthy, 503 database down) |
| Container state | `docker compose ps` |
| Application and auth events | `docker compose logs --tail=200 app` (auth failures are structured JSON warnings from `lib/auth-audit.js`) |
| Worker and job problems | `docker compose logs --tail=200 worker`; `ProcessingJob` records with `status: failed` |
| Admin pipeline actions | collection `pipelinetriggeraudits` (actor, role, IP, outcome, HTTP status) |
| Classification changes | collection `classificationoverrides` (before and after) |
| Abuse or spikes | `429 RATE_LIMITED` responses in the app log |
| Dependency findings | CI `npm audit` gate; [VULNERABILITY_MGMT.md](../security/VULNERABILITY_MGMT.md) |
| User report | whoever receives it opens a record in section 9 |

## 4. First 15 minutes (any incident)
1. Write down the time you learned of it and who reported it (section 9 timeline).
2. Decide the severity (section 2). If unsure, take the higher one.
3. **Preserve evidence before changing anything:**
   ```bash
   mkdir -p ~/incident-$(date +%Y%m%d-%H%M) && cd ~/incident-*
   docker compose ps > ps.txt
   docker compose logs --no-color --tail=5000 app worker scheduler scraper > logs.txt
   ```
   Do not delete containers or volumes (`down -v`) until evidence is saved.
4. Contain (section 5). Containment first, investigation second.
5. Tell the incident lead and, for High and Critical, the escalation contact.

## 5. Containment playbooks

### 5.1 Credential or secret exposed (`.env`, token, database password, API key)
1. Treat it as compromised even if you are not sure it was used.
2. Rotate, in this order, following [handover.md](../handover.md): MongoDB user password (Atlas, Database Access), `JWT_SECRET`, `PIPELINE_ADMIN_TOKEN`, Google OAuth client secret, `EGP_API_KEY`, `RESEND_API_KEY` / `MAIL_PASSWORD`, GitHub tokens, the Vertex service-account key.
3. Update `.env` on the host, then `docker compose up -d --force-recreate app worker`.
4. Changing `JWT_SECRET` ends every session; users must sign in again. That is the intended effect.
5. In Atlas, review the access list and remove any address you do not recognise; check the database access log for the exposure window.
6. If the secret was committed, rotating is mandatory even after the commit is removed from history.

### 5.2 One account taken over or abused
```bash
npm run user:disable -- --email=person@example.com            # preview
npm run user:disable -- --email=person@example.com --apply    # disable
```
A disabled account cannot sign in and its live sessions stop working on the next request. Re-enable with `--enable --apply` after the owner has changed their password and you are satisfied. For an admin account, also review `pipelinetriggeraudits` for what it did.

### 5.3 Users' data may be exposed or another user's data was visible
1. Reproduce with two test accounts (`python3 tests/e2e/smoke-api.py` includes the isolation checks) to confirm or rule out.
2. If confirmed: stop the exposure first. Block the route in the proxy or stop the `app` container (`docker compose stop app`); accept downtime over continued exposure.
3. Find affected users from the access logs and the records involved (drafts are keyed by `userId`).
4. Fix, add a regression test, redeploy, then go to section 6 (notification) with the lead.

### 5.4 Runaway ingestion, bad data or unwanted processing
```bash
docker compose stop scheduler scraper      # stop new work
docker compose stop worker                 # stop processing queued jobs
```
Check `ingestionruns`, `processingjobs` and `GET /api/admin/pipeline/status`. A stuck admin run recovers by itself 90 seconds after its lease stops renewing (`PIPELINE_INTERRUPTED`). Remove or fix the bad records, then restart `worker`. The `scheduler` stays off on a demo machine unless wanted.

### 5.5 AI misbehaviour (prompt injection, wrong or harmful draft, data leaving the machine)
1. Switch to the local model or turn the AI off: set `AI_PROVIDER=ollama` or `VERTEX_AI_ENABLED=false`, recreate `worker`. Drafts and checklists still work without Vertex.
2. Keep the offending TOR id and the `DocumentSummary` / job record (it stores model, prompt version, usage).
3. Remind users that every draft must be reviewed; nothing is submitted automatically.

### 5.6 Database or network outage
1. `/api/health` returns 503 and the app does not hang; the worker retries by itself.
2. Check the Atlas status page and the machine's public IP against the Atlas **Network Access** list (an IP change gives `SSL alert 80` and a 503).
3. Fallback: start the bundled MongoDB with pre-processed data (`docker compose up -d` without the Atlas override), see [local-deployment.md](../local-deployment.md).

### 5.7 Vulnerable dependency
Follow [VULNERABILITY_MGMT.md](../security/VULNERABILITY_MGMT.md): fix within 7 days (Critical), 14 (High), 30 (Medium); an exception needs reasoning, a compensating control and an expiry of at most 30 days.

## 6. Notification
Decide with the incident lead. Record who decided, when and why.

| Who | When |
|---|---|
| Affected users | Personal data of theirs was exposed or lost, or their account was misused. Say what happened, what data, what they should do (change password, watch for phishing), and who to contact |
| Customer | Any High or Critical incident, and any exposure of data in the system they own |
| Regulator (PDPC, Thailand) | A personal-data breach that is likely to put people's rights and freedoms at risk must normally be reported without delay and within **72 hours** of becoming aware, unless it is unlikely to cause risk (Personal Data Protection Act B.E. 2562, section 37(4)). **Confirm the current rule and the form with legal advice before relying on this line** |
| Service providers | Atlas, Google Cloud, Resend: if their credentials or accounts were involved |

## 7. Recovery
1. Remove the cause (fix, rotate, patch) and verify with the tests that failed or with a new regression test.
2. Restore service in this order: database reachable, `app`, `worker`, then `scheduler`.
3. Check `docker compose ps`, `/api/health`, run `python3 tests/e2e/smoke-api.py`.
4. Watch the logs for a day for repeat activity.
5. Data restore from backup: **[fill in once the Atlas backup policy is confirmed]**. Until then the only recovery path for lost user data is re-entry by users and re-ingestion of public TOR data.

## 8. After the incident (within 5 working days)
Write a short review: timeline, root cause, what worked, what did not, actions with owner and date. Add the lesson to [04-controls-and-evidence.md](04-controls-and-evidence.md) if a control was missing. No blame; the goal is fewer repeats.

## 9. Incident record (copy per incident)
```
ID:               INC-YYYYMMDD-n
Reported by / at:
Detected by:
Severity (initial / final):
Systems and data involved:
Personal data involved?  yes / no / unknown
Timeline (UTC+7):         time - event - who
Containment actions:
Notification decisions:   who / when / why
Root cause:
Recovery:
Follow-up actions:        action - owner - due
Closed by / at:
```

## 10. Exercise
Run a tabletop once before the audit: pick 5.1 (leaked secret) and 5.3 (cross-user exposure), walk through the steps with the real commands on a test stack, and record the date and gaps found here: **[fill in]**.
