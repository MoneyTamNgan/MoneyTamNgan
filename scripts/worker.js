#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import {
    claimNextJob,
    completeJob,
    failJob,
    requeueExpiredJobs,
} from '../lib/job-queue.js';
import { processProject } from '../lib/processing-pipeline.js';
import Project from '../models/Project.js';
import DiscoveryCandidate from '../models/DiscoveryCandidate.js';
import { verifyDiscoveryCandidate } from '../lib/discovery-candidates.js';
import { notifyUsersOfMatchingTors } from '../lib/services/notification-service.js';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { createRecoverySweep } from '../lib/processing-recovery.js';
import { refreshProjectFiscalBudget } from '../lib/fiscal-backfill.js';

const watch = process.argv.includes('--watch');
const pollMs = Math.max(1000, Number(process.env.WORKER_POLL_MS || 5000));

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runOne() {
    await requeueExpiredJobs();
    const job = await claimNextJob();
    if (!job) return false;

    console.log(`⚙️  Processing job ${job._id} for project ${job.project_id}`);
    // OCR can take longer than the initial ten-minute lease.
    const heartbeat = setInterval(() => {
        job.constructor.updateOne({ _id: job._id, status: 'running' }, {
            $set: { lease_until: new Date(Date.now() + 10 * 60 * 1000) },
        }).catch(error => console.error(`Lease renewal failed: ${error.message}`));
    }, 30000);
    try {
        const result = job.type === 'verify_candidate' ? await verifyDiscoveryCandidate(job.project_id) : await processProject(job.project_id, { onProgress: progress => {
            console.log(`Vertex ${progress.stage}: ${progress.chunk || progress.attempt}/${progress.total || 'retry'}`);
        } });
        if (result.retryable) throw new Error(result.eligibility?.reason || 'Verification unavailable');
        if (job.type !== 'verify_candidate') {
            const fiscal = await refreshProjectFiscalBudget(job.project_id);
            result.fiscalBudgetStatus = fiscal.status;
        }
        await completeJob(job._id, result);
        console.log(`✅ ${job.project_id}: ${result.status}`);

        // Immediate email notifications for users whose skills match this newly completed project
        if (job.type !== 'verify_candidate' && result.status === 'completed') {
            try {
                const freshProject = await Project.findOne({ project_id: job.project_id }).lean();
                if (freshProject) {
                    const notifyRes = await notifyUsersOfMatchingTors([freshProject]);
                    if (notifyRes.notified > 0) {
                        console.log(`📧 Notified ${notifyRes.notified} users with matching score for ${job.project_id}`);
                    }
                }
            } catch (notifyErr) {
                console.error(`⚠️ Notification warning for ${job.project_id}: ${notifyErr.message}`);
            }
        }
    } catch (error) {
        const { finalFailure } = await failJob(job, error);
        if (job.type === 'verify_candidate') {
            await DiscoveryCandidate.updateOne({ project_id: job.project_id }, { $set: {
                status: finalFailure ? 'review_required' : 'pending', error: error.message,
            } });
        } else {
            await Project.updateOne({ project_id: job.project_id }, {
                $set: { 'processing.status': finalFailure ? 'failed' : 'retry_pending', 'processing.error': error.message,
                    'workflow.status': finalFailure ? 'failed' : 'retry_pending', 'workflow.error': error.message },
            });
        }
        console.error(`❌ ${job.project_id}: ${error.message}`);
    } finally {
        clearInterval(heartbeat);
    }
    return true;
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    console.log(`Worker started (${watch ? 'watch' : 'once'} mode)`);
    const recover = watch && process.env.WORKER_RECOVERY_ENABLED !== 'false'
        ? createRecoverySweep({
            intervalMs: Math.max(1000, Number(process.env.WORKER_RECOVERY_INTERVAL_MS || 60000)),
            batchSize: Number(process.env.WORKER_RECOVERY_BATCH_SIZE || 10),
            scanLimit: Number(process.env.WORKER_RECOVERY_SCAN_LIMIT || 100),
        }) : null;

    do {
        const processed = await runOne();
        if (watch && !processed) {
            let queued = 0;
            if (recover) {
                try {
                    const report = await recover();
                    if (report) {
                        queued = report.queued;
                        console.log(`Recovery: ${report.scanned} scanned, ${report.queued} queued, ${report.failed} errors; skipped ${JSON.stringify(report.skipped)}`);
                    }
                } catch (error) { console.error(`Recovery deferred: ${error.message}`); }
            }
            if (!queued) await sleep(pollMs);
        }
    } while (watch);

    await mongoose.disconnect();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
