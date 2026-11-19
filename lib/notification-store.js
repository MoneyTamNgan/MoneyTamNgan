import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import Delivery from '../models/NotificationDelivery.js';
import Batch from '../models/NotificationBatch.js';

export const MAX_NOTIFICATION_ATTEMPTS = 3;
export const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;

export const notificationStore = {
    async enqueue(user, project, match, scoreVersion) {
        try {
            const result = await Delivery.updateOne({ user_id: user._id, project_id: project.project_id }, {
                $setOnInsert: { frequency: user.notification_frequency || 'IMMEDIATE', match,
                    score_version: scoreVersion, status: 'pending' },
            }, { upsert: true });
            return result.upsertedCount === 1;
        } catch (error) { if (error.code === 11000) return false; throw error; }
    },
    async prepare(user, frequency, buildPayload, existingOnly = false) {
        const active_key = `match:${user._id}`;
        const existing = await Batch.findOne({ active_key }).select('+payload').lean();
        if (existing) return existing;
        if (existingOnly) return null;
        let batch = null;
        try {
            await mongoose.connection.transaction(async session => {
                const rows = await Delivery.find({ user_id: user._id, status: 'pending' })
                    .sort({ created_at: 1, _id: 1 }).limit(15).session(session).lean();
                if (!rows.length) return;
                const matches = rows.map(row => row.match).sort((a, b) => b.matchScore - a.matchScore);
                [batch] = await Batch.create([{ user_id: user._id, active_key, frequency,
                    delivery_ids: rows.map(row => row._id), payload: buildPayload(matches), status: 'pending' }], { session });
                await Delivery.updateMany({ _id: { $in: batch.delivery_ids }, status: 'pending' }, {
                    $set: { status: 'batched', batch_id: batch._id },
                }, { session });
                batch = batch.toObject();
            });
        } catch (error) {
            if (error.code !== 11000) throw error;
            batch = await Batch.findOne({ active_key }).select('+payload').lean();
        }
        return batch;
    },
    async claim(batch, now) {
        const owner = randomUUID();
        return Batch.findOneAndUpdate({ _id: batch._id, status: { $in: ['pending', 'sending'] },
            $and: [
                { $or: [{ lease_until: { $lte: now } }, { lease_until: null }] },
                { $or: [{ next_attempt_at: { $lte: now } }, { next_attempt_at: null }] },
            ],
        }, { $set: { status: 'sending', owner, lease_until: new Date(now.getTime() + LEASE_MS),
            first_attempt_at: batch.first_attempt_at || now }, $inc: { attempts: 1 } },
        { returnDocument: 'after' }).select('+payload +owner').lean();
    },
    async settle(batch, { status, providerId, errorCode }, now) {
        let changed = false;
        await mongoose.connection.transaction(async session => {
            const terminal = status !== 'pending';
            const update = { $set: { status, provider_id: providerId, error_code: errorCode,
                ...(status === 'sent' ? { sent_at: now } : {}),
                ...(status === 'pending' ? { next_attempt_at: new Date(now.getTime() + 60_000 * batch.attempts) } : {}),
            }, $unset: { owner: '', lease_until: '', ...(terminal ? { active_key: '' } : {}) } };
            const result = await Batch.updateOne({ _id: batch._id, owner: batch.owner, status: 'sending',
                lease_until: { $gt: now } }, update, { session });
            changed = result.modifiedCount === 1;
            if (changed && terminal) await Delivery.updateMany({ batch_id: batch._id }, {
                $set: { status, ...(status === 'sent' ? { sent_at: now } : {}) },
            }, { session });
        });
        return changed;
    },
};
