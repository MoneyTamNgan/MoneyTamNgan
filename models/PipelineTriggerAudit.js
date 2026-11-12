import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    request_id: { type: String, required: true, unique: true },
    run_id: { type: String },
    at: { type: Date, required: true, default: Date.now, index: true },
    actor_id: { type: String, required: true },
    actor_role: { type: String, required: true },
    ip: { type: String, required: true, maxlength: 100 },
    outcome: { type: String, required: true },
    http_status: { type: Number, required: true },
}, { versionKey: false });

export default mongoose.models.PipelineTriggerAudit || mongoose.model('PipelineTriggerAudit', schema);
