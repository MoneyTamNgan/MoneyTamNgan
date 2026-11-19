#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const day = 86400000;
function activeException(entry, now) {
    const start = Date.parse(entry.starts_at), end = Date.parse(entry.expires_at);
    return entry.status === 'approved' && typeof entry.approved_by === 'string' && entry.approved_by.trim()
        && typeof entry.owner === 'string' && entry.owner.trim()
        && /^https:\/\/github\.com\/MoneyTamNgan\/MoneyTamNgan\/issues\/\d+$/.test(entry.tracking_issue || '')
        && typeof entry.reason === 'string' && entry.reason.trim()
        && typeof entry.controls === 'string' && entry.controls.trim()
        && entry.scope === 'development-only' && Number.isFinite(start) && Number.isFinite(end)
        && start <= now && now < end && end > start && end - start <= 30 * day;
}

/** Evaluate the full audit graph; never waive production, critical or unknown findings. */
export function evaluateAudit(audit, lock, exceptions = [], now = Date.now()) {
    if (audit?.auditReportVersion !== 2 || audit.error || !audit.vulnerabilities
        || !audit.metadata?.vulnerabilities || !lock?.packages || !Array.isArray(exceptions)) {
        throw new Error('Invalid audit or policy input');
    }
    const findings = audit.vulnerabilities;
    const approvals = exceptions.filter(entry => activeException(entry, now));
    function covered(name, visiting = new Set()) {
        const finding = findings[name];
        if (!finding || visiting.has(name) || finding.severity === 'critical'
            || !Array.isArray(finding.nodes) || !finding.nodes.length
            || !finding.nodes.every(node => lock.packages[node]?.dev === true)
            || !Array.isArray(finding.via) || !finding.via.length) return false;
        const next = new Set([...visiting, name]);
        return finding.via.every(via => typeof via === 'string' ? covered(via, next)
            : via?.severity !== 'critical' && approvals.some(entry => via?.url === `https://github.com/advisories/${entry.advisory}`));
    }
    const rows = Object.entries(findings).map(([name, value]) => {
        if (!['info', 'low', 'moderate', 'high', 'critical'].includes(value.severity)) {
            throw new Error('Unknown audit severity');
        }
        const blocking = ['high', 'critical'].includes(value.severity);
        return { package: name, severity: value.severity,
            outcome: !blocking ? 'reported' : covered(name) ? 'accepted-temporarily' : 'blocked' };
    });
    return { passed: !rows.some(row => row.outcome === 'blocked'), findings: rows,
        acceptedExceptions: approvals.map(({ advisory, expires_at, tracking_issue }) => ({ advisory, expires_at, tracking_issue })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const execution = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
            ['audit', '--package-lock-only', '--json'], { encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
        if (execution.error || ![0, 1].includes(execution.status)) throw new Error('Audit command failed');
        const result = evaluateAudit(JSON.parse(execution.stdout),
            JSON.parse(readFileSync('package-lock.json', 'utf8')),
            JSON.parse(readFileSync('docs/security/dependency-exceptions.json', 'utf8')));
        // Keep every finding visible, including accepted risks; green never means "no vulnerabilities".
        console.log(JSON.stringify(result, null, 2));
        writeFileSync('dependency-audit-result.json', JSON.stringify(result, null, 2) + '\n');
        process.exitCode = result.passed ? 0 : 1;
    } catch {
        console.error('Dependency audit could not be verified; refusing to pass.');
        try { writeFileSync('dependency-audit-result.json', JSON.stringify({ passed: false, error: 'AUDIT_UNVERIFIED' }) + '\n'); }
        catch { /* The command still fails if even the evidence cannot be written. */ }
        process.exitCode = 1;
    }
}
