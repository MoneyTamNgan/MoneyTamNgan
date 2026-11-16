#!/usr/bin/env node
// Read-only live transport benchmark: no Mongo writes, Vertex calls or email.
import 'dotenv/config';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectOpenTenders } from '../lib/egp-rss.js';
import { classifyProjectMetadata } from '../lib/classifier.js';
import { createAcquisitionContext, closeAcquisitionContext, acquireTenderDocuments } from '../lib/tender-acquisition.js';
import { announcementProcurementEligibility } from '../lib/announcement-schedule.js';
import { classifyScrapeFailure } from '../lib/scrape-failure.js';
import { summarizeAcquisitions } from '../lib/acquisition-health.js';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const limit = Number(option('limit', '20')), scan = Number(option('scan', '100'));
const depts = option('depts', '1507,2102,0703,0804,0806').split(',');
const output = option('output', '/tmp/mtn-acquisition-benchmark.json');
if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(scan) || scan < limit || scan > 200
    || !depts.length || depts.length > 10 || depts.some(id => !/^\d{4}$/.test(id))) throw Error('Invalid bounded limit/scan/depts');
const startedAt = new Date();
const stop = new AbortController();
const overallTimer = setTimeout(() => stop.abort(new Error('Benchmark time budget exceeded')), 10 * 60 * 1000);
overallTimer.unref();
process.once('SIGINT', () => stop.abort(new Error('Benchmark interrupted')));
process.once('SIGTERM', () => stop.abort(new Error('Benchmark interrupted')));
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => originalFetch(url, { ...init,
    signal: AbortSignal.any([...(init.signal ? [init.signal] : []), stop.signal, AbortSignal.timeout(15000)]) });
const dir = await mkdtemp(path.join(os.tmpdir(), 'mtn-acquisition-benchmark-'));
const allowBrowser = process.argv.includes('--browser');
const ctx = createAcquisitionContext({ storageDir: dir, allowBrowser, retryDelaysMs: [15000], browserDeadlineMs: 60000 });
const discoveryErrors = [], rows = [];
try {
    const tenders = await collectOpenTenders({ deptIds: depts, maxProjects: scan, backoffMs: [], typeFailureLimit: 2,
        onError: ({ deptId, type, error }) => { const event = { deptId, type, code: classifyScrapeFailure(error).outcome }; discoveryErrors.push(event); console.log(JSON.stringify(event)); } });
    const software = tenders.filter(t => classifyProjectMetadata({ project_name: t.title }).isSoftware === true).slice(0, limit);
    for (const tender of software) {
        if (stop.signal.aborted) break;
        const begin = new Date(); let row;
        try {
            const outcome = await acquireTenderDocuments(tender, ctx, {
                checkEligibility: announcement => announcementProcurementEligibility({ project_id: tender.projectId }, announcement),
            });
            row = { project_id: tender.projectId, source: 'benchmark',
                status: outcome.tor ? 'success' : outcome.torDeferred ? 'skipped' : 'failed',
                reason_code: outcome.torDeferred ? `procurement_${outcome.eligibility?.status}` : outcome.torErrorCode || null,
                route: outcome.torRoute, announcement: Boolean(outcome.announcement), eligibility: outcome.eligibility?.status || 'unknown' };
        } catch (error) { row = { project_id: tender.projectId, source: 'benchmark', status: 'failed', reason_code: classifyScrapeFailure(error).outcome }; }
        rows.push({ ...row, duration_ms: Date.now() - begin, completed_at: new Date().toISOString() });
        console.log(JSON.stringify({ projectId: row.project_id, status: row.status, reasonCode: row.reason_code }));
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const report = { startedAt, completedAt: new Date(), samplePolicy: 'built-in software keyword classification; official open-bid verification before TOR acquisition',
        requestedSample: limit, discovered: tenders.length, softwareCandidates: software.length, allowBrowser,
        summary: summarizeAcquisitions(rows), discoveryErrors, rows,
        acceptance: rows.filter(r => r.status !== 'skipped').length >= 20 ? 'measurement available; team must confirm target and cohort' : 'insufficient eligible sample; no 90% reliability claim',
        limitations: 'No OCR/Vertex quality measurement. Benchmark is excluded from production telemetry. No live project data changed.' };
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(`Sanitized report: ${output}`);
} finally {
    clearTimeout(overallTimer);
    globalThis.fetch = originalFetch;
    await closeAcquisitionContext(ctx);
    await rm(dir, { recursive: true, force: true });
}
