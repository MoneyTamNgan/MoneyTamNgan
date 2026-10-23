#!/usr/bin/env node
import 'dotenv/config';
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { recoverPendingProjects } from '../lib/processing-recovery.js';

export async function main() {
    const { values } = parseArgs({ options: {
        apply: { type: 'boolean', default: false },
        'batch-size': { type: 'string', default: '10' },
        'scan-limit': { type: 'string', default: '100' },
        'after-id': { type: 'string' },
        'retry-failed': { type: 'boolean', default: false },
    } });
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    try {
        await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
        const report = await recoverPendingProjects({ dryRun: !values.apply,
            batchSize: Number(values['batch-size']), scanLimit: Number(values['scan-limit']),
            afterId: values['after-id'] || null, retryFailed: values['retry-failed'] });
        console.log(JSON.stringify({ database: mongoose.connection.db.databaseName, ...report }, null, 2));
        if (report.failed) process.exitCode = 1;
    } finally { await mongoose.disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
