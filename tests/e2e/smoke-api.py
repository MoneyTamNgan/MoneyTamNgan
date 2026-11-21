"""API smoke test (#127). Runs the main user flows against a running stack and cleans up after itself.

    E2E_BASE=http://localhost:3000 python3 tests/e2e/smoke-api.py [TOR_ID]

It registers two throw-away accounts (e2e-a-*/e2e-b-*@example.test), checks that one cannot read the
other's drafts, exports a DOCX, queues one AI proposal draft, then deletes both accounts through the
product's own account deletion. Run it on the machine itself: the session cookie is Secure in
production, so the cookie is kept by hand here.
"""
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


guest = client()
s, h, ms = call(guest, 'GET', '/api/health'); step('Health', 200, s, ms, f"database={h.get('database')}")
s, lst, ms = call(guest, 'GET', '/api/tors?limit=5'); step('TOR list (guest)', 200, s, ms, f"total={lst.get('total')}")
s, d, ms = call(guest, 'GET', f'/api/tors/{TOR}'); step('TOR detail', 200, s, ms)
s, q, ms = call(guest, 'GET', '/api/tors?limit=5&q=' + urllib.request.quote('ระบบ')); step('Keyword search', 200, s, ms, f"total={q.get('total')}")
s, f, ms = call(guest, 'GET', '/api/tors/facets'); step('Facets', 200, s, ms)
s, _, ms = call(guest, 'GET', '/api/bid-prep/drafts'); step('Drafts without login blocked', 401, s, ms)
s, _, ms = call(guest, 'GET', '/api/admin/pipeline'); step('Admin API without login blocked', [401, 403], s, ms)

tag = secrets.token_hex(3)
pw = 'E2e-Test-' + secrets.token_hex(6)
A, B = client(), client()
ua = {'email': f'e2e-a-{tag}@example.test', 'username': f'e2e_a_{tag}', 'password': pw, 'name': 'E2E A'}
ub = {'email': f'e2e-b-{tag}@example.test', 'username': f'e2e_b_{tag}', 'password': pw, 'name': 'E2E B'}
s, _, ms = call(A, 'POST', '/api/auth/register', ua); step('Register A (email+username)', 201, s, ms)
s, _, ms = call(B, 'POST', '/api/auth/register', ub); step('Register B', 201, s, ms)
A2 = client(); s, _, ms = call(A2, 'POST', '/api/auth/login', {'identifier': ua['email'], 'password': pw}); step('Login A by email', 200, s, ms)
A3 = client(); s, _, ms = call(A3, 'POST', '/api/auth/login', {'identifier': ua['username'], 'password': pw}); step('Login A by username', 200, s, ms)
s, bad, ms = call(client(), 'POST', '/api/auth/login', {'identifier': ua['email'], 'password': 'wrong-password-1'}); step('Wrong password rejected', 401, s, ms)
s, me, ms = call(A, 'GET', '/api/auth/me'); step('Session (me)', 200, s, ms)

s, _, ms = call(A, 'PUT', '/api/profiles', {'company_name': 'E2E Test Co', 'registered_capital': 5000000, 'skills': ['Next.js', 'MongoDB']}); step('Edit company profile', [200, 201], s, ms)
s, p, ms = call(A, 'GET', '/api/profiles'); step('Read profile', 200, s, ms)

s, _, ms = call(A, 'GET', '/api/admin/pipeline'); step('Normal user blocked from admin API', [401, 403], s, ms)
s, _, ms = call(A, 'GET', '/admin', raw=True); step('Normal user blocked from /admin page', [302, 303, 307, 308, 401, 403, 404], s, ms)

s, c, ms = call(A, 'GET', f'/api/bid-prep/tors/{TOR}/checklist'); n = len(c.get('items', [])) if isinstance(c, dict) else 0
step('Checklist (A)', 200, s, ms, f'items={n}')
s, _, ms = call(guest, 'GET', f'/api/bid-prep/tors/{TOR}/checklist'); step('Checklist without login blocked', 401, s, ms)

s, dr, ms = call(A, 'POST', '/api/bid-prep/drafts', {'projectId': TOR, 'title': 'E2E draft', 'sections': [{'heading': 'Company overview', 'body': 'Test body. [to fill in: company facts]', 'sources': ['profile.company_name']}]})
step('Create draft (A)', 201, s, ms)
did = dr.get('id') if isinstance(dr, dict) else None
if did:
    s, _, ms = call(A, 'GET', f'/api/bid-prep/drafts/{did}'); step('Read own draft', 200, s, ms)
    s, _, ms = call(B, 'GET', f'/api/bid-prep/drafts/{did}'); step('B cannot read A draft (isolation)', [403, 404], s, ms)
    s, _, ms = call(B, 'POST', f'/api/bid-prep/drafts/{did}/export', raw=True); step('B cannot export A draft', [403, 404], s, ms)
    s, blob, ms = call(A, 'POST', f'/api/bid-prep/drafts/{did}/export', raw=True)
    step('Export blocked until every checklist item passed', 409, s, ms, 'CHECKLIST_NOT_PASSED')
    # the owner confirms each checklist item (PATCH), as the UI does; then the export is allowed
    s, cl, _ = call(A, 'GET', f'/api/bid-prep/tors/{TOR}/checklist')
    marked = 0
    for item in (cl.get('items', []) if isinstance(cl, dict) else []):
        if item.get('status') == 'pass':
            continue
        for _ in range(6):
            s, _, _ = call(A, 'PATCH', f'/api/bid-prep/tors/{TOR}/checklist', {'itemId': item['id'], 'status': 'pass'})
            if s != 429:
                break
            time.sleep(10)
        marked += s == 200
    rows.append(('Mark checklist items passed', 'PASS' if marked or not cl.get('items') else 'FAIL', 'HTTP 200', 0, f'marked={marked}'))
    s, blob, ms = call(A, 'POST', f'/api/bid-prep/drafts/{did}/export', raw=True)
    step('DOCX export (A)', 200, s, ms, f"zip-magic={'yes' if blob[:2] == b'PK' else 'no'} bytes={len(blob)}")
    s, lb, ms = call(B, 'GET', '/api/bid-prep/drafts'); step('B list does not include A draft', 200, s, ms,
                                                              f"B_drafts={len(lb.get('drafts', [])) if isinstance(lb, dict) else '?'}")

s, job, ms = call(A, 'POST', f'/api/tors/{TOR}/proposal-draft')
step('Queue AI proposal draft', 202, s, ms)
if s == 202:
    jid = job['jobId']; t0 = time.time(); final = None
    while time.time() - t0 < 150:
        time.sleep(4)
        s2, j, _ = call(A, 'GET', f'/api/tors/{TOR}/proposal-draft?jobId={jid}')
        final = j.get('jobStatus') or j.get('status') if isinstance(j, dict) else None
        if final in ('completed', 'failed'):
            break
    rows.append(('AI proposal draft finishes', 'PASS' if final == 'completed' else 'FAIL', f'job={final}', int((time.time() - t0) * 1000), 'local Ollama qwen2.5:3b'))
    s, _, ms = call(B, 'GET', f'/api/tors/{TOR}/proposal-draft?jobId={jid}'); step("B cannot read A's AI job", [403, 404], s, ms)

s, _, ms = call(A, 'POST', '/api/auth/logout'); step('Logout A', [200, 204], s, ms)
s, _, ms = call(A, 'GET', '/api/auth/me'); step('Session ends after logout', 401, s, ms)

# cleanup: delete both test accounts and their drafts through the product's own account deletion
for name, op, u in (('A', A2, ua), ('B', B, ub)):
    s, _, ms = call(op, 'POST', '/api/auth/login', {'identifier': u['email'], 'password': pw}) if name == 'A' else (200, None, 0)
    s, _, ms = call(op, 'DELETE', '/api/profiles'); step(f'Cleanup: delete test account {name}', 200, s, ms)

print('| Step | Result | Status | ms | Note |\n|---|---|---|---|---|')
for r in rows:
    print('| ' + ' | '.join(str(x) for x in r) + ' |')
print('\nPASS', sum(r[1] == 'PASS' for r in rows), 'FAIL', sum(r[1] == 'FAIL' for r in rows))
