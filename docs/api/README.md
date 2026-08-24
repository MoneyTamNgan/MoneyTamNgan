# API Contract

`openapi.yaml` in this folder is the source of truth for the JSON REST API between
the Next.js frontend and the Node.js backend, covering the full system.

Each path is tagged with its status:

- **Current** — `TORs`, `Admin - Ingestion`, `Admin - Classification`.
  This is the committed, build-now contract.
- **Planned** — `PDF Summary`, `Auth`, `Contractor Profile`, `Matching`,
  `Anomaly Detection`, `Public Analytics`. These exist so FE/BE only design the
  contract once, but are **not frozen** — revisit and adjust each one once
  it's actually being built.

Validate after editing:

```
npx @redocly/cli lint docs/api/openapi.yaml
```

Preview rendered docs (Redoc, not Swagger UI — no "Try it out" button, just
readable docs):

```
npx @redocly/cli build-docs docs/api/openapi.yaml -o docs/api/preview.html
open docs/api/preview.html
```

Or serve with live-reload on edits:

```
npx @redocly/cli preview -d docs/api
```
