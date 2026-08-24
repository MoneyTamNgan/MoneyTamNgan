# API Contract

`openapi.yaml` in this folder is the source of truth for the JSON REST API between
the Next.js frontend and the Node.js backend, covering all 4 epics from the SRS.

Each path is tagged with which sprint actually builds it:

- **Sprint 1 (build now)** — `TORs`, `Admin - Ingestion`, `Admin - Classification`.
  This is the committed target for the current sprint's DoD.
- **Sprint 2-5 draft** — `PDF Summary`, `Auth`, `Contractor Profile`, `Matching`,
  `Anomaly Detection`, `Public Analytics`. These exist so FE/BE only design the
  contract once, but are **not frozen** — revisit and adjust each one at the
  start of the sprint that implements it.

Validate after editing:

```
npx @redocly/cli lint docs/api/openapi.yaml
```

Preview rendered docs:

```
npx @redocly/cli preview-docs docs/api/openapi.yaml
```
