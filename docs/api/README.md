# API Contract

`openapi.yaml` in this folder is the source of truth for the JSON REST API between
the Next.js frontend and the Node.js backend. Sprint 1 scope only (TOR ingestion +
software/non-software classification) — see the "Out of scope" comment at the
bottom of the file for what's intentionally excluded.

Validate after editing:

```
npx @redocly/cli lint docs/api/openapi.yaml
```

Preview rendered docs:

```
npx @redocly/cli preview-docs docs/api/openapi.yaml
```
