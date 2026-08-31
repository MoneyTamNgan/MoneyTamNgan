import mongoose from 'mongoose';

const ProcessingJobSchema = new mongoose.Schema({
    type: { type: String, enum: ['process_project'], default: 'process_project', index: true },
    project_id: { type: String, required: true, index: true },
    status: {
        type: String,
        enum: ['queued', 'running', 'completed', 'failed'],
        default: 'queued',
        index: true,
    },
    attempts: { type: Number, default: 0 },
    max_attempts: { type: Number, default: 3 },
    available_at: { type: Date, default: Date.now, index: true },
    lease_until: { type: Date, index: true },
    started_at: { type: Date },
    completed_at: { type: Date },
    result: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

ProcessingJobSchema.index({ status: 1, available_at: 1, created_at: 1 });

export default mongoose.models.ProcessingJob
    || mongoose.model('ProcessingJob', ProcessingJobSchema);
