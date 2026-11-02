#!/usr/bin/env node

/**
 * Generate Vertex AI text embeddings for summarised TORs (FR-2.3.1).
 *
 * Usage:
 *   node scripts/embed-projects.js                      # embed up to 10 pending projects
 *   node scripts/embed-projects.js --limit=100
 *   node scripts/embed-projects.js --project-id=69109166865
 *
 * Needs VERTEX_AI_ENABLED=true and GOOGLE_CLOUD_PROJECT (see .env.example).
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { embedPending, embedProject, embeddingConfig } from '../lib/vertex/embedding.js';

const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
    const [key, value] = arg.slice(2).split('=');
    return [key, value ?? true];
}));

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    if (!embeddingConfig().enabled) throw new Error('Set VERTEX_AI_ENABLED=true to generate embeddings');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const results = args['project-id']
        ? [await embedProject(String(args['project-id']))]
        : await embedPending({ limit: Number(args.limit) || 10 });
    const counts = {};
    for (const result of results) {
        counts[result.status] = (counts[result.status] || 0) + 1;
        if (result.status === 'failed') console.error(`❌ ${result.projectId}: ${result.error}`);
    }
    console.log(`Embeddings: ${results.length} processed ${JSON.stringify(counts)}`);
    await mongoose.disconnect();
    if (counts.failed) process.exitCode = 1;
}

main().catch(async error => {
    console.error(`Embedding run failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
