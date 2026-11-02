# TOR embeddings and Atlas Vector Search (FR-2.3.1)

## What is stored

For each project with an AI summary (`latest_summary_id`), `projects.vectorEmbedding` holds a
768-number Vertex AI embedding of: project name, agency, summary, scope of work and tech stack
(`lib/vertex/embedding.js`, model `text-embedding-005`). The field is excluded from queries unless
selected with `+vectorEmbedding`.

`projects.embedding` records the state: `status` (`ready` / `failed`), `model`, `dimensions`,
`source_hash` (hash of the embedded text), `summary_id`, `attempts`, `error`, `updated_at`.

## When it runs

- **Worker:** right after a processing job completes (`scripts/worker.js`). A failure is stored on the
  project and never fails the job.
- **Sweep:** while the worker is idle (every `EMBEDDING_SWEEP_MS`, default 60 s) it embeds projects whose
  `embedding.summary_id` differs from `latest_summary_id` (new or re-summarised TOR), and retries failed
  ones after 10 minutes, up to 5 attempts.
- **Manual:** `npm run embed -- --limit=100` or `--project-id=<id>`.

Needs `VERTEX_AI_ENABLED=true` and `GOOGLE_CLOUD_PROJECT`; otherwise the step is skipped.

## Index

`project_vector_index` (type `vectorSearch`) on `projects`: `vectorEmbedding` (768 dims, cosine) plus
filter fields `is_software` and `dept_name`. `npm run db:ensure-indexes` creates or updates it on Atlas
(it logs a warning and continues on a plain mongod). Example query:

```js
db.projects.aggregate([{ $vectorSearch: {
  index: "project_vector_index", path: "vectorEmbedding", queryVector: <768 numbers>,
  numCandidates: 100, limit: 10, filter: { is_software: true } } }])
```

Changing `VERTEX_EMBEDDING_MODEL` or `VERTEX_EMBEDDING_DIMENSIONS` changes `source_hash`, so every project is
re-embedded by the sweep; run `db:ensure-indexes` first so the index dimensions match.
