# MoneyTamNgan

Tracks software-related TOR (procurement) projects from Thailand's e-GP portal: it ingests project metadata, downloads and reads the TOR documents (text and Thai OCR), summarises them with Vertex AI, and shows them in a Next.js dashboard with search, matching and analytics. A Bid Preparation Assistant helps sellers prepare bid documents; it never submits a bid.

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![MongoDB Atlas](https://img.shields.io/badge/MongoDB_Atlas-Vector_Search-47A248?logo=mongodb&logoColor=white)
![Mongoose](https://img.shields.io/badge/Mongoose-9-880000)
![Vertex AI](https://img.shields.io/badge/Vertex_AI-Gemini_2.5_Flash-4285F4?logo=googlecloud&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer-25-40B5A4?logo=puppeteer&logoColor=white)
![Tesseract](https://img.shields.io/badge/Tesseract_OCR-Thai_%2B_English-5A5A5A)
![Poppler](https://img.shields.io/badge/Poppler-pdf_text-5A5A5A)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI%2FCD-2088FF?logo=githubactions&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-5-6E9F18?logo=vitest&logoColor=white)
![Semgrep](https://img.shields.io/badge/Semgrep-SAST-1B2A3B)
![OWASP ZAP](https://img.shields.io/badge/OWASP_ZAP-DAST-00549E)

## Project documents

- [MoneyTamNgan_SRS](https://docs.google.com/document/d/1_o6RmB_G54MWgXHGiePvBzy-vLkhECAzDnhtU15rz0A/edit?usp=sharing): official SRS and use case diagram (TOR aggregation, matching, analytics).
- [SRS adhoc requirement](https://docs.google.com/document/d/1u8PlICl8XWIjGJUca1KImYh5keUNDkgUoAU73ERks8A/edit?usp=sharing): short SRS for the Bid Preparation Assistant (epic #135), waiting for customer confirmation (#143).
- [MoneyTamNgan Testcase doc](https://docs.google.com/spreadsheets/d/1DAK7xXw7uJ3rpTrQNPMUjbzi6WOAh-0dQBn6BTv8dQo/edit?usp=sharing): automated tests mapped to modules and source files.
- [Sprint api planing](https://docs.google.com/spreadsheets/d/1aXUlWRg__PmH6LtbzPxBnOCS7z7v9pk-xxEpwySVCU0/edit?usp=sharing): sprint API plan (ticket, endpoint, expected response, status).
- [MoneyTamNgan Secure Test](https://docs.google.com/spreadsheets/d/1zl9NWZmycvNj0Brg7PMB2kdizVcQq-ihKPNbVODycvY/edit?usp=sharing): STRIDE and ASVS security catalog with project status.
- [TOR Discovery, Extraction, and Display](docs/tor-flow.md): sequence diagram of the pipeline.
- [TOR pull pipeline](docs/pipeline.md): stage-by-stage flowchart with statuses and code locations.

## How a software TOR flows through the system

1. **Discover:** the scheduler or an admin run reads the e-GP feed and stores new projects.
2. **Acquire:** the worker downloads each TOR document (PDF or ZIP).
3. **Extract:** text and OCR, then a Vertex AI summary and embedding.
4. **Display:** the dashboard lists and searches the result; admins can review and override.

```mermaid
flowchart LR
    A[Ingest e-GP metadata] --> B[Classify software]
    B --> C[Check tender open]
    C --> D[Acquire TOR PDF or ZIP]
    D --> E[Extract text + Thai OCR]
    E --> F[Vertex AI summary]
    F --> G[Embedding]
    G --> H[Dashboard and search]
```

Stage details, statuses and failure paths: [docs/pipeline.md](docs/pipeline.md). Actor-by-actor sequence: [docs/tor-flow.md](docs/tor-flow.md).

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
- [docs/bid-prep-decisions.md](docs/bid-prep-decisions.md): team decisions on the open SRS questions for the Bid Preparation Assistant
- [tests/e2e/](tests/e2e/README.md): browser test for username login (Playwright) and its evidence

## Branches and CI

Work goes into feature branches and is merged into `develop` by pull request. CI runs Build, Test (mocked data), API contract, Semgrep and a health check. A green `develop` is promoted to `main` automatically. Details: [CI/CD and branch flow](docs/reference.md#cicd-and-branch-flow).
