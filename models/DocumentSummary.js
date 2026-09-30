import mongoose from 'mongoose';

const DocumentSummarySchema = new mongoose.Schema({
    project_id: { type: String, required: true, index: true },
    document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    extraction_run_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractionRun', index: true },
    document_sha256: { type: String, required: true },
    text_sha256: { type: String, required: true },
    model: { type: String, required: true }, model_version: String,
    prompt_version: { type: String, required: true },
    extraction: { type: mongoose.Schema.Types.Mixed, required: true },
    usage: {
        input_tokens: { type: Number, min: 0, default: 0 },
        output_tokens: { type: Number, min: 0, default: 0 },
    },
    confidence: { type: Number, min: 0, max: 1 },
    needs_review: { type: Boolean, default: false, index: true },
    processed_at: { type: Date, default: Date.now },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

DocumentSummarySchema.index({ document_id: 1, text_sha256: 1, model: 1, prompt_version: 1 }, { unique: true });
DocumentSummarySchema.index(
    { extraction_run_id: 1, model: 1, model_version: 1, prompt_version: 1 },
    {
        unique: true,
        name: 'uniq_extraction_model_prompt',
        partialFilterExpression: { extraction_run_id: { $type: 'objectId' } },
    }
);

export default mongoose.models.DocumentSummary || mongoose.model('DocumentSummary', DocumentSummarySchema);
