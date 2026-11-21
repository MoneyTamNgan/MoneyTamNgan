"""Checklist on several different TORs (#144): clear, ambiguous and incomplete conditions.

    E2E_BASE=http://localhost:3000 python3 tests/e2e/checklist-variants.py [N]

Registers one throw-away account, reads the checklist of N TORs (default 25) and prints pass/fail/manual
counts per TOR, then picks the most-clear (fewest manual), most-ambiguous (most manual) and an incomplete one
(no items or an error). Deletes the account at the end. Read only apart from the account itself.
"""
import importlib.util, os, sys, secrets
spec = importlib.util.spec_from_file_location('smoke_helpers', os.path.join(os.path.dirname(__file__), '_helpers.py'))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
call, client = h.call, h.client
N = int(sys.argv[1]) if len(sys.argv) > 1 else 25
tag = secrets.token_hex(3); pw = 'E2e-Test-' + secrets.token_hex(6)
u = {'email': f'e2e-v-{tag}@example.test', 'username': f'e2e_v_{tag}', 'password': pw, 'name': 'E2E V'}
A = client()
call(A, 'POST', '/api/auth/register', u)
_, lst, _ = call(client(), 'GET', f'/api/tors?limit={N}')
rows = []
for t in (lst.get('data') or lst.get('tors') or lst.get('items') or []):
    pid = str(t.get('id') or t.get('project_id') or t.get('_id'))
    s, c, ms = call(A, 'GET', f'/api/bid-prep/tors/{pid}/checklist')
    items = c.get('items', []) if isinstance(c, dict) else []
    cnt = {k: sum(i.get('status') == k for i in items) for k in ('pass', 'fail', 'manual')}
    rows.append((pid, s, len(items), cnt, ms))
print('| TOR | HTTP | items | pass | fail | manual | ms |\n|---|---|---|---|---|---|---|')
for pid, s, n, c, ms in rows:
    print(f"| {pid} | {s} | {n} | {c['pass']} | {c['fail']} | {c['manual']} | {ms} |")
ok = [r for r in rows if r[1] == 200 and r[2]]
if ok:
    print('\nclear     :', min(ok, key=lambda r: r[3]['manual'] / r[2])[0])
    print('ambiguous :', max(ok, key=lambda r: r[3]['manual'] / r[2])[0])
bad = [r for r in rows if r[1] != 200 or not r[2]]
print('incomplete:', bad[0][0] if bad else 'none found in sample')
call(A, 'DELETE', '/api/profiles')
