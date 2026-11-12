#!/usr/bin/env node
// Issue #108: backfill `username` on existing users and create its unique index.
// Dry run by default; pass --apply to write. Safe to re-run: it only touches
// users that still have no username and never changes an existing one.

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { User } from '../models/User.js';
import { planUsernameBackfill } from '../lib/username.js';

async function main() {
    const apply = process.argv.includes('--apply');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);

    // Only these fields are read; password hashes are never loaded.
    const users = await User.find({}, { email: 1, username: 1 }).sort({ _id: 1 }).lean();
    const plan = planUsernameBackfill(users);
    console.log(`${users.length} users, ${plan.length} need a username${apply ? '' : ' (dry run, nothing written)'}.`);

    if (!apply) {
        for (const { id, username } of plan.slice(0, 20)) console.log(`  ${String(id)} -> ${username}`);
        if (plan.length > 20) console.log(`  ... and ${plan.length - 20} more`);
        console.log('Re-run with --apply to write these changes.');
        await mongoose.disconnect();
        return;
    }

    if (plan.length) {
        const result = await User.collection.bulkWrite(plan.map(({ id, username }) => ({
            updateOne: {
                // The filter keeps this idempotent and race-safe against new sign-ups.
                filter: { _id: id, $or: [{ username: { $exists: false } }, { username: null }, { username: '' }] },
                update: { $set: { username, updatedAt: new Date() } },
            },
        })), { ordered: false });
        console.log(`Updated ${result.modifiedCount} users.`);
    }
    await User.createIndexes();
    console.log('Ensured indexes for users (uniq_user_username).');
    await mongoose.disconnect();
}

main().catch(async error => {
    console.error(`User migration failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
