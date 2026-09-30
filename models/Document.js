import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
    project_id: { type: String, required: true, index: true },
    project_ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    sha256: { type: String, required: true },
    filename: { type: String, required: true },
    entry_name: String,
    document_type: {
        type: String,
        enum: ['tor', 'technical_specification', 'announcement', 'ebidding_terms',
            'pricing', 'contract', 'appendix', 'unknown'],
        default: 'unknown', index: true,
    },
    is_primary: { type: Boolean, default: false, index: true },
    is_current_primary: { type: Boolean, default: false, index: true },
    version: { type: Number, min: 1, default: 1 },
    previous_document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    discovered_at: { type: Date, default: Date.now },
    source_url: String,
    source_type: String,
    official_detail_url: String,
    storage: {
        backend: { type: String, enum: ['remote', 'local', 'gcs'], default: 'remote' },
        local_path: String, gcs_uri: String,
        mime_type: { type: String, default: 'application/pdf' },
        size_bytes: { type: Number, min: 0 },
    },
    archive: {
        filename: String, local_path: String, mime_type: String,
        size_bytes: { type: Number, min: 0 },
    },
    text: {
        storage: { type: String, enum: ['mongodb', 'local', 'gcs'], default: 'mongodb' },
        artifact_uri: String, sha256: String,
        page_count: { type: Number, min: 0 }, processor_fingerprint: String,
    },
    ocr: {
        status: { type: String, enum: ['pending', 'running', 'completed', 'retry_pending', 'failed'], default: 'pending', index: true },
        provider: String,
        pages_processed: { type: Number, min: 0, default: 0 },
        ocr_pages: { type: Number, min: 0, default: 0 },
        needs_review: { type: Boolean, default: false },
        completed_at: Date, error: String,
    },
    processing_status: {
        type: String,
        enum: ['downloaded', 'stored', 'text_ready', 'summarized', 'skipped', 'review_required', 'retry_pending', 'failed'],
        default: 'downloaded', index: true,
    },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

DocumentSchema.index({ project_id: 1, sha256: 1 }, { unique: true });
DocumentSchema.index({ project_id: 1, is_current_primary: 1 }, {
    name: 'uniq_current_primary_document',
    unique: true,
    partialFilterExpression: { is_current_primary: true },
});
// One e-GP ZIP URL can contain several PDFs, so URL alone cannot be unique.
// Archive entry name completes the stable source identity for each PDF.
DocumentSchema.index({ project_id: 1, source_url: 1, entry_name: 1 }, {
    name: 'uniq_document_source_entry',
    unique: true,
    partialFilterExpression: {
        source_url: { $type: 'string' },
        entry_name: { $type: 'string' },
    },
});

export default mongoose.models.Document || mongoose.model('Document', DocumentSchema);
