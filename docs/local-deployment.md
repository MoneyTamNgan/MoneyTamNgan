# Local deployment: start, stop, rollback (#128)

One page for a teammate who has not done this before. It was tested on a **development machine** on 15 November 2026. It has **not** been run on the competition machine yet; repeat the checks in [Checklist for the competition machine](#checklist-for-the-competition-machine) there.

## Start

```bash
git clone https://github.com/MoneyTamNgan/MoneyTamNgan.git && cd MoneyTamNgan
git checkout main            # or the tag you were told to deploy
cp .env.example .env         # then edit .env, never commit it
docker compose up --build -d mongo app worker
```

Set at least these in `.env`:

| Variable | Value |
|---|---|
| `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
| `APP_ORIGIN` | the real URL, for example `http://localhost:3000` |
| `NEXT_PUBLIC_REDIRECT_URI` | `<APP_ORIGIN>/api/auth/google/callback`, and the same URI added in the Google Cloud Console |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from the Google Cloud Console (needed to log in with Google) |
| `EGP_API_KEY` | needed only to scrape |

`docker compose` points `app` and `worker` at the bundled `mongo` service, so the stack runs without Atlas. To use Atlas instead, set `MONGODB_URI` and start with `docker compose -f docker-compose.yml -f docker-compose.atlas.yml up --build`. The `atlas-allowlist` service then adds the machine's IP and logs `Atlas access list updated` (needs `ATLAS_PUBLIC_KEY`, `ATLAS_PRIVATE_KEY` and `ATLAS_PROJECT_ID`; see the README).

## Check

```bash
docker compose ps                      # app, mongo (healthy), worker are Up
curl -s http://localhost:3000/api/health   # {"status":"ok","database":"connected",...}
docker compose logs --tail=20 worker       # "Worker started (watch mode)"
```

## Stop

```bash
docker compose down        # keeps the data volumes
docker compose down -v     # also deletes the database and stored PDFs (a fresh start)
```

## Rollback

1. `docker compose down`
2. `git checkout <previous working tag or commit>` (write it down before each deploy)
3. `docker compose up --build -d mongo app worker` and run the **Check** steps again

Data in the `mongo-data` volume is kept unless you used `down -v`. If a change added fields or indexes (for example the username migration), see its rollback steps in [email-password-auth.md](email-password-auth.md).

## Results of the trial on the development machine (15 Nov 2026)

| Item | Result |
|---|---|
| Install from a clean checkout with `.env.example` copied and edited | worked; first build about 9 minutes 20 seconds, later builds use the cache |
| `docker compose ps` | `app` Up, `mongo` Up (healthy), `worker` Up |
| `GET /api/health` | HTTP 200, `{"status":"ok","database":"connected"}` |
| Worker | `Worker started (watch mode)`, recovery sweep ran with 0 errors |
| Time to healthy after `docker compose restart app mongo worker` | 11 seconds |
| Machine | Linux 6.8 (Ubuntu), 6 CPUs, 15 GiB RAM, Docker 29.7.2, Node 22 in the image |
| Ports | 3000 (app), 27017 (mongo) |

Not covered here: a logged-in page (no Google OAuth credentials were used), Vertex AI, and the `scraper` and `scheduler` services.

## Trial on the competition machine (19 Nov 2026)

| Item | Result |
|---|---|
| Machine | Ubuntu 22.04 (kernel 6.8.0-138), 12 logical CPUs, 7.6 GiB RAM, NVIDIA GTX 1050 Ti 4 GB, Docker 29.9.2, Compose v5.6.1; Node is not installed on the host (Docker only) |
| Install | clone of `main` at `b053761`, `.env` created on the machine only (mode 600), `docker compose up --build -d` |
| `GET /api/health` | HTTP 200, `{"status":"ok","database":"connected"}` |
| Time to healthy after `docker compose restart app worker` | 12 seconds |
| Real database | `docker-compose.real-db.yml` (kept on the machine, not committed) points `app` and `worker` at the Atlas `MONGODB_URI`; `/api/tors` returned 838 TORs |
| Local AI | Ollama on the same machine, see [connectivity-test-2026-11-19.md](connectivity-test-2026-11-19.md) |

The `scheduler` service is stopped on the demo machine on purpose: it would ingest new projects at 06:00, 12:00 and 18:00 and process them with the small local model into the real database. Start it with `docker compose up -d scheduler` when that is wanted.

Not yet done on this machine: a screenshot of a logged-in page, the Google OAuth redirect URI for the machine's URL, and a run from a clean clone that follows only this page.

## Checklist for the competition machine

- [ ] Install from a clean clone using only this page and the README
- [ ] `docker compose ps` output, `/api/health` result and a screenshot of a logged-in page attached to #128
- [ ] The machine's IP is allowed in Atlas (if Atlas is used) and the OAuth redirect URI is in the Google Cloud Console
- [ ] Restart time recorded, specs and versions copied into the delivery docs (#132)
- [ ] The previous working version is written down for rollback

## Admin access

Granting and revoking the admin role, the audit trail and the review routine are in [docs/security/ADMIN_ACCESS.md](security/ADMIN_ACCESS.md). On this machine, run `promote-admin.js` inside the app container.
