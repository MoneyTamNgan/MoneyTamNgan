#!/usr/bin/env node

/**
 * Recompute TOR revision lineages for every project (FR-1.3).
 *
 * Ingestion links new projects as they arrive; run this once to backfill
 * existing records, or after changing the matching rules in lib/tor-lineage.js.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { linkAllProjectRevisions } from '../lib/tor-lineage.js';

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const stats = await linkAllProjectRevisions();
    console.log(`Checked ${stats.projects} projects: ${stats.lineages} lineages, `
        + `${stats.superseded} superseded, ${stats.updated} updated`);
    await mongoose.disconnect();
}

main().catch(async error => {
    console.error(`Revision linking failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
