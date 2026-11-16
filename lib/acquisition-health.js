import { randomUUID } from 'node:crypto';
import Attempt from '../models/AcquisitionAttempt.js';

export const HEALTH_POLICY = Object.freeze({ sampleSize: 100, minimumSample: 20, targetSuccessRate: 0.9, consecutiveFailureThreshold: 5, staleAfterHours: 24 });
export function summarizeAcquisitions(rows, now = new Date()) {
    const real = rows.filter(row => row.status !== 'skipped').sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
    const successful = real.filter(row => row.status === 'success');
    const lastSuccessAt = successful[0]?.completed_at || null;
    let consecutiveFailures = 0;
    for (const row of real) { if (row.status === 'success') break; consecutiveFailures++; }
    const successRate = real.length ? successful.length / real.length : null;
    const stale = real.length > 0 && now - new Date(real[0].completed_at) > HEALTH_POLICY.staleAfterHours * 3600000;
    const degraded = consecutiveFailures >= HEALTH_POLICY.consecutiveFailureThreshold
        || (real.length >= HEALTH_POLICY.minimumSample && successRate < HEALTH_POLICY.targetSuccessRate) || stale;
    const bySource = {}, byRun = {};
    for (const row of real) {
        const value = bySource[row.source] ||= { attempted: 0, succeeded: 0 };
        value.attempted++; if (row.status === 'success') value.succeeded++;
        if (row.run_id) { const run = byRun[row.run_id] ||= { attempted: 0, succeeded: 0 }; run.attempted++; if (row.status === 'success') run.succeeded++; }
    }
    return { status: degraded ? 'degraded' : real.length < HEALTH_POLICY.minimumSample ? 'insufficient_data' : 'healthy',
        policy: HEALTH_POLICY, attempted: real.length, succeeded: successful.length, failed: real.length - successful.length,
        skipped: rows.length - real.length, successRate, consecutiveFailures, lastSuccessAt,
        lastAttemptAt: real[0]?.completed_at || null, stale, bySource, byRun,
        scope: 'latest acquisition attempts; not OCR, Vertex, or metadata-ingestion success' };
}
export async function recordAcquisitionAttempt(input, Model = Attempt) {
    // Isolated tests/CLI without a database do not silently buffer telemetry writes.
    if (Model === Attempt && Attempt.db.readyState !== 1) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(String(input.projectId))) return false;
    const end = new Date();
    const record = { attempt_key: input.attemptKey || randomUUID(), project_id: String(input.projectId),
        run_id: input.runId || null, source: input.source, status: input.status, reason_code: input.reasonCode || null,
        route: ['feed', 'browser', 'known', 'cached'].includes(input.route) ? input.route : null,
        started_at: input.startedAt, completed_at: end, duration_ms: Math.max(0, end - new Date(input.startedAt)) };
    try {
        await Model.updateOne({ attempt_key: record.attempt_key }, { $setOnInsert: record }, { upsert: true, runValidators: true });
        if (record.status === 'failed') console.error(JSON.stringify({ event: 'acquisition_failed', projectId: record.project_id, reasonCode: record.reason_code }));
        return true;
    } catch {
        console.error(JSON.stringify({ event: 'acquisition_health_write_failed' }));
        return false; // Observability failure must not discard valid acquired documents.
    }
}
export async function getAcquisitionHealth(Model = Attempt, now = new Date()) {
    if (Model === Attempt && Attempt.db.readyState !== 1) return { status: 'unavailable' };
    // Benchmarks are opt-in, read-only probes and must not inflate production reliability.
    const rows = await Model.find({ source: { $ne: 'benchmark' } }).sort({ completed_at: -1, _id: -1 }).limit(HEALTH_POLICY.sampleSize).lean();
    return summarizeAcquisitions(rows, now);
}
