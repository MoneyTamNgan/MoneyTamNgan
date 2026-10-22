/**
 * Automated ingestion runner (FR-1.1.1).
 *
 * Each run calls the app's own pipeline endpoints with the
 * PIPELINE_ADMIN_TOKEN bearer token: first metadata ingestion, then TOR
 * scraping for projects that still lack a stored document. Run state lives in
 * the IngestionRun collection so /api/ingestion/status can report it.
 */

import IngestionRun from '../models/IngestionRun.js';
import { runWithRetries } from './ingestion-schedule.js';

export const INGESTION_LOCK_KEY = 'ingestion';
const LEASE_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

function configError(message) {
    return Object.assign(new Error(message), { retryable: false });
}

export function ingestionRunnerConfig(env = process.env) {
    return {
        appUrl: (env.INGESTION_APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
        token: env.PIPELINE_ADMIN_TOKEN || '',
        timeoutMs: Number(env.INGESTION_REQUEST_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS),
        ingestLimit: env.INGESTION_LIMIT ? Number(env.INGESTION_LIMIT) : undefined,
        enqueueProcessing: env.INGESTION_ENQUEUE_PROCESSING !== 'false',
        scrapeBatchSize: Number(env.INGESTION_SCRAPE_BATCH_SIZE ?? 10),
    };
}

/** POST to a pipeline endpoint, turning failures into errors tagged with status/retryable. */
export async function callPipelineEndpoint(path, body, { appUrl, token, timeoutMs, fetchImpl = fetch }) {
    const response = await fetchImpl(`${appUrl}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await response.json().catch(() => null);
    if (response.ok) return json ?? {};

    const message = json?.error?.message || response.statusText || 'Request failed';
    const error = new Error(`${path} returned HTTP ${response.status}: ${message}`);
    error.status = response.status;
    if (typeof json?.error?.retryable === 'boolean') error.retryable = json.error.retryable;
    // A rejected token or bad request will not fix itself on retry.
    if ([400, 401, 403, 404].includes(response.status)) error.retryable = false;
    throw error;
}

export function extractPdfPaths(scrapeResponse) {
    const paths = (scrapeResponse?.results || []).flatMap(result => [
        result.pdf_path,
        ...(result.extracted_pdfs || []).map(item => (typeof item === 'string' ? item : item?.path)),
    ]);
    return [...new Set(paths.filter(Boolean))];
}

/** One attempt: ingest metadata, then scrape TOR PDFs for the new projects. */
export async function runIngestionPipeline(config, { fetchImpl = fetch } = {}) {
    if (config.token.length < 32) throw configError('PIPELINE_ADMIN_TOKEN must be set (at least 32 characters)');
    const options = { ...config, fetchImpl };

    const ingestion = await callPipelineEndpoint('/api/ingestion/trigger', {
        enqueueProcessing: config.enqueueProcessing,
        ...(config.ingestLimit ? { limit: config.ingestLimit } : {}),
    }, options);

    const scraping = config.scrapeBatchSize > 0
        ? await callPipelineEndpoint('/api/scraping/trigger', { batchSize: config.scrapeBatchSize, onlyMissing: true }, options)
        : null;

    return {
        fetched_count: ingestion.itemsFound ?? 0,
        stored_count: (ingestion.itemsNew ?? 0) + (ingestion.itemsUpdated ?? 0) + (ingestion.candidatesSaved ?? 0),
        scraped_count: scraping?.summary?.dbUpdated ?? 0,
        pdf_paths: extractPdfPaths(scraping),
        summary: {
            ingestion: {
                itemsFound: ingestion.itemsFound, itemsNew: ingestion.itemsNew, itemsUpdated: ingestion.itemsUpdated,
                itemsFailed: ingestion.itemsFailed, candidatesSaved: ingestion.candidatesSaved,
                jobsQueued: ingestion.jobsQueued, skipped: ingestion.skipped,
            },
            scraping: scraping ? { summary: scraping.summary, message: scraping.message } : null,
        },
    };
}

function errorRecord(error, transient) {
    return { message: error.message, status: error.status, transient, at: new Date() };
}

/** Claim the slot and the single-run lock; returns null if this slot was already handled. */
async function claimRun({ scheduledFor, trigger, maxRetries }) {
    const now = new Date();
    // A runner that crashed mid-run leaves its lock behind; reclaim it once its lease lapses.
    await IngestionRun.updateMany({ lock_key: INGESTION_LOCK_KEY, lease_until: { $lt: now } }, {
        $set: { status: 'failed', failure_reason: 'lease_expired', finished_at: now },
        $unset: { lock_key: 1, next_retry_at: 1 },
    });
    try {
        return await IngestionRun.create({
            scheduled_for: scheduledFor, trigger, max_retries: maxRetries, status: 'running',
            started_at: now, lock_key: INGESTION_LOCK_KEY, lease_until: new Date(now.getTime() + LEASE_MS),
        });
    } catch (error) {
        if (error?.code !== 11000) throw error;
        if (!error.keyPattern?.lock_key) return null;
    }
    // Another run (e.g. still retrying) holds the lock: record the skip and move on.
    try {
        await IngestionRun.create({
            scheduled_for: scheduledFor, trigger, status: 'skipped', started_at: now, finished_at: now,
            failure_reason: 'previous_run_active',
        });
    } catch (error) {
        if (error?.code !== 11000) throw error;
    }
    return null;
}

/**
 * Execute one scheduled slot with retries. Never throws for pipeline
 * failures, so the scheduler loop always continues to the next slot.
 */
export async function executeIngestionRun({
    scheduledFor, nextScheduledAt, trigger = 'schedule',
    maxRetries, retryBaseMs, pipeline, sleep, logger = console,
}) {
    const run = await claimRun({ scheduledFor, trigger, maxRetries });
    if (!run) {
        logger.warn(`Ingestion slot ${scheduledFor.toISOString()} skipped (already handled or another run is active)`);
        return null;
    }

    const heartbeat = setInterval(() => {
        IngestionRun.updateOne({ _id: run._id, lock_key: INGESTION_LOCK_KEY }, {
            $set: { lease_until: new Date(Date.now() + LEASE_MS) },
        }).catch(error => logger.error(`Ingestion lease renewal failed: ${error.message}`));
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
        const outcome = await runWithRetries(async attemptNumber => {
            await IngestionRun.updateOne({ _id: run._id }, {
                $set: { attempts: attemptNumber, status: 'running' }, $unset: { next_retry_at: 1 },
            });
            logger.log(`📡 Ingestion run ${run._id} attempt ${attemptNumber}`);
            return pipeline();
        }, {
            maxRetries, retryBaseMs, nextScheduledAt, sleep,
            onRetryScheduled: async ({ attemptNumber, error, retryAt }) => {
                logger.warn(`⚠️ Ingestion attempt ${attemptNumber} failed (${error.message}); retrying at ${retryAt.toISOString()}`);
                await IngestionRun.updateOne({ _id: run._id }, { $set: {
                    status: 'retry_pending', next_retry_at: retryAt, last_error: errorRecord(error, true),
                } });
            },
        });

        const finishedAt = new Date();
        if (outcome.ok) {
            await IngestionRun.updateOne({ _id: run._id }, {
                $set: { ...outcome.result, status: 'succeeded', attempts: outcome.attempts, finished_at: finishedAt },
                $unset: { lock_key: 1, next_retry_at: 1 },
            });
            logger.log(`✅ Ingestion run ${run._id} succeeded: fetched ${outcome.result.fetched_count}, stored ${outcome.result.stored_count}, scraped ${outcome.result.scraped_count}`);
        } else {
            await IngestionRun.updateOne({ _id: run._id }, {
                $set: {
                    status: 'failed', attempts: outcome.attempts, finished_at: finishedAt,
                    failure_reason: outcome.reason, last_error: errorRecord(outcome.error, outcome.transient),
                },
                $unset: { lock_key: 1, next_retry_at: 1 },
            });
            logger.error(`🚨 [ALERT] Ingestion run ${run._id} failed after ${outcome.attempts} attempt(s) (${outcome.reason}): ${outcome.error.message}`);
        }
        return IngestionRun.findById(run._id).lean();
    } finally {
        clearInterval(heartbeat);
    }
}
