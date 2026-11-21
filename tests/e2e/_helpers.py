"""Shared HTTP helpers for the e2e scripts."""
import json, os, time, sys, urllib.request, urllib.error, secrets

BASE = os.environ.get('E2E_BASE', 'http://localhost:3000')
TOR = sys.argv[1] if len(sys.argv) > 1 else '66089621504'
rows = []


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Client:
    """Keeps cookies by hand: the session cookie is Secure in production, and a plain-http client would drop it."""
    def __init__(self):
        self.opener = urllib.request.build_opener(NoRedirect())
        self.cookies = {}


def client():
    return Client()


def call(op, method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Origin': BASE}
    if op.cookies:
        headers['Cookie'] = '; '.join(f'{k}={v}' for k, v in op.cookies.items())
    if data:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    t = time.time()
    try:
        r = op.opener.open(req, timeout=60)
        status, payload, hdrs = r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        status, payload, hdrs = e.code, e.read(), e.headers
    for line in hdrs.get_all('Set-Cookie') or []:
        pair = line.split(';')[0]
        k, _, v = pair.partition('=')
        if v and 'Max-Age=0' not in line and 'expires=Thu, 01 Jan 1970' not in line:
            op.cookies[k] = v
        else:
            op.cookies.pop(k, None)
    ms = int((time.time() - t) * 1000)
    if raw:
        return status, payload, ms
    try:
        return status, json.loads(payload or b'null'), ms
    except Exception:
        return status, payload[:200], ms


def step(name, expect, got, ms, note=''):
    ok = got in expect if isinstance(expect, (list, tuple, set)) else got == expect
    rows.append((name, 'PASS' if ok else 'FAIL', f'HTTP {got}', ms, note))
    return ok


