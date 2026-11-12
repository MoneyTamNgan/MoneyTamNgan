import mongoose from 'mongoose';

// The singleton _id is MongoDB's cross-process concurrency boundary. No TTL
// index: an expired lease must retain a visible failed status for operators.
const schema = new mongoose.Schema({
    _id: { type: String },
    owner: { type: String, select: false },
    lease_until: { type: Date },
    run: { type: mongoose.Schema.Types.Mixed, required: true },
}, { versionKey: false });

export default mongoose.models.AdminPipelineState || mongoose.model('AdminPipelineState', schema);
