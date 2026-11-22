// Ollama-compatible /api/chat in front of the `agy` CLI (Antigravity, Gemini).
// Lets the app's AI_PROVIDER=ollama path use a laptop that has `agy-task` instead of a local model.
// Not for production: no authentication, one CLI process per request.
//
//   HOST=<tailscale ip of this machine> node tools/agy-bridge/server.mjs
//   env: HOST (required, never 0.0.0.0 unless you know the network), PORT=11500,
//        AGY_MODEL=gemini-3.8-flash-medium, AGY_TASK=agy-task, MAX_PARALLEL=2, TIMEOUT_S=900
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const HOST = process.env.HOST;
const PORT = Number(process.env.PORT || 11500);
const MODEL = process.env.AGY_MODEL || 'gemini-3.8-flash-medium';
const AGY_TASK = process.env.AGY_TASK || 'agy-task';
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL || 2);
const TIMEOUT_S = Number(process.env.TIMEOUT_S || 900);
// agy runs in an empty directory so it cannot read this repository.
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-'));
let running = 0;

export function buildPrompt(body) {
    const messages = (body.messages || []).map(m => `[${m.role}]\n${m.content}`).join('\n\n');
    const schema = body.format && body.format !== 'json'
        ? `\n\nReply with ONLY one JSON object (no markdown fence, no commentary) that validates against this JSON Schema:\n${JSON.stringify(body.format)}`
        : '\n\nReply with ONLY one JSON object, no markdown fence.';
    return `You are a text generator behind an API. Do not use tools or read files; answer from the text below only.\n\n${messages}${schema}`;
}

export function extractJson(output) {
    let text = String(output || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a >= 0 && b > a) text = text.slice(a, b + 1);
    return text;
}

function handle(req, res) {
    if (req.method === 'GET' && req.url === '/health') { res.writeHead(200).end('ok'); return; }
    if (req.method !== 'POST' || !req.url.startsWith('/api/chat')) { res.writeHead(404).end(); return; }
    if (running >= MAX_PARALLEL) { res.writeHead(429, { 'Retry-After': '30' }).end('busy'); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 4e6) req.destroy(); });
    req.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { res.writeHead(400).end('bad json'); return; }
        running += 1;
        const started = Date.now();
        execFile(AGY_TASK, ['-m', MODEL, '-d', WORKDIR, '-t', `${TIMEOUT_S}s`, buildPrompt(body)],
            { maxBuffer: 64e6, timeout: (TIMEOUT_S + 60) * 1000 }, (error, stdout) => {
                running -= 1;
                const text = extractJson(stdout);
                console.log(new Date().toISOString(), error ? `ERR ${error.message.slice(0, 80)}` : 'ok', `${text.length} chars`, `${Date.now() - started} ms`);
                if (error && !text) { res.writeHead(502).end('agy failed'); return; }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ model: 'agy', message: { role: 'assistant', content: text }, done: true, done_reason: 'stop' }));
            });
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    if (!HOST) { console.error('Set HOST to the address to listen on (for example your tailscale IP).'); process.exit(2); }
    http.createServer(handle).listen(PORT, HOST, () => console.log(`agy bridge on http://${HOST}:${PORT} (model ${MODEL}, parallel ${MAX_PARALLEL})`));
}
