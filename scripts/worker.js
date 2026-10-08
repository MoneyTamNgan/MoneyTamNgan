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
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';

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
        await completeJob(job._id, result);
        console.log(`✅ ${job.project_id}: ${result.status}`);
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

    do {
        const processed = await runOne();
        if (watch && !processed) await sleep(pollMs);
    } while (watch);

    await mongoose.disconnect();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
