"""Builds the test sheet (markdown + csv) from results.json written by flows.mjs.

    python3 tests/e2e/ui/make-sheet.py EVIDENCE_DIR OUT.md [EVIDENCE_PATH_FROM_DOCS]
"""
import csv, json, os, sys

ev, out = sys.argv[1], sys.argv[2]
rel = sys.argv[3] if len(sys.argv) > 3 else '../evidence/testing-2026-11-22'
results = json.load(open(os.path.join(ev, 'results.json')))
mmss = lambda s: f'{s // 60:02d}:{s % 60:02d}'

lines = ['# UI test sheet, `v1.0.0`, 22 Nov 2026', '',
         'Plan: [test-plan.md](test-plan.md). Every flow is one recorded video; the time column is the position in that video. '
         'Results come from `results.json` written by the test run; nothing was edited by hand.', '']
tot = {'PASS': 0, 'FAIL': 0}
lines += ['## Summary', '', '| Flow | Title | Steps | Pass | Fail | Video | Length |', '|---|---|---|---|---|---|---|']
for r in results:
    p = sum(s['result'] == 'PASS' for s in r['steps']); f = sum(s['result'] == 'FAIL' for s in r['steps'])
    tot['PASS'] += p; tot['FAIL'] += f
    lines.append(f"| {r['id']} | {r['title']} | {len(r['steps'])} | {p} | {f} | [video]({rel}/{r['video']}) | {mmss(r.get('seconds', 0))} |")
lines += ['', f"**Total: {tot['PASS']} passed, {tot['FAIL']} failed of {tot['PASS'] + tot['FAIL']} steps.**", '']
defects = []
for r in results:
    lines += [f"## {r['id']}: {r['title']}", '', f"Video: [{r['video']}]({rel}/{r['video']})", '',
              '| Step | Action | Expected | Actual | Result | Video time | Screenshot |', '|---|---|---|---|---|---|---|']
    for s in r['steps']:
        shot = f"[img]({rel}/{s['screenshot']})" if s.get('screenshot') else ''
        cell = lambda t: str(t).replace('|', '\\|').replace('\n', ' ')
        lines.append(f"| {s['id']} | {cell(s['action'])} | {cell(s['expected'])} | {cell(s['actual'])} | {'✅ PASS' if s['result'] == 'PASS' else '❌ FAIL'} | {mmss(s['at'])} | {shot} |")
        if s['result'] == 'FAIL':
            defects.append((r, s))
    lines.append('')
lines += ['## Defects found', '']
if not defects:
    lines.append('None in this run.')
else:
    lines += ['| # | Flow / step | What happened | Video |', '|---|---|---|---|']
    for i, (r, s) in enumerate(defects, 1):
        lines.append(f"| D{i} | {r['id']} step {s['id']}: {s['action']} | {str(s['actual']).replace('|', '/')} | [{mmss(s['at'])}]({rel}/{r['video']}) |")
open(out, 'w').write('\n'.join(lines) + '\n')
with open(out.replace('.md', '.csv'), 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['flow', 'step', 'action', 'expected', 'actual', 'result', 'video', 'video_time', 'screenshot'])
    for r in results:
        for s in r['steps']:
            w.writerow([r['id'], s['id'], s['action'], s['expected'], s['actual'], s['result'], f"{rel}/{r['video']}", mmss(s['at']), f"{rel}/{s.get('screenshot', '')}"])
print(out, tot)
