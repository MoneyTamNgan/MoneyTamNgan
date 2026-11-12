#!/usr/bin/env python3
"""Summarize a ZAP baseline JSON report and gate on High-risk alerts.

Usage: summarize-zap.py <zap-dast-report.json>
ZAP risk codes: 0 informational, 1 low, 2 medium, 3 high. Exit 1 on any high.
"""
import collections
import json
import os
import sys

NAMES = {"3": "High", "2": "Medium", "1": "Low", "0": "Informational"}


def main(path: str) -> int:
    with open(path, encoding="utf-8") as handle:
        report = json.load(handle)
    alerts = [a for site in report.get("site", []) for a in site.get("alerts", [])]
    counts = collections.Counter(str(a.get("riskcode", "0")) for a in alerts)
    high = [a for a in alerts if str(a.get("riskcode")) == "3"]

    lines = ["## OWASP ZAP baseline (passive)", "", "| Risk | Alerts |", "|---|---|"]
    for code in ("3", "2", "1", "0"):
        lines.append(f"| {NAMES[code]} | {counts.get(code, 0)} |")
    lines.append("")
    for a in sorted(alerts, key=lambda a: -int(a.get("riskcode", 0))):
        lines.append(f"- **{NAMES.get(str(a.get('riskcode')), '?')}**: {a.get('name') or a.get('alert')}")
    text = "\n".join(lines)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    return 1 if high else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: summarize-zap.py <zap-dast-report.json>")
    sys.exit(main(sys.argv[1]))
