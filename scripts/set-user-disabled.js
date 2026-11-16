#!/usr/bin/env node
// Issue #191 (ASVS V7.4.2): disable or re-enable one user account.
// A disabled account cannot sign in, and its live sessions stop working on the
// next request (lib/account-status.js). Dry run by default; pass --apply to write.
//
//   node scripts/set-user-disabled.js --email=person@example.com            # preview
//   node scripts/set-user-disabled.js --email=person@example.com --apply    # disable
//   node scripts/set-user-disabled.js --username=somebody --enable --apply  # re-enable

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { User } from '../models/User.js';
import { normalizeEmail, emailFilter } from '../lib/password-auth.js';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
    const apply = process.argv.includes('--apply');
    const enable = process.argv.includes('--enable');
    const email = arg('email') ? normalizeEmail(arg('email')) : null;
    const username = arg('username')?.trim().toLowerCase();
    if ((!email && !username) || (email && username)) throw new Error('Pass exactly one of --email=<address> or --username=<name>');
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI environment variable is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);

    const user = await User.findOne(email ? emailFilter(email) : { username }, { email: 1, username: 1, role: 1, disabled: 1 }).lean();
    if (!user) throw new Error('No matching user');
    const target = !enable;
    console.log(`${user.email} (${user.username ?? 'no username'}, role ${user.role}): currently ${user.disabled === true ? 'disabled' : 'active'}, will be ${target ? 'disabled' : 'active'}${apply ? '' : ' (dry run, nothing written)'}`);
    if (!apply) { console.log('Re-run with --apply to write.'); await mongoose.disconnect(); return; }
    await User.updateOne({ _id: user._id }, { $set: { disabled: target, disabled_at: target ? new Date() : null, updatedAt: new Date() } });
    console.log(target ? 'Disabled. Its sessions are refused from the next request.' : 'Re-enabled.');
    await mongoose.disconnect();
}

main().catch(error => { console.error(error.message); process.exit(1); });
