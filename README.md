# MoneyTamNgan

Tracks software-related TOR (procurement) projects from Thailand's e-GP portal: it ingests project metadata, downloads and reads the TOR documents (text and Thai OCR), summarises them with Vertex AI, and shows them in a Next.js dashboard with search, matching and analytics. A Bid Preparation Assistant helps sellers prepare bid documents; it never submits a bid.

Stack: Next.js (App Router), Node.js workers, MongoDB Atlas, Vertex AI, Docker.

## Project documents

- [MoneyTamNgan_SRS](https://docs.google.com/document/d/1_o6RmB_G54MWgXHGiePvBzy-vLkhECAzDnhtU15rz0A/edit?usp=sharing): official SRS and use case diagram (TOR aggregation, matching, analytics).
- [SRS adhoc requirement](https://docs.google.com/document/d/1u8PlICl8XWIjGJUca1KImYh5keUNDkgUoAU73ERks8A/edit?usp=sharing): short SRS for the Bid Preparation Assistant (epic #135), waiting for customer confirmation (#143).
- [MoneyTamNgan Testcase doc](https://docs.google.com/spreadsheets/d/1R6gXlBh75GxtKXlraxE6N0eJU5URTa0pgbbUvg4j3GE/edit?usp=sharing): automated tests mapped to modules and source files.
- [Sprint api planing](https://docs.google.com/spreadsheets/d/1aXUlWRg__PmH6LtbzPxBnOCS7z7v9pk-xxEpwySVCU0/edit?usp=sharing): sprint API plan (ticket, endpoint, expected response, status).
- [MoneyTamNgan Secure Test](https://docs.google.com/spreadsheets/d/1zl9NWZmycvNj0Brg7PMB2kdizVcQq-ihKPNbVODycvY/edit?usp=sharing): STRIDE and ASVS security catalog with project status.
- [TOR Discovery, Extraction, and Display](docs/diagrams/tor-discovery-extraction-display.png): sequence diagram of the pipeline.

![MoneyTamNgan TOR Discovery, Extraction, and Display](docs/diagrams/tor-discovery-extraction-display.png)

## Quick start

Requires Node.js 22 and a MongoDB (Atlas or local).

```bash
cp .env.example .env     # set MONGODB_URI, JWT_SECRET and EGP_API_KEY at minimum
npm install
npm run dev              # http://localhost:3000
```

Vertex AI is off by default, so ingestion and PDF downloads work without Google Cloud credentials. To enable it, set `VERTEX_AI_ENABLED=true`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_APPLICATION_CREDENTIALS` (see [Vertex AI](docs/reference.md#vertex-ai)).

## Run with Docker

```bash
cp .env.example .env
docker compose up --build            # app on :3000, local mongo, worker
curl http://localhost:3000/api/health
```

Against Atlas, with the machine's IP allowed automatically (needs `ATLAS_PUBLIC_KEY`, `ATLAS_PRIVATE_KEY`, `ATLAS_PROJECT_ID` in `.env`):

```bash
docker compose -f docker-compose.yml -f docker-compose.atlas.yml up --build
```

Start, stop and rollback on a demo machine: [docs/local-deployment.md](docs/local-deployment.md).

## Common commands

| Command | What it does |
|---|---|
| `npm test` and `npm run test:vitest` | unit, integration and security tests (no network needed) |
| `npm run build` | production build |
| `npm run db:ensure-indexes` | create or update MongoDB and Atlas Vector Search indexes |
| `npm run db:migrate-users` | backfill usernames (dry run; add `-- --apply` to write) |
| `npm run worker` | process queued TOR jobs |
| `npm run scrape` | download TOR PDFs (`--limit`, `--delay`, `--project-id`) |
| `npm run embed -- --limit=50` | create embeddings for semantic search (needs Vertex) |
| `docker compose run --rm scraper` | one scrape run in Docker |

## Documentation

- [docs/reference.md](docs/reference.md): the full guide (pipeline, ingestion schedule, document storage, Vertex, Thai OCR, scraper commands, CI/CD)
- [docs/api/openapi.yaml](docs/api/openapi.yaml): API contract
- [docs/security/](docs/security/README.md): SAST/DAST, threat model, ASVS checklist, BidPrep security
- [docs/email-password-auth.md](docs/email-password-auth.md): email and username login, migration and rollback
- [docs/vector-search.md](docs/vector-search.md): embeddings and the Atlas Vector Search index
- [docs/admin-pipeline-control.md](docs/admin-pipeline-control.md): admin pipeline controls
- [docs/company-profile.md](docs/company-profile.md): company profile for bids

## Branches and CI

Work goes into feature branches and is merged into `develop` by pull request. CI runs Build, Test (mocked data), API contract, Semgrep and a health check. A green `develop` is promoted to `main` automatically. Details: [CI/CD and branch flow](docs/reference.md#cicd-and-branch-flow).
