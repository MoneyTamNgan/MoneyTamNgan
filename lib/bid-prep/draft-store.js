import mongoose from 'mongoose';
import { User } from '../../models/User.js';
import { BidPrepDraft } from '../../models/BidPrepDraft.js';

// Touch the same user document inside each creation transaction so two concurrent
// counts cannot both reserve the last slot. Mongo retries write conflicts.
export async function createOwnedDraft(userId, data, max) {
    let created;
    await mongoose.connection.transaction(async session => {
        const lock = await User.updateOne({ _id: userId }, { $inc: { bid_prep_revision: 1 } }, { session });
        if (!lock.matchedCount) throw Object.assign(new Error('User not found.'), { status: 404, code: 'USER_NOT_FOUND' });
        const count = await BidPrepDraft.countDocuments({ userId: String(userId) }).session(session);
        if (count >= max) throw Object.assign(new Error('Draft limit reached.'), { status: 400, code: 'DRAFT_LIMIT' });
        [created] = await BidPrepDraft.create([{ ...data, userId: String(userId) }], { session });
    });
    return created;
}
