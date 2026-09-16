import mongoose from 'mongoose';

const WarningSchema = new mongoose.Schema({
    code: { type: String, required: true }, message: String, psm: Number,
}, { _id: false, strict: false });

const DocumentPageSchema = new mongoose.Schema({
    project_id: { type: String, required: true, index: true },
    document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    page_number: { type: Number, required: true, min: 1 },
    text: { type: String, required: true, default: '' },
    text_sha256: { type: String, required: true },
    extraction_method: { type: String, enum: ['embedded', 'ocr'], required: true },
    confidence: { type: Number, min: 0, max: 1, default: null },
    render_dpi: Number, ocr_psm: Number,
    warnings: [WarningSchema],
    needs_review: { type: Boolean, default: false, index: true },
    processor_fingerprint: { type: String, required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

DocumentPageSchema.index({ document_id: 1, page_number: 1 }, { unique: true });

export default mongoose.models.DocumentPage || mongoose.model('DocumentPage', DocumentPageSchema);
