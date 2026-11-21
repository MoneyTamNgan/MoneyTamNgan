"""Checklist pass/fail with a realistic profile (#144): only the past-project value check is automatic.

    python3 tests/e2e/checklist-profile-values.py TOR_ID [TOR_ID ...]

One throw-away account; sets highest_past_project_value very high, then very low, and prints how each TOR's checklist
changes (pass / fail / manual). The account is deleted at the end.
"""
import importlib.util, os, sys, secrets
spec = importlib.util.spec_from_file_location('h', os.path.join(os.path.dirname(__file__), '_helpers.py'))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
call, client = h.call, h.client
tag = secrets.token_hex(3); pw = 'E2e-Test-' + secrets.token_hex(6)
A = client()
call(A, 'POST', '/api/auth/register', {'email': f'e2e-p-{tag}@example.test', 'username': f'e2e_p_{tag}', 'password': pw, 'name': 'E2E P'})
print('| TOR | past-project value (THB) | items | pass | fail | manual |\n|---|---|---|---|---|---|')
for value in (1_000_000_000, 1):
    s, _, _ = call(A, 'PUT', '/api/profiles', {'company_name': 'E2E Test Co', 'registered_capital': 5000000, 'skills': ['Next.js'],
                                               'concurrent_project_capacity': 3, 'certifications': ['ISO 27001'], 'highest_past_project_value': value})
    for pid in sys.argv[1:]:
        s, c, _ = call(A, 'GET', f'/api/bid-prep/tors/{pid}/checklist')
        items = c.get('items', []) if isinstance(c, dict) else []
        n = {k: sum(i.get('status') == k for i in items) for k in ('pass', 'fail', 'manual')}
        print(f"| {pid} | {value:,} (PUT {s}) | {len(items)} | {n['pass']} | {n['fail']} | {n['manual']} |")
call(A, 'DELETE', '/api/profiles')
