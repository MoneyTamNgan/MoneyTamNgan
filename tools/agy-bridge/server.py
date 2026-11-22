#!/usr/bin/env python3
"""Ollama-compatible /api/chat in front of the `agy` CLI (Antigravity, Gemini). Standard library only.

Lets the app's AI_PROVIDER=ollama path use a machine that has `agy` instead of a local model.
Not for production: no authentication, one CLI process per request.

    HOST=172.17.0.1 python3 tools/agy-bridge/server.py

env: HOST (required), PORT=11500, AGY_MODEL=gemini-3.8-flash-medium, AGY=agy, MAX_PARALLEL=2, TIMEOUT_S=900

AGY is the command name "agy" or an absolute path to an executable named agy.
AGY_MODEL is one token (letters, digits, . _ + -). TIMEOUT_S is 1..86400 seconds.
The CLI is started with shell=False, so those values are arguments, not a shell command.
"""
import json, os, re, shlex, shutil, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Operator configuration is checked before it is placed on the argv list.
# For the character sets accepted below, shlex.quote() returns the value unchanged.
_TOKEN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,80}')
_ABS_AGY = re.compile(r'/(?:[A-Za-z0-9._+-]+/)*agy')


def checked_token(value, label):
    if not isinstance(value, str) or not _TOKEN.fullmatch(value):
        sys.exit(f'{label} must be one token of letters, digits, and . _ + -')
    return value


def checked_agy(value):
    """Resolve AGY to an absolute executable path whose basename is agy."""
    if not isinstance(value, str) or value == '' or '\x00' in value:
        sys.exit('AGY must be "agy" or an absolute path to an executable named agy')
    if '/' not in value:
        if value != 'agy':
            sys.exit('AGY command name must be agy')
        resolved = shutil.which('agy')
        if not resolved:
            sys.exit('agy was not found on PATH')
        value = resolved
    parts = value.split('/')
    if (not value.startswith('/') or parts[0] != '' or parts[-1] != 'agy'
            or any(part in ('', '.', '..') for part in parts[1:])
            or not _ABS_AGY.fullmatch(value)
            or not os.path.isfile(value) or not os.access(value, os.X_OK)):
        sys.exit('AGY must be an absolute path to an executable file named agy, without shell characters')
    return value


def checked_timeout(value):
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        sys.exit('TIMEOUT_S must be an integer number of seconds')
    if isinstance(value, bool) or not 1 <= seconds <= 86400:
        sys.exit('TIMEOUT_S must be between 1 and 86400')
    return seconds


HOST = os.environ.get('HOST')
PORT = int(os.environ.get('PORT', '11500'))
MAX_PARALLEL = int(os.environ.get('MAX_PARALLEL', '2'))
MODEL = 'gemini-3.8-flash-medium'
AGY = 'agy'
TIMEOUT_S = 900
SLOTS = threading.BoundedSemaphore(MAX_PARALLEL)


def configure():
    """Validate operator settings before the process listens or runs agy."""
    global MODEL, AGY, TIMEOUT_S
    if not HOST or HOST in {'0.0.0.0', '::'}:
        sys.exit('Set HOST to a specific address to listen on (for example the docker bridge 172.17.0.1 or a tailscale IP). Do not listen on every interface.')
    MODEL = checked_token(os.environ.get('AGY_MODEL', MODEL), 'AGY_MODEL')
    AGY = checked_agy(os.environ.get('AGY', AGY))
    TIMEOUT_S = checked_timeout(os.environ.get('TIMEOUT_S', str(TIMEOUT_S)))


def build_prompt(body):
    messages = '\n\n'.join(f"[{m.get('role')}]\n{m.get('content')}" for m in body.get('messages') or [])
    fmt = body.get('format')
    if fmt and fmt != 'json':
        tail = ('\n\nReply with ONLY one JSON object (no markdown fence, no commentary) that validates against this JSON Schema:\n'
                + json.dumps(fmt))
    else:
        tail = '\n\nReply with ONLY one JSON object, no markdown fence.'
    return ('You are a text generator behind an API. Do not use tools or read files; answer from the text below only.\n\n'
            + messages + tail)


def extract_json(output):
    text = re.sub(r'\s*```\s*$', '', re.sub(r'^```(?:json)?\s*', '', (output or '').strip(), flags=re.I))
    a, b = text.find('{'), text.rfind('}')
    return text[a:b + 1] if a >= 0 and b > a else text


def run_agy(prompt, workdir):
    # shell=False, so the prompt is one argument and cannot add shell commands.
    # quote() is a no-op for the executable, model, and timeout that checked_* allow.
    cmd = [shlex.quote(AGY), '-p', prompt, '--model', shlex.quote(MODEL), '--mode', 'plan',
           '--dangerously-skip-permissions', '--output-format', 'json',
           '--print-timeout', shlex.quote(f'{TIMEOUT_S}s')]
    done = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, shell=False, timeout=TIMEOUT_S + 60)
    data = json.loads(done.stdout)
    if data.get('status') != 'SUCCESS':
        raise RuntimeError(f"agy status {data.get('status')}")
    return extract_json(data.get('response', ''))


class Handler(BaseHTTPRequestHandler):
    workdir = None

    def log_message(self, *args):
        pass

    def reply(self, code, body=b'', ctype='text/plain', headers=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200, b'ok') if self.path == '/health' else self.reply(404)

    def do_POST(self):
        if not self.path.startswith('/api/chat'):
            return self.reply(404)
        length = int(self.headers.get('Content-Length') or 0)
        if length > 4_000_000:
            return self.reply(413)
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            return self.reply(400, b'bad json')
        if not SLOTS.acquire(blocking=False):
            return self.reply(429, b'busy', headers={'Retry-After': '30'})
        started = time.time()
        try:
            text = run_agy(build_prompt(body), self.workdir)
            print(time.strftime('%FT%T'), 'ok', len(text), 'chars', int((time.time() - started) * 1000), 'ms', flush=True)
            payload = {'model': 'agy', 'message': {'role': 'assistant', 'content': text}, 'done': True, 'done_reason': 'stop'}
            self.reply(200, json.dumps(payload).encode(), 'application/json')
        except Exception as error:  # noqa: BLE001 - report any agy failure as a 502
            print(time.strftime('%FT%T'), 'ERR', str(error)[:100], flush=True)
            self.reply(502, b'agy failed')
        finally:
            SLOTS.release()


if __name__ == '__main__':
    configure()
    # agy runs in an empty directory so it cannot read this repository.
    Handler.workdir = tempfile.mkdtemp(prefix='agy-bridge-')
    print(f'agy bridge on http://{HOST}:{PORT} (model {MODEL}, parallel {MAX_PARALLEL})', flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
