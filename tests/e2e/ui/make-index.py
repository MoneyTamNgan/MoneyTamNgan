"""Builds docs/testing/evidence-index.md (every function, video time, screenshot) from results.json.

    python3 tests/e2e/ui/make-index.py EVIDENCE_DIR OUT.md GITHUB_BASE_URL_OF_EVIDENCE_DIR
"""
import json, os, sys
ev, out, base = sys.argv[1], sys.argv[2], sys.argv[3].rstrip('/')
res = json.load(open(os.path.join(ev, 'results.json')))
mm = lambda s: f'{s // 60:02d}:{s % 60:02d}'
total = sum(len(r['steps']) for r in res); ok = sum(s['result'] == 'PASS' for r in res for s in r['steps'])
L = ['# Evidence index: every function, with its video and screenshot', '',
     f'Run of 22 Nov 2026 on the demo machine, `v1.0.0` plus the fixes of PR #242, #243 and #245, real Atlas. {ok} of {total} steps pass ([test-sheet.md](test-sheet.md)). '
     'One video per flow; each row gives the time in the video and the screenshot of that step. The AI draft flows (F07, F07b) used the `agy` CLI as the AI through [the bridge](../agy-bridge.md) running on the demo machine itself, not the local model. '
     'Evidence from before the fixes (81 of 85) is kept in [../evidence/testing-2026-11-22/](../evidence/testing-2026-11-22/).', '']
for r in res:
    L += [f"## {r['id']}: {r['title']}", '', f"Video: [{r['video']}]({base}/{r['video']})", '',
          '| Step | Function tested | Result | Video time | Screenshot |', '|---|---|---|---|---|']
    for s in r['steps']:
        L.append(f"| {s['id']} | {s['action'].replace('|', '/')} | {s['result']} | {mm(s['at'])} | [img]({base}/{s['screenshot']}) |")
    L.append('')
L += ['## Other evidence', '', f'- Exported DOCX: [{base}/F06-bidprep-draft/exported-draft.docx]({base}/F06-bidprep-draft/exported-draft.docx)',
      '- Responsive screenshots at 360/768/1280 px, and `/projects` at 360 px after the fix: [screenshots-2026-11-22/](../evidence/screenshots-2026-11-22/)',
      '- API smoke test (34 steps): [e2e-test-2026-11-22.md](../e2e-test-2026-11-22.md)', '',
      '## Not covered (needs credentials, real mail, or would change live data)', '',
      '- Complete Google sign-in (only the redirect is tested, F02-10)', '- "ทดสอบส่งอีเมล" and match-score email delivery',
      '- Trigger of the ingestion pipeline and classification override from the admin page', '- Opening the DOCX in Microsoft Word', '']
open(out, 'w').write('\n'.join(L))
print(out, ok, total)
