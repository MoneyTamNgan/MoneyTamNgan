import mongoose from 'mongoose';
const schema = new mongoose.Schema({
    attempt_key: { type: String, required: true },
    project_id: { type: String, required: true, maxlength: 64 },
    run_id: { type: String, maxlength: 100, default: null },
    source: { type: String, enum: ['admin', 'worker', 'benchmark'], required: true },
    status: { type: String, enum: ['success', 'failed', 'skipped'], required: true },
    reason_code: { type: String, maxlength: 64, default: null },
    route: { type: String, enum: ['feed', 'browser', 'known', 'cached', null], default: null },
    duration_ms: { type: Number, min: 0, required: true },
    started_at: { type: Date, required: true },
    completed_at: { type: Date, required: true },
}, { versionKey: false });
schema.index({ attempt_key: 1 }, { unique: true, name: 'uniq_acquisition_attempt' });
schema.index({ completed_at: -1 });
schema.index({ source: 1, completed_at: -1 });
// Operational telemetry only. This TTL never removes documents/OCR/summaries.
schema.index({ completed_at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
export default mongoose.models.AcquisitionAttempt || mongoose.model('AcquisitionAttempt', schema);
