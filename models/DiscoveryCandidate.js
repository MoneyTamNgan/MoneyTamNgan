import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    project_id: { type: String, required: true, unique: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    classification: mongoose.Schema.Types.Mixed,
    eligibility: mongoose.Schema.Types.Mixed,
    status: { type: String, enum: ['pending', 'review_required', 'closed', 'not_yet_open', 'promoted'], default: 'pending', index: true },
    error: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });
export default mongoose.models.DiscoveryCandidate || mongoose.model('DiscoveryCandidate', schema);
