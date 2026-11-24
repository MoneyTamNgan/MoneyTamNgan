# Handover (#132)

Requirement links: [traceability.md](traceability.md). SRS and design index: [README.md](../README.md#documentation).

No secret value appears in this file. Real values live only in an uncommitted `.env` on each machine.

## Owner
System owner: **to be named by the team at delivery** (fill in name and contact). Admin rights currently sit on the former PM's account and must be moved (see "After delivery").

## External services
| Service | Used for | Config (env var) |
|---|---|---|
| MongoDB Atlas | main database | `MONGODB_URI`, `MONGODB_DB_NAME`; Atlas API keys only for `atlas-allowlist` |
| Google Cloud / Vertex AI | TOR extraction, drafts, embeddings (off by default) | `VERTEX_AI_ENABLED`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` |
| Gemini through the `agy` CLI (agy bridge) | **Fallback AI provider, and the demo AI since 22 Nov 2026** (automatic after Vertex refuses when `AI_FALLBACK_PROVIDER=ollama`, PR #249; otherwise chosen by configuration). Replaces the local model `qwen2.5:3b` (too slow: AI drafts timed out). Same Ollama-protocol setting, pointed at the bridge; no app change. Demo only: no authentication, data goes to Gemini. See [agy-bridge.md](agy-bridge.md) | `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://host.docker.internal:11500`, `PROPOSAL_DRAFT_TIMEOUT_MS=0` |
| Ollama (local model) | previous demo AI; still supported when no bridge is available | `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL` |
| Google OAuth | Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_REDIRECT_URI` |
| Resend / SMTP | notification email | `RESEND_API_KEY`, `MAIL_*`, `EMAIL_TRANSPORT` |
| e-GP API | project discovery | `EGP_API_KEY` |

## Rotating secrets
Rotate each, update the `.env`, then `docker compose up -d --force-recreate app worker`.
1. MongoDB user password (Atlas, Database Access), then `MONGODB_URI`.
2. `JWT_SECRET`: generate a new random value. All sessions end; users log in again.
3. Google OAuth client secret (Cloud Console), `PIPELINE_ADMIN_TOKEN`, `EGP_API_KEY`, `RESEND_API_KEY` / `MAIL_PASSWORD`.
4. Service account key for Vertex: create a new key, switch, delete the old one.
Do this for every value that appeared in chat or on a test machine. Move admin rights (`ADMIN_EMAILS`) to the new owner.

## Running
Start, stop, rollback and recorded restart time: [local-deployment.md](local-deployment.md). Local DB vs Atlas: the base compose file uses the bundled `mongo`; add `-f docker-compose.atlas.yml` to use Atlas.

## Known limitations
- Vertex billing is unavailable, so the demo machine uses a small local model. A BidPrep AI draft takes 76 to 92 s and 2 of 3 real TORs hit the 90 s cap ([report](connectivity-test-2026-11-19.md)). The checklist and DOCX export do not depend on it.
- The session cookie is `Secure` in production: log in from `http://localhost` or serve over https.
- `/api/tors` returns 500 (not 503) while the database is down.
- Not tested on the demo machine: Google sign-in, match-score email, admin pipeline run, screenshots at 360/768/1280 px ([E2E report](e2e-test-2026-11-19.md)).
- Security gaps listed in the [audit](security-assignment-audit-2026-11-19.md) (copied JWT reuse after logout, raw error exposure, password change, etc.).
- Not in this release (#145): document pack, deadline reminders, PDF export.
- Nothing submits a bid to e-GP; the seller submits with their own digital signature.
