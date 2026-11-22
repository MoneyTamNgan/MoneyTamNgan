# Using `agy` as the AI for the demo (bridge)

The app calls a local model through the Ollama protocol (`AI_PROVIDER=ollama`). A small bridge, `tools/agy-bridge/server.mjs`, speaks that protocol and answers by running the `agy` CLI (Gemini) on the machine where `agy` is installed. Any demo machine can use it by pointing `OLLAMA_BASE_URL` at that machine. No change to the app is needed.

```
demo machine (docker: worker)  --Ollama /api/chat-->  bridge on the laptop  --agy-task-->  Gemini
```

## On the machine that has `agy`
```bash
HOST=<this machine's tailscale IP> node tools/agy-bridge/server.mjs      # port 11500
curl http://<that ip>:11500/health                                        # -> ok
```
Options: `PORT`, `AGY_MODEL` (default `gemini-3.8-flash-medium`), `MAX_PARALLEL` (default 2, more gets HTTP 429), `TIMEOUT_S` (default 900).

## On the demo machine (`.env`)
```
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://<laptop tailscale IP>:11500
PROPOSAL_DRAFT_TIMEOUT_MS=0
```
Then `docker compose ... up -d --no-deps --force-recreate worker`. A draft takes about 1 to 1.5 minutes.

## Can another machine do the same?
Yes. Any machine that can reach the laptop's address can set `OLLAMA_BASE_URL` to it (same tailnet, or the same LAN). Only the laptop needs `agy`.

## Limits and risks
- **No authentication.** Anyone who can reach the port can spend your `agy` quota. Listen on the tailscale address only (never `0.0.0.0`), and restrict it with a tailscale ACL if the tailnet is shared.
- **TOR text and the company profile leave the machine** and go to Gemini through `agy`. Use test data for demos; do not use it with real customers without approval.
- **The laptop must stay on and awake**, otherwise drafts fail.
- Whether the output is valid JSON for the draft schema is not guaranteed; the app validates it and fails the job with a clear message if it is not.
- Demo only. Production should use Vertex AI (`AI_PROVIDER=vertex`).
- The AI draft flows in the test evidence (F07, F07b of 22 Nov 2026) were recorded with this bridge: [testing/review-and-defects.md](testing/review-and-defects.md) section 4.
