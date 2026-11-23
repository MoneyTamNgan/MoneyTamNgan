#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import os from 'node:os';
import { User } from '../models/User.js';
import { changeUserRole } from '../lib/admin-role.js';

async function main() {
    const args = process.argv.slice(2);
    const demote = args.includes('--demote');
    const emailArg = args.find((a) => !a.startsWith('--'));

    if (!emailArg) {
        console.error('Usage: node scripts/promote-admin.js <email> [--demote]');
        process.exit(1);
    }

    const email = emailArg.trim().toLowerCase();
    const targetRole = demote ? 'user' : 'admin';

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is required');
    }

    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);

    const actor = `${os.userInfo().username}@${os.hostname()}`;
    const result = await changeUserRole({
        User,
        email,
        role: targetRole,
        actor,
        record: async (entry) => {
            // One JSON line on the console and one document in the database.
            console.log(JSON.stringify(entry));
            await mongoose.connection.db.collection('role_change_audit').insertOne({ ...entry, at: new Date(entry.at) });
        },
    });

    if (!result.found) {
        console.error(`User with email "${email}" not found.`);
        await mongoose.disconnect();
        process.exit(1);
    }

    if (!result.changed) {
        console.log(`No change: ${result.user.email} already has role "${targetRole}".`);
    } else {
        console.log(`Success: ${result.user.email} (${result.user.name || 'No name'}) changed from "${result.previousRole}" to "${result.user.role}".`);
        console.log('Their current sessions were ended. They must sign in again.');
    }
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Error updating user role:', err);
    process.exit(1);
});
