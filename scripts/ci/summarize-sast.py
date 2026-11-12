#!/usr/bin/env python3
"""Summarize a Semgrep JSON report and gate on High (ERROR) findings.

Usage: summarize-sast.py <sast-report.json>
Prints a Markdown summary (also appended to $GITHUB_STEP_SUMMARY when set).
Exit code 1 if any ERROR-severity finding is present, or if a scan error is
more serious than a warning-level parse issue.
"""
import collections
import json
import os
import sys


def is_blocking_scan_error(error):
    """Warning/info parse issues should not fail the build; real scan failures should."""
    level = str(error.get("level") or "").strip().lower()
    return level not in {"warn", "warning", "info"}


def main(path: str) -> int:
    with open(path, encoding="utf-8") as handle:
        report = json.load(handle)
    results = report.get("results", [])
    errors = report.get("errors", [])
    counts = collections.Counter(r["extra"]["severity"] for r in results)
    high = [r for r in results if r["extra"]["severity"] == "ERROR"]
    blocking_errors = [error for error in errors if is_blocking_scan_error(error)]

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
    if errors:
        lines.append("### Scan errors")
        for error in errors:
            path_name = error.get("path") or ""
            level = error.get("level") or "unknown"
            message = str(error.get("message") or "").split("\n")[0]
            suffix = " (build fails)" if is_blocking_scan_error(error) else " (does not fail the build)"
            lines.append(f"- `{path_name}` [{level}] {message}{suffix}")
        lines.append("")
    text = "\n".join(lines)
    print(text)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    return 1 if high or blocking_errors else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: summarize-sast.py <sast-report.json>")
    sys.exit(main(sys.argv[1]))
