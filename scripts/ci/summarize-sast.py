#!/usr/bin/env python3
"""Summarize a Semgrep JSON report and gate on High (ERROR) findings.

Usage: summarize-sast.py <sast-report.json>
Prints a Markdown summary (also appended to $GITHUB_STEP_SUMMARY when set).
Exit code 1 if any ERROR-severity finding or scan error is present.
"""
import collections
import json
import os
import sys


def main(path: str) -> int:
    with open(path, encoding="utf-8") as handle:
        report = json.load(handle)
    results = report.get("results", [])
    errors = report.get("errors", [])
    counts = collections.Counter(r["extra"]["severity"] for r in results)
    high = [r for r in results if r["extra"]["severity"] == "ERROR"]

    lines = [
        "## Semgrep SAST (p/owasp-top-ten)",
        "",
        "| Severity | Findings |",
        "|---|---|",
        f"| ERROR (high) | {counts.get('ERROR', 0)} |",
        f"| WARNING | {counts.get('WARNING', 0)} |",
        f"| INFO | {counts.get('INFO', 0)} |",
        f"| Scan errors | {len(errors)} |",
        "",
    ]
    if high:
        lines.append("### High findings (build fails)")
        for r in high:
            lines.append(f"- `{r['path']}:{r['start']['line']}` {r['check_id'].split('.')[-1]}")
        lines.append("")
    text = "\n".join(lines)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    return 1 if high or errors else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: summarize-sast.py <sast-report.json>")
    sys.exit(main(sys.argv[1]))
