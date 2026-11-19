import { describe, it, expect } from 'vitest';
import { evaluateAudit } from '../../scripts/check-dependency-audit.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const advisory = 'GHSA-fc5q-39xc-vjpf';
function fixture() {
    const audit = { auditReportVersion: 2, metadata: { vulnerabilities: {} }, vulnerabilities: {
        picomatch: { severity: 'high', nodes: ['node_modules/picomatch'], via: [{ url: `https://github.com/advisories/${advisory}`, severity: 'high' }] },
        vitest: { severity: 'high', nodes: ['node_modules/vitest'], via: ['picomatch'] },
    } };
    const lock = { packages: { 'node_modules/picomatch': { dev: true }, 'node_modules/vitest': { dev: true } } };
    const entry = { advisory, status: 'approved', approved_by: 'fixture-reviewer', owner: 'fixture-owner',
        tracking_issue: 'https://github.com/MoneyTamNgan/MoneyTamNgan/issues/188', scope: 'development-only',
        starts_at: '2026-11-18T00:00:00Z', expires_at: '2026-12-02T00:00:00Z', reason: 'Fixture only', controls: 'Fixture controls' };
    return { audit, lock, entry, run(entries = [entry]) { return evaluateAudit(audit, lock, entries, now); } };
}

describe('dependency audit risk gate', () => {
    it('blocks unapproved high findings', () => {
        const f = fixture(); expect(f.run([]).passed).toBe(false);
        f.entry.status = 'proposed'; expect(f.run().passed).toBe(false);
    });
    it('accepts only the approved development advisory and shows every affected package', () => {
        const result = fixture().run(); expect(result.passed).toBe(true);
        expect(result.findings).toEqual([
            { package: 'picomatch', severity: 'high', outcome: 'accepted-temporarily' },
            { package: 'vitest', severity: 'high', outcome: 'accepted-temporarily' },
        ]);
    });
    it.each(['2026-11-18T12:00:00Z', '2026-11-17T00:00:00Z', '2027-01-01T00:00:00Z', 'invalid'])('blocks expired/overlong/invalid expiry %s', expires => {
        const f = fixture(); f.entry.expires_at = expires; expect(f.run().passed).toBe(false);
    });
    it('blocks an exception that has not started', () => {
        const f = fixture(); f.entry.starts_at = '2026-11-19T00:00:00Z'; expect(f.run().passed).toBe(false);
    });
    it.each(['approved_by', 'owner', 'tracking_issue', 'reason', 'controls'])('requires %s', key => {
        const f = fixture(); delete f.entry[key]; expect(f.run().passed).toBe(false);
    });
    it('blocks production occurrences and unknown lockfile nodes', () => {
        const f = fixture(); f.lock.packages['node_modules/picomatch'].dev = false; expect(f.run().passed).toBe(false);
        delete f.lock.packages['node_modules/picomatch']; expect(f.run().passed).toBe(false);
    });
    it('blocks critical findings even for the same advisory', () => {
        const f = fixture(); f.audit.vulnerabilities.picomatch.severity = 'critical'; expect(f.run().passed).toBe(false);
    });
    it('blocks unrelated advisories, including a second advisory on the same package', () => {
        const f = fixture(); f.audit.vulnerabilities.picomatch.via.push({ url: 'https://github.com/advisories/GHSA-new-advisory', severity: 'high' });
        expect(f.run().passed).toBe(false);
    });
    it('blocks graph cycles and missing advisory dependencies', () => {
        const f = fixture(); f.audit.vulnerabilities.picomatch.via = ['vitest']; expect(f.run().passed).toBe(false);
        f.audit.vulnerabilities.picomatch.via = ['unknown']; expect(f.run().passed).toBe(false);
    });
    it('reports moderate findings without blocking', () => {
        const f = fixture(); for (const v of Object.values(f.audit.vulnerabilities)) v.severity = 'moderate';
        expect(f.run([]).findings.every(row => row.outcome === 'reported')).toBe(true);
        expect(f.run([]).passed).toBe(true);
    });
    it('fails closed on audit errors, malformed reports and unknown severity', () => {
        const f = fixture(); expect(() => evaluateAudit({ error: {} }, f.lock)).toThrow();
        f.audit.vulnerabilities.picomatch.severity = 'unknown'; expect(() => f.run()).toThrow();
    });
});
