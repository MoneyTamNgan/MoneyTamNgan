import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isTransientError,
    nextRunAt,
    parseSchedule,
    retryDelayMs,
    runWithRetries,
} from '../../lib/ingestion-schedule.js';
import { extractPdfPaths, runIngestionPipeline } from '../../lib/ingestion-runner.js';

const MINUTE = 60 * 1000;
const TOKEN = 'x'.repeat(32);
const defaultSchedule = parseSchedule('06:00,12:00,18:00');

test('default schedule runs at 06:00, 12:00 and 18:00 Asia/Bangkok', () => {
    // 05:30 Bangkok = 22:30 UTC the previous day.
    const runs = [];
    let after = new Date('2026-10-21T22:30:00Z');
    for (let i = 0; i < 4; i++) runs.push((after = nextRunAt(defaultSchedule, after, 'Asia/Bangkok')).toISOString());
    assert.deepEqual(runs, [
        '2026-10-21T23:00:00.000Z', '2026-10-22T05:00:00.000Z',
        '2026-10-22T11:00:00.000Z', '2026-10-22T23:00:00.000Z',
    ]);
});

test('nextRunAt is strictly after the given instant', () => {
    const slot = new Date('2026-10-22T05:00:00Z');
    assert.equal(nextRunAt(defaultSchedule, slot, 'Asia/Bangkok').toISOString(), '2026-10-22T11:00:00.000Z');
});

test('interval schedules align to local midnight', () => {
    const hourly = parseSchedule('every:1h');
    assert.equal(nextRunAt(hourly, new Date('2026-10-22T05:10:00Z'), 'Asia/Bangkok').toISOString(), '2026-10-22T06:00:00.000Z');
    const sixHourly = parseSchedule('every:6h');
    // 13:00 Bangkok → next slot 18:00 Bangkok.
    assert.equal(nextRunAt(sixHourly, new Date('2026-10-22T06:00:00Z'), 'Asia/Bangkok').toISOString(), '2026-10-22T11:00:00.000Z');
});

test('parseSchedule rejects malformed specs', () => {
    assert.throws(() => parseSchedule('25:00'), RangeError);
    assert.throws(() => parseSchedule('every:1m'), RangeError);
    assert.throws(() => parseSchedule(''), RangeError);
});

test('retry delays back off ~5, ~15, ~45 minutes with bounded jitter', () => {
    assert.deepEqual([1, 2, 3].map(n => retryDelayMs(n, { random: () => 0.5 })), [5 * MINUTE, 15 * MINUTE, 45 * MINUTE]);
    assert.equal(retryDelayMs(1, { random: () => 0 }), 4 * MINUTE);
    assert.equal(retryDelayMs(1, { random: () => 1 }), 6 * MINUTE);
});

test('only network errors, timeouts and 5xx/429 are transient', () => {
    assert.equal(isTransientError(Object.assign(new Error('x'), { status: 503 })), true);
    assert.equal(isTransientError(Object.assign(new Error('x'), { status: 429 })), true);
    assert.equal(isTransientError(Object.assign(new Error('x'), { status: 401 })), false);
    assert.equal(isTransientError(Object.assign(new Error('x'), { status: 503, retryable: false })), false);
    assert.equal(isTransientError(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), true);
    assert.equal(isTransientError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })), true);
    assert.equal(isTransientError(new Error('Please define the EGP_API_KEY environment variable')), false);
});

function retryHarness({ start = new Date('2026-10-22T05:00:00Z'), nextScheduledAt = new Date('2026-10-22T11:00:00Z') } = {}) {
    let clock = start.getTime();
    const sleeps = [];
    return {
        sleeps,
        options: {
            nextScheduledAt, random: () => 0.5,
            now: () => new Date(clock),
            sleep: async ms => { sleeps.push(ms); clock += ms; },
        },
    };
}

test('transient failures retry up to 3 times, then fail', async () => {
    const { sleeps, options } = retryHarness();
    let calls = 0;
    const outcome = await runWithRetries(async () => {
        calls++;
        throw Object.assign(new Error('e-GP down'), { status: 503 });
    }, options);
    assert.equal(calls, 4);
    assert.deepEqual(sleeps, [5 * MINUTE, 15 * MINUTE, 45 * MINUTE]);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'retries_exhausted');
});

test('a retry that succeeds ends the run successfully', async () => {
    const { options } = retryHarness();
    let calls = 0;
    const outcome = await runWithRetries(async () => {
        if (++calls === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        return { stored_count: 2 };
    }, options);
    assert.deepEqual(outcome, { ok: true, attempts: 2, result: { stored_count: 2 } });
});

test('permanent errors fail fast without retrying', async () => {
    const { sleeps, options } = retryHarness();
    const outcome = await runWithRetries(async () => {
        throw Object.assign(new Error('bad token'), { status: 401 });
    }, options);
    assert.equal(outcome.attempts, 1);
    assert.equal(outcome.reason, 'permanent_error');
    assert.deepEqual(sleeps, []);
});

test('retries are skipped when they would overlap the next scheduled run', async () => {
    // 20 minutes before the next slot: the 5-minute retry fits, the 15-minute one does not.
    const { sleeps, options } = retryHarness({
        start: new Date('2026-10-22T10:40:00Z'), nextScheduledAt: new Date('2026-10-22T11:00:00Z'),
    });
    const outcome = await runWithRetries(async () => {
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    }, options);
    assert.deepEqual(sleeps, [5 * MINUTE]);
    assert.equal(outcome.attempts, 2);
    assert.equal(outcome.reason, 'overlaps_next_run');
});

function fakeFetch(responses) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        const { status = 200, json } = responses[new URL(url).pathname];
        return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
    };
    return { calls, fetchImpl };
}

const runnerConfig = {
    appUrl: 'http://app:3000', token: TOKEN, timeoutMs: 1000,
    enqueueProcessing: true, scrapeBatchSize: 5,
};

test('pipeline authenticates with the bearer token and passes scraped PDF paths through', async () => {
    const { calls, fetchImpl } = fakeFetch({
        '/api/ingestion/trigger': { status: 202, json: { itemsFound: 7, itemsNew: 2, itemsUpdated: 1, candidatesSaved: 3 } },
        '/api/scraping/trigger': { json: {
            summary: { dbUpdated: 1 },
            results: [{ pdf_path: 'storage/tor/a.pdf', extracted_pdfs: ['storage/tor/a/1.pdf', { path: 'storage/tor/a/2.pdf' }] }, { pdf_path: null }],
        } },
    });
    const result = await runIngestionPipeline(runnerConfig, { fetchImpl });
    assert.deepEqual(calls.map(call => call.url), ['http://app:3000/api/ingestion/trigger', 'http://app:3000/api/scraping/trigger']);
    assert.ok(calls.every(call => call.init.headers.Authorization === `Bearer ${TOKEN}`));
    assert.deepEqual(calls[0].body, { enqueueProcessing: true });
    assert.deepEqual(calls[1].body, { batchSize: 5, onlyMissing: true });
    assert.equal(result.fetched_count, 7);
    assert.equal(result.stored_count, 6);
    assert.equal(result.scraped_count, 1);
    assert.deepEqual(result.pdf_paths, ['storage/tor/a.pdf', 'storage/tor/a/1.pdf', 'storage/tor/a/2.pdf']);
});

test('pipeline maps endpoint failures to transient or permanent errors', async () => {
    const upstream = fakeFetch({ '/api/ingestion/trigger': { status: 503, json: { error: { message: 'e-GP 503', retryable: true } } } });
    await assert.rejects(runIngestionPipeline(runnerConfig, upstream), error => error.status === 503 && isTransientError(error));

    const config = fakeFetch({ '/api/ingestion/trigger': { status: 500, json: { error: { message: 'no API key', retryable: false } } } });
    await assert.rejects(runIngestionPipeline(runnerConfig, config), error => !isTransientError(error));

    const auth = fakeFetch({ '/api/ingestion/trigger': { status: 401, json: { error: { message: 'Admin authentication required' } } } });
    await assert.rejects(runIngestionPipeline(runnerConfig, auth), error => !isTransientError(error));
});

test('pipeline refuses to run without a valid token', async () => {
    const { calls, fetchImpl } = fakeFetch({});
    await assert.rejects(runIngestionPipeline({ ...runnerConfig, token: 'short' }, { fetchImpl }), error => error.retryable === false);
    assert.equal(calls.length, 0);
});

test('extractPdfPaths tolerates a skipped scrape step', () => {
    assert.deepEqual(extractPdfPaths(null), []);
});
