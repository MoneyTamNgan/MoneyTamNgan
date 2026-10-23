import mongoose from 'mongoose';

const snapshot = {
    is_software: { type: Boolean, default: null },
    classification_status: { type: String },
    tags: [{ type: String }],
    processing_status: { type: String },
    document_status: { type: String },
};

/** Audit log of admin classification / document status overrides (FR-1.2.2, FR-1.2.3). */
const ClassificationOverrideSchema = new mongoose.Schema({
    project_id: { type: String, required: true, index: true },
    // A published project, or a discovery candidate still awaiting verification.
    target: { type: String, enum: ['project', 'candidate'], required: true },
    reviewer: {
        user_id: { type: String },
        email: { type: String },
        via: { type: String, enum: ['admin_session', 'pipeline_token'], required: true },
    },
    reason: { type: String },
    before: snapshot,
    after: snapshot,
}, {
    timestamps: { createdAt: 'created_at', updatedAt: false },
});

ClassificationOverrideSchema.index({ project_id: 1, created_at: -1 });

export default mongoose.models.ClassificationOverride
    || mongoose.model('ClassificationOverride', ClassificationOverrideSchema);
