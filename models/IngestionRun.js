import mongoose from 'mongoose';

/** One automated (or manually started) ingestion run and its retries. */
const IngestionRunSchema = new mongoose.Schema({
    // The schedule slot this run belongs to; unique so two runners never
    // execute the same slot.
    scheduled_for: { type: Date, required: true, unique: true },
    trigger: { type: String, enum: ['schedule', 'manual'], default: 'schedule' },
    status: {
        type: String,
        enum: ['running', 'retry_pending', 'succeeded', 'failed', 'skipped'],
        default: 'running',
        index: true,
    },
    attempts: { type: Number, default: 0 },
    max_retries: { type: Number },
    started_at: { type: Date },
    finished_at: { type: Date },
    next_retry_at: { type: Date },
    // Single-run lock: only one run at a time may hold lock_key (unique index
    // below); lease_until lets a crashed runner's lock be reclaimed.
    lock_key: { type: String },
    lease_until: { type: Date, index: true },
    fetched_count: { type: Number, default: 0 },
    stored_count: { type: Number, default: 0 },
    scraped_count: { type: Number, default: 0 },
    pdf_paths: [{ type: String }],
    summary: { type: mongoose.Schema.Types.Mixed },
    last_error: {
        message: { type: String },
        status: { type: Number },
        transient: { type: Boolean },
        at: { type: Date },
    },
    failure_reason: { type: String },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
});

IngestionRunSchema.index({ started_at: -1 });
IngestionRunSchema.index({ lock_key: 1 }, {
    name: 'uniq_active_ingestion_run',
    unique: true,
    partialFilterExpression: { lock_key: { $type: 'string' } },
});

export default mongoose.models.IngestionRun
    || mongoose.model('IngestionRun', IngestionRunSchema);
