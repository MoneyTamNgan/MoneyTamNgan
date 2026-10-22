#!/usr/bin/env node

/**
 * Background ingestion scheduler (FR-1.1.1)
 *
 * Usage:
 *   node scripts/ingestion-scheduler.js          # run forever on INGESTION_SCHEDULE
 *   node scripts/ingestion-scheduler.js --once   # run one ingestion now and exit
 *
 * Defaults to 06:00 / 12:00 / 18:00 Asia/Bangkok. The Next.js app must be
 * reachable at INGESTION_APP_URL and PIPELINE_ADMIN_TOKEN must match the app's.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { ingestionScheduleConfig, nextRunAt } from '../lib/ingestion-schedule.js';
import { executeIngestionRun, ingestionRunnerConfig, runIngestionPipeline } from '../lib/ingestion-runner.js';

const once = process.argv.includes('--once');
// Wake periodically instead of one long timer so clock changes/suspends are noticed.
const MAX_SLEEP_MS = 60 * 1000;
let stopping = false;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sleepUntil(date) {
    while (!stopping && Date.now() < date.getTime()) {
        await sleep(Math.min(MAX_SLEEP_MS, date.getTime() - Date.now()));
    }
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    const scheduleConfig = ingestionScheduleConfig();
    const runnerConfig = ingestionRunnerConfig();
    if (runnerConfig.token.length < 32) throw new Error('PIPELINE_ADMIN_TOKEN must be set (at least 32 characters)');

    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const runOptions = {
        maxRetries: scheduleConfig.maxRetries,
        retryBaseMs: scheduleConfig.retryBaseMs,
        pipeline: () => runIngestionPipeline(runnerConfig),
        sleep,
    };

    if (once) {
        const now = new Date();
        const run = await executeIngestionRun({
            ...runOptions, trigger: 'manual', scheduledFor: now,
            nextScheduledAt: nextRunAt(scheduleConfig.schedule, now, scheduleConfig.timeZone),
        });
        // Non-zero exit lets cron/CI callers (e.g. GitHub Actions) surface the failure.
        if (run?.status === 'failed') process.exitCode = 1;
    } else {
        console.log(`🕒 Ingestion scheduler started: "${scheduleConfig.spec}" (${scheduleConfig.timeZone}) → ${runnerConfig.appUrl}`);
        let slot = nextRunAt(scheduleConfig.schedule, new Date(), scheduleConfig.timeZone);
        while (!stopping) {
            console.log(`Next ingestion run at ${slot.toISOString()}`);
            await sleepUntil(slot);
            if (stopping) break;
            const nextSlot = nextRunAt(scheduleConfig.schedule, slot, scheduleConfig.timeZone);
            try {
                await executeIngestionRun({ ...runOptions, scheduledFor: slot, nextScheduledAt: nextSlot });
            } catch (error) {
                // Database hiccups must not kill the scheduler; the next slot still runs.
                console.error(`🚨 [ALERT] Ingestion run for ${slot.toISOString()} crashed: ${error.message}`);
            }
            slot = nextRunAt(scheduleConfig.schedule, new Date(Math.max(Date.now(), nextSlot.getTime() - 1)), scheduleConfig.timeZone);
        }
    }

    await mongoose.disconnect();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        if (stopping) process.exit(1);
        stopping = true;
        console.log(`${signal} received, stopping after the current step`);
    });
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
