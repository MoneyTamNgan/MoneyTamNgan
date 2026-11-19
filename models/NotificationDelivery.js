import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    project_id: { type: String, required: true },
    frequency: { type: String, enum: ['IMMEDIATE', 'DAILY_DIGEST'], required: true },
    match: { type: mongoose.Schema.Types.Mixed, required: true },
    score_version: { type: String, required: true },
    status: { type: String, enum: ['pending', 'batched', 'sent', 'failed', 'cancelled'], default: 'pending' },
    batch_id: mongoose.Schema.Types.ObjectId,
    sent_at: Date,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
schema.index({ user_id: 1, project_id: 1 }, { unique: true, name: 'uniq_notification_user_project' });
schema.index({ user_id: 1, status: 1, frequency: 1, created_at: 1 });
export default mongoose.models.NotificationDelivery || mongoose.model('NotificationDelivery', schema);
