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

Preview rendered docs:

```
npx @redocly/cli preview-docs docs/api/openapi.yaml
```
