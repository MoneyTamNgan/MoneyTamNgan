# Connectivity and local AI test, 19 Nov 2026 (#129, #139)

Historical test report. Traces to: NFR-5 ([#127](https://github.com/MoneyTamNgan/MoneyTamNgan/issues/127), [#129](https://github.com/MoneyTamNgan/MoneyTamNgan/issues/129)). See [traceability.md](traceability.md).

Run on the competition machine (see [local-deployment.md](local-deployment.md)). No secret appears in this file.

## MongoDB Atlas (real database)

10 inserts and 10 reads of a temporary document in a scratch collection, which was dropped afterwards.

| Check | Result |
|---|---|
| Connect | 1.1 s (including DNS and TLS) |
| Ping | 83 ms |
| Write (10) | average 99 ms, maximum 138 ms |
| Read (10) | average 93 ms, maximum 107 ms |
| `/api/health` against Atlas | `database: connected` |
| `/api/tors?limit=2` | 838 TORs in total, so the app reads the real data |

## AI provider

Vertex billing is not available, so the stack uses a local model through Ollama on the same machine (`AI_PROVIDER=ollama`, `qwen2.5:3b`, 100% on the GPU, context 8192). Code: `lib/ai/ollama.js`, tests: `tests/unit/ollama-provider.test.js`. The Gemini-style request is translated to Ollama's `/api/chat` and back, so extraction and drafting code is unchanged. Embeddings (vector search) stay on Vertex and are switched off with the local provider.

| Check | Result |
|---|---|
| Short Thai extraction with a response schema | 13.3 s, finish `STOP`, valid JSON, all 3 numbers correct |
| AI unreachable (closed port) | draft fails in 20 ms with code `VERTEX_UNAVAILABLE` and a clear message; nothing hangs |

## Proposal drafts on real TORs (#139), `qwen2.5:3b`

Made-up, deliberately incomplete company profile; the database was read only. Command: `node scripts/measure-proposal-draft.js --inject --out`.

| TOR | Seconds | Within 90 s | Scope rows | Dropped (no source) | Placeholders | Schema retries | Prompt leak |
|---|---|---|---|---|---|---|---|
| 68019088742 | 90.0 | **no** (timeout) | - | - | - | 0 | - |
| 66089621472 | 90.0 | **no** (timeout) | - | - | - | 0 | - |
| 66089621504 | 74.1 | yes | 32/32 | 2 | 43 | 0 | no |

- **The 90 second criterion of #139 is not met on this hardware: 2 of 3 TORs time out.** The model runs fully on the GPU, so the limit is the number of Thai tokens to generate.
- `qwen2.5:1.5b` was tried on the same TORs and was worse (3 of 3 timed out), so `qwen2.5:3b` stays.
- Prompt injection check on 68019088742: the structure was kept and the system prompt was not leaked.
- The one successful draft and its source table are in `docs/evidence/proposal-drafts/`.

## Database outage

A second app instance was started with `MONGODB_URI` pointing at a closed port: `/api/health` returned 503 (`database: disconnected`) in 3.0 s and `/api/tors` returned 500 in 3.0 s. Nothing hung, and the main app stayed healthy. The bundled MongoDB route (plain `docker compose up`) was the first stack started on this machine and answered `/api/health` with 200 and `database: connected`.

## Not done yet

- A timed rehearsal of switching the demo from Atlas to the bundled MongoDB with pre-processed data.
- A draft run with a stronger model (a hosted provider, or a bigger GPU) to meet the 90 second criterion.
