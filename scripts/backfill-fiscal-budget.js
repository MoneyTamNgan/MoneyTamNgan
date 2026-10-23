#!/usr/bin/env node
import 'dotenv/config';
import mongoose from 'mongoose';
import { parseArgs } from 'node:util';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { backfillFiscalBudgets } from '../lib/fiscal-backfill.js';

try {
    const { values } = parseArgs({ options: {
        apply: { type: 'boolean', default: false },
        llm: { type: 'boolean', default: false },
        'download-open': { type: 'boolean', default: false },
        'include-missing': { type: 'boolean', default: false },
        'batch-size': { type: 'string', default: '5' },
        'scan-limit': { type: 'string', default: '100' },
        'after-id': { type: 'string' },
        'max-llm-calls': { type: 'string', default: '2' },
        'max-downloads': { type: 'string', default: '1' },
    } });
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    const result = await backfillFiscalBudgets({ dryRun: !values.apply, allowLlm: values.llm,
        downloadOpen: values['download-open'], onlyStoredText: !values['include-missing'],
        batchSize: Number(values['batch-size']), scanLimit: Number(values['scan-limit']),
        afterId: values['after-id'] || null, maxLlmCalls: Number(values['max-llm-calls']),
        maxDownloads: Number(values['max-downloads']) });
    console.log(JSON.stringify({ database: mongoose.connection.db.databaseName, ...result }, null, 2));
    if (result.errors.length) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
