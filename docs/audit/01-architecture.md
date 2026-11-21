# Architecture, data flow and trust boundaries

## 1. System context

```mermaid
flowchart LR
    U[Seller / user<br/>browser] -->|HTTPS| APP
    A[Admin<br/>browser] -->|HTTPS, admin role| APP
    subgraph HOST[Demo / production host: Docker Compose]
        APP[app<br/>Next.js 16 pages + API routes<br/>proxy.js: auth, rate limit, CORS, CSP]
        WRK[worker<br/>scripts/worker.js<br/>job queue consumer]
        SCR[scraper<br/>scripts/scrape.js]
        SCH[scheduler<br/>scripts/ingestion-scheduler.js<br/>06:00 / 12:00 / 18:00]
        FS[(tor-storage volume<br/>PDF files)]
    end
    DB[(MongoDB<br/>local mongo container or Atlas)]
    APP --> DB
    WRK --> DB
    SCR --> DB
    SCH --> DB
    WRK --- FS
    SCR --- FS
    SCR -->|HTTPS| EGP[e-GP open data / RSS / announcement pages]
    SCH -->|HTTPS| EGP
    WRK -->|extraction, drafts| AI[AI provider<br/>Vertex AI, or local Ollama]
    APP -->|queue draft job| DB
    APP -->|OAuth| GO[Google OAuth]
    WRK -->|email| MAIL[Resend / SMTP]
```

Only `app` is reachable by users (port 3000). `worker`, `scraper` and `scheduler` have no inbound port; they read and write MongoDB and call out to external services.

## 2. Containers and responsibilities

| Container | Code | Responsibility |
|---|---|---|
| `app` | `app/` (pages, `app/api/**/route.js`), `proxy.js`, `components/`, `lib/` | UI and REST API; authentication, authorisation, validation, rate limits, security headers |
| `worker` | `scripts/worker.js`, `lib/processing-pipeline.js`, `lib/job-queue.js` | Claims queued jobs: download, OCR/text extraction, AI extraction, classification, proposal drafts, notification matching |
| `scraper` | `scripts/scrape.js`, `lib/scraper.js`, `lib/document-resolver.js` | Fetches TOR PDFs and archives from e-GP (anti-bot aware) |
| `scheduler` | `scripts/ingestion-scheduler.js`, `lib/ingestion-runner.js` | Starts ingestion runs on the schedule; single-run lock |
| `mongo` / Atlas | `models/*` | Persistence; Atlas Vector Search for semantic search |

## 3. Layers inside `app`

```mermaid
flowchart TB
    R[Route handler<br/>app/api/**/route.js] --> W[Security wrapper<br/>withRouteSecurity / withBidPrep]
    W --> S[Service / domain module<br/>lib/bid-prep/*, lib/services/*, lib/proposal/*]
    S --> M[Mongoose model<br/>models/*]
    S --> X[External adapter<br/>lib/ai/ollama.js, lib/vertex/*, lib/email.js, lib/egp-*.js]
    P[proxy.js middleware<br/>runs before every request] --> R
```

Rule of thumb for auditors: **identity comes only from the signed session** (`requestPrincipal`), never from the request body or URL. Every Bid Prep query filters on the session user id.

## 4. Pipeline (TOR from e-GP to a searchable record)

1. **Discover**: RSS / open data / announcement feed produces `DiscoveryCandidate` and `Project` metadata.
2. **Classify**: keyword rules (`Keyword`) and AI decide software / not software; low confidence goes to the admin review queue (`ClassificationOverride` records every override).
3. **Acquire**: resolve and download the TOR (ZIP/PDF) with size, entry-count and compression-ratio limits; store through the storage backend (`local`, `gridfs`, `gcs`).
4. **Extract text**: embedded text or OCR per page (`DocumentPage`), recorded in an `ExtractionRun` keyed by processor fingerprint and text hash (idempotent).
5. **AI extraction**: Vertex or Ollama returns schema-validated JSON stored in `DocumentSummary` (model and prompt version recorded); low confidence sets `needs_review`.
6. **Enrich**: fiscal budget analysis, anomaly flag, embeddings, revision lineage.
7. **Serve and notify**: list, search, detail, match score; matching users get email (`NotificationDelivery` / `NotificationBatch`, deduplicated).

Stage details and status values: [../pipeline.md](../pipeline.md), [../tor-flow.md](../tor-flow.md).

## 5. BidPrep data flow (the new feature)

```mermaid
sequenceDiagram
    actor User
    participant App as app (Next.js API)
    participant DB as MongoDB
    participant Q as ProcessingJob queue
    participant W as worker
    participant AI as AI provider
    User->>App: PUT /api/profiles (company details)
    App->>DB: save on the user's own document
    User->>App: GET /api/bid-prep/tors/{id}/checklist
    App->>DB: read TOR requirements + user profile
    App-->>User: items: pass / fail / manual with reason and page
    User->>App: PATCH checklist item (confirm)
    User->>App: POST /api/tors/{id}/proposal-draft
    App->>Q: enqueue job (owner_id = session user)
    W->>Q: claim job (lease)
    W->>AI: prompt built from TOR text + profile only
    AI-->>W: JSON validated against schema
    W->>DB: drop rows without a source, mark [to fill in: ...]
    User->>App: edit draft (version checked)
    User->>App: POST export (blocked until every item is pass)
    App-->>User: DOCX (no execution of supplied markup)
```

The system never submits a bid to e-GP; the seller does that with their own digital signature.

## 6. Trust boundaries

| # | Boundary | Untrusted input | Controls |
|---|---|---|---|
| TB1 | Browser to `app` | Every request field, cookies, headers | `proxy.js`: session check, scope check, CORS allow-list, rate limit, CSP/HSTS; per-route validation ([../API_VALIDATION.md](../API_VALIDATION.md)) |
| TB2 | `app` to MongoDB | Query operators in user data | Typed schemas, controlled queries, ownership filters (input validation: [../API_VALIDATION.md](../API_VALIDATION.md); injection is listed as a partial control in the audit) |
| TB3 | e-GP to `scraper` | HTML, ZIP and PDF from a third party | URL safety (`lib/url-safety.js`, SSRF guard), size and zip-bomb limits, no execution of content |
| TB4 | Documents to AI | TOR text may contain prompt injection | Fixed system prompt, schema-validated output, rows without a source are dropped, injection test recorded |
| TB5 | `worker` to AI provider | Sends TOR text (public) and the owner's profile for drafts | Provider choice is configuration; credentials only in the host environment |
| TB6 | `app` to email | Recipient and content | Frozen payload and idempotency key per batch; deduplicated per user and project |
| TB7 | Host to Atlas | Network path | Atlas IP access list, TLS, least-privilege DB user |

Threat model: [../security/THREAT_MODEL.md](../security/THREAT_MODEL.md). RBAC matrix: [../security/RBAC_SPEC.md](../security/RBAC_SPEC.md).

## 7. Deployment views

| Mode | Command | Database | Use |
|---|---|---|---|
| Local | `docker compose up --build` | bundled `mongo` | development, offline demo |
| Live data | `docker compose -f docker-compose.yml -f docker-compose.atlas.yml up --build` (or the machine-local `docker-compose.real-db.yml`) | MongoDB Atlas | demo with real data |

Start, stop, rollback: [../local-deployment.md](../local-deployment.md).
