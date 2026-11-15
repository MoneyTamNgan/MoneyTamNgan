import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    active_key: String,
    frequency: { type: String, enum: ['IMMEDIATE', 'DAILY_DIGEST'], required: true },
    delivery_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'NotificationDelivery' }],
    // Freeze the provider payload: retrying an idempotency key must not change HTML or recipient.
    payload: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
    status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'cancelled'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    owner: { type: String, select: false },
    lease_until: Date,
    first_attempt_at: Date,
    next_attempt_at: Date,
    provider_id: String,
    error_code: String,
    sent_at: Date,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
schema.index({ active_key: 1 }, { unique: true, sparse: true, name: 'uniq_active_notification_user' });
schema.index({ frequency: 1, status: 1, next_attempt_at: 1 });
export default mongoose.models.NotificationBatch || mongoose.model('NotificationBatch', schema);
