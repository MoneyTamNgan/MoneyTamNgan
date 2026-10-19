#!/usr/bin/env node

/**
 * Script to run and send the Daily Digest email notification batch.
 *
 * Usage:
 *   node scripts/send-daily-digest.js
 *
 * Can be scheduled via crontab:
 *   0 9 * * * cd /path/to/MoneyTamNgan && node scripts/send-daily-digest.js >> /var/log/daily-digest.log 2>&1
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { sendDailyDigest } from '../lib/services/notification-service.js';

async function main() {
    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI is required');
    }

    console.log('📬 Connecting to MongoDB...');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);

    console.log('🚀 Running Daily Digest notification batch...');
    const result = await sendDailyDigest();

    console.log(`✅ Daily digest completed: ${result.notified} sent, ${result.skipped} skipped.`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('❌ Error executing daily digest:', err);
    process.exitCode = 1;
});
