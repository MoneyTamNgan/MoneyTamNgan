import mongoose from 'mongoose';

const ReviewPageSchema = new mongoose.Schema({
    page_number: { type: Number, required: true, min: 1 },
    codes: [{ type: String }],
}, { _id: false });

const ExtractionRunSchema = new mongoose.Schema({
    project_id: { type: String, required: true, index: true },
    project_ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', index: true },
    document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    run_key: { type: String, required: true, unique: true },
    processor_fingerprint: { type: String, required: true },
    provider: { type: String, default: 'poppler+tesseract' },
    configuration: { type: mongoose.Schema.Types.Mixed, default: {} },
    text_sha256: { type: String, required: true },
    text_storage: { type: String, enum: ['mongodb', 'local', 'gcs'], default: 'mongodb' },
    text_artifact_uri: String,
    page_count: { type: Number, required: true, min: 0 },
    ocr_pages: { type: Number, min: 0, default: 0 },
    needs_review: { type: Boolean, default: false, index: true },
    review_pages: [ReviewPageSchema],
    status: {
        type: String,
        enum: ['running', 'completed', 'review_required', 'failed'],
        default: 'completed',
        index: true,
    },
    started_at: Date,
    completed_at: Date,
    error: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

ExtractionRunSchema.index(
    { document_id: 1, processor_fingerprint: 1, text_sha256: 1 },
    { unique: true, name: 'uniq_document_extraction_result' }
);

export default mongoose.models.ExtractionRun
    || mongoose.model('ExtractionRun', ExtractionRunSchema);
