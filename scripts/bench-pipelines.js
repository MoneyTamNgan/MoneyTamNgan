#!/usr/bin/env node

/**
 * TOR scraping pipeline benchmark
 *
 * Usage:
 *   node scripts/bench-pipelines.js --discover-depts --from=0101 --to=2512
 *       Probe RSS department codes one at a time; writes bench/rss-depts.json
 *   node scripts/bench-pipelines.js --build-set=a --limit=200
 *       Open tenders from RSS B0+D0 of known departments -> bench/set-a.json
 *   node scripts/bench-pipelines.js --build-set=b --limit=50
 *       Older e-bidding projects from the govspending contract API -> bench/set-b.json
 *   node scripts/bench-pipelines.js --set=bench/set-a.json --pipeline=all --limit=5 --run-label=smoke
 *       Run pipelines; writes bench/results/<label>/<P>.jsonl and summary.json
 *   node scripts/bench-pipelines.js --compare=morning,afternoon,night
 *       Per-pipeline agreement of usefulTor across runs
 */

import 'dotenv/config';
import { mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchAnnouncementFeed } from '../lib/egp-rss.js';
import { fetchFromEGP } from '../lib/egp-api.js';
import { DEFAULT_DELAY_MS } from '../lib/scraper.js';
import { PIPELINES, evaluate } from '../bench/adapters.js';

const BENCH_DIR = path.join(process.cwd(), 'bench');
const RSS_DELAY_MS = 4000;
const RSS_BACKOFF_MS = [30000, 90000, 180000];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The feed answers bursts with HTTP 429 or dropped connections; back off and retry. */
async function fetchFeedPolitely(options) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fetchAnnouncementFeed(options);
        } catch (error) {
            if (attempt >= RSS_BACKOFF_MS.length) throw error;
            console.warn(`${options.deptId}/${options.type}: ${error.message}; backing off ${RSS_BACKOFF_MS[attempt] / 1000}s`);
            await sleep(RSS_BACKOFF_MS[attempt]);
        }
    }
}

function parseArgs() {
    const args = {};
    for (const arg of process.argv.slice(2)) {
        if (!arg.startsWith('--')) continue;
        const [key, ...rest] = arg.slice(2).split('=');
        args[key] = rest.length ? rest.join('=') : true;
    }
    return args;
}

async function readJson(file, fallback) {
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    } catch {
        return fallback;
    }
}

/** Sequential on purpose: parallel requests made the feed stop responding. */
async function discoverDepts({ from = '0101', to = '2512' }) {
    const out = path.join(BENCH_DIR, 'rss-depts.json');
    const known = await readJson(out, {});
    const [m0, d0] = [Number(from.slice(0, 2)), Number(from.slice(2))];
    const [m1, d1] = [Number(to.slice(0, 2)), Number(to.slice(2))];
    for (let m = m0; m <= m1; m++) {
        for (let d = m === m0 ? d0 : 1; d <= (m === m1 ? d1 : 12); d++) {
            const deptId = `${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
            if (deptId in known) continue;
            try {
                const items = await fetchFeedPolitely({ deptId, type: 'D0' });
                known[deptId] = items.length;
                console.log(`${deptId}: ${items.length}`);
            } catch (error) {
                console.warn(`${deptId}: ${error.message}`);
            }
            await writeFile(out, JSON.stringify(known, null, 2));
            await sleep(RSS_DELAY_MS);
        }
    }
}

async function buildSetA(limit) {
    const depts = Object.entries(await readJson(path.join(BENCH_DIR, 'rss-depts.json'), {}))
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([deptId]) => deptId);
    if (!depts.length) throw new Error('No departments known; run --discover-depts first');

    const byProject = new Map();
    for (const deptId of depts) {
        for (const type of ['B0', 'D0']) {
            try {
                for (const item of await fetchFeedPolitely({ deptId, type })) {
                    const entry = byProject.get(item.projectId) || {
                        projectId: item.projectId, deptId, title: item.title, method: item.method,
                        b0Link: null, d0Link: null, pubDate: item.pubDate,
                    };
                    entry[type === 'B0' ? 'b0Link' : 'd0Link'] = item.link;
                    byProject.set(item.projectId, entry);
                }
            } catch (error) {
                console.warn(`${deptId}/${type}: ${error.message}`);
            }
            await sleep(RSS_DELAY_MS);
        }
        console.log(`${deptId}: ${byProject.size} projects so far`);
        if (byProject.size >= limit) break;
    }
    return [...byProject.values()].slice(0, limit);
}

/** Deterministic PRNG so a sampled set can be rebuilt with the same --seed. */
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

/**
 * The contract API sorts by budget, so the first page is all mega-projects
 * with very large archives. Sample pages at random offsets instead.
 */
async function buildSetB(limit, seed = 42) {
    const year = process.env.BENCH_YEAR || '2569';
    const random = seededRandom(seed);
    const { total } = await fetchFromEGP({ year, limit: 1 });
    const pageSize = 100;
    const byProject = new Map();
    for (let page = 0; page < limit * 3 && byProject.size < limit; page++) {
        const offset = Math.floor(random() * Math.max(1, total - pageSize));
        let records;
        try {
            ({ records } = await fetchFromEGP({ year, limit: pageSize, offset }));
        } catch (error) {
            console.warn(`offset ${offset}: ${error.cause?.code || error.message}`);
            continue;
        }
        const ebidding = records.filter(record => /e-bidding/i.test(record.purchase_method_name || ''));
        for (let i = 0; i < 5 && ebidding.length; i++) {
            const [pick] = ebidding.splice(Math.floor(random() * ebidding.length), 1);
            byProject.set(pick.project_id, pick);
        }
    }
    return [...byProject.values()]
        .slice(0, limit)
        .map(record => ({
            projectId: record.project_id, title: record.project_name,
            method: record.purchase_method_name, b0Link: null, d0Link: null, pubDate: null,
        }));
}

function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function summarize(rows, total) {
    const attempted = rows.filter(row => row.attempted);
    const pct = count => (attempted.length ? Math.round((count / attempted.length) * 1000) / 10 : 0);
    const failures = {};
    for (const row of attempted) {
        if (row.failure) failures[row.failure.outcome] = (failures[row.failure.outcome] || 0) + 1;
    }
    return {
        total,
        attempted: attempted.length,
        coveragePct: Math.round((attempted.length / total) * 1000) / 10,
        fetchedPct: pct(attempted.filter(row => row.fetched).length),
        usefulTorPct: pct(attempted.filter(row => row.usefulTor).length),
        torTextReadyPct: pct(attempted.filter(row => row.torTextReady).length),
        closingDatePct: pct(attempted.filter(row => row.closesAt).length),
        p50Ms: percentile(attempted.map(row => row.ms), 0.5),
        p95Ms: percentile(attempted.map(row => row.ms), 0.95),
        failures,
    };
}

async function runPipeline(key, entries, { runDir, delayMs, keepFiles }) {
    const pipeline = PIPELINES[key];
    const workDir = path.join(runDir, 'work', key);
    const ctx = { workDir, delayMs };
    const outFile = path.join(runDir, `${key}.jsonl`);
    await rm(outFile, { force: true });
    await mkdir(workDir, { recursive: true });
    console.log(`\n▶ ${pipeline.name}: ${entries.length} projects`);

    const rows = [];
    const record = async row => {
        rows.push(row);
        await appendFile(outFile, `${JSON.stringify(row)}\n`);
        const mark = !row.attempted ? '·' : row.usefulTor ? '✅' : row.fetched ? '🟡' : '❌';
        console.log(`  ${mark} ${row.projectId} ${row.ms ?? '-'}ms ${row.failure?.outcome || ''}`);
    };

    await pipeline.setup?.(ctx);
    try {
        const applicable = entries.filter(entry => pipeline.applies(entry));
        for (const entry of entries.filter(e => !pipeline.applies(e))) {
            await record({ pipeline: key, projectId: entry.projectId, attempted: false });
        }

        const batch = pipeline.batch ? await pipeline.runBatch(applicable, ctx) : null;
        for (const [index, entry] of applicable.entries()) {
            const projectDir = path.join(workDir, entry.projectId);
            let outcome;
            if (batch) {
                outcome = batch.get(entry.projectId)
                    || { failure: { outcome: 'missing', retryable: true, message: 'no result row' } };
            } else {
                outcome = await pipeline.run(entry, ctx, projectDir);
                if (index < applicable.length - 1) await sleep(delayMs);
            }
            const scored = await evaluate(projectDir, outcome.files || []);
            await record({
                pipeline: key,
                projectId: entry.projectId,
                attempted: true,
                ...scored,
                ms: outcome.ms ?? null,
                usedBrowser: pipeline.usesBrowser,
                route: outcome.route || null,
                failure: scored.usefulTor ? null : (outcome.failure || null),
                selfReported: outcome.selfReported || null,
            });
        }
    } finally {
        await pipeline.teardown?.(ctx);
        if (!keepFiles) await rm(workDir, { recursive: true, force: true });
    }
    return summarize(rows, entries.length);
}

async function compareRuns(labels) {
    const byPipeline = {};
    for (const label of labels) {
        for (const key of Object.keys(PIPELINES)) {
            const text = await readFile(path.join(BENCH_DIR, 'results', label, `${key}.jsonl`), 'utf8')
                .catch(() => '');
            for (const line of text.split('\n').filter(Boolean)) {
                const row = JSON.parse(line);
                if (!row.attempted) continue;
                ((byPipeline[key] ||= {})[row.projectId] ||= []).push(Boolean(row.usefulTor));
            }
        }
    }
    const report = {};
    for (const [key, projects] of Object.entries(byPipeline)) {
        const complete = Object.values(projects).filter(runs => runs.length === labels.length);
        const agree = complete.filter(runs => runs.every(value => value === runs[0])).length;
        const everUseful = complete.filter(runs => runs.some(Boolean)).length;
        report[key] = {
            projects: complete.length,
            agreementPct: complete.length ? Math.round((agree / complete.length) * 1000) / 10 : null,
            eventuallyUsefulPct: complete.length ? Math.round((everUseful / complete.length) * 1000) / 10 : null,
        };
    }
    console.table(report);
    await writeFile(path.join(BENCH_DIR, 'results', `compare-${labels.join('-')}.json`), JSON.stringify(report, null, 2));
}

async function main() {
    const args = parseArgs();
    const limit = Number(args.limit) || undefined;

    if (args['discover-depts']) return discoverDepts(args);

    if (args['build-set']) {
        const set = args['build-set'] === 'b' ? await buildSetB(limit || 50, Number(args.seed) || 42) : await buildSetA(limit || 200);
        const file = path.join(BENCH_DIR, `set-${args['build-set']}.json`);
        await writeFile(file, JSON.stringify(set, null, 2));
        console.log(`Wrote ${set.length} projects to ${file}`);
        return;
    }

    if (args.compare) return compareRuns(String(args.compare).split(','));

    const setFile = args.set || path.join(BENCH_DIR, 'set-a.json');
    const entries = (await readJson(setFile, [])).slice(0, limit);
    if (!entries.length) throw new Error(`No projects in ${setFile}`);

    const keys = !args.pipeline || args.pipeline === 'all'
        ? Object.keys(PIPELINES)
        : String(args.pipeline).split(',');
    const label = args['run-label'] || new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.join(BENCH_DIR, 'results', label);
    await mkdir(runDir, { recursive: true });

    const summary = { set: setFile, label, startedAt: new Date().toISOString(), pipelines: {} };
    for (const key of keys) {
        if (!PIPELINES[key]) throw new Error(`Unknown pipeline ${key}`);
        summary.pipelines[key] = await runPipeline(key, entries, {
            runDir,
            delayMs: Number(args.delay) || DEFAULT_DELAY_MS,
            keepFiles: Boolean(args['keep-files']),
        });
        await writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    }
    console.log();
    console.table(Object.fromEntries(Object.entries(summary.pipelines)
        .map(([key, { failures, ...rest }]) => [key, rest])));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
