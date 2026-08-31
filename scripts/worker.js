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
    try {
        const result = await processProject(job.project_id);
        await completeJob(job._id, result);
        console.log(`✅ ${job.project_id}: ${result.status}`);
    } catch (error) {
        const { finalFailure } = await failJob(job, error);
        if (finalFailure) {
            await Project.updateOne({ project_id: job.project_id }, {
                $set: { 'processing.status': 'failed', 'processing.error': error.message },
            });
        }
        console.error(`❌ ${job.project_id}: ${error.message}`);
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
