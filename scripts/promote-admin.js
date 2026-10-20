#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { User } from '../models/User.js';

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

    const user = await User.findOneAndUpdate(
        { email },
        { $set: { role: targetRole, updatedAt: new Date() } },
        { new: true }
    );

    if (!user) {
        console.error(`User with email "${email}" not found.`);
        await mongoose.disconnect();
        process.exit(1);
    }

    console.log(`Success: Updated ${user.email} (${user.name || 'No name'}) role to "${user.role}".`);
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Error updating user role:', err);
    process.exit(1);
});
