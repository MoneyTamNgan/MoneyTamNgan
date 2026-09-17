import mongoose from 'mongoose';

const ProjectSchema = new mongoose.Schema({
    project_id: { type: String, required: true, unique: true, index: true },
    project_name: { type: String, required: true },
    dept_name: { type: String, required: true },
    dept_sub_name: { type: String },
    budget: { type: Number, required: true },
    project_status: { type: String, default: 'Active' },
    is_software: { type: Boolean, default: null, index: true },
    // Canonical normalized references. Document, OCR, and summary content live
    // in their own versioned collections.
    primary_document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },
    latest_extraction_run_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractionRun', index: true },
    latest_summary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentSummary', index: true },

    timeline: {
        announce_date: { type: Date },
        contract_start: { type: Date },
        contract_end: { type: Date },
        duration_days: { type: Number }
    },
    source: {
        provider: { type: String, default: 'egp_open_data' },
        fetched_at: { type: Date },
        payload_hash: { type: String },
    },

    classification: {
        status: {
            type: String,
            enum: ['pending', 'software', 'not_software', 'uncertain', 'manual_override'],
            default: 'pending',
            index: true,
        },
        confidence: { type: Number, min: 0, max: 1 },
        method: { type: String },
        model: { type: String },
        classified_at: { type: Date },
        reason: { type: String },
    },

    processing: {
        download_attempts: { type: Number, default: 0 },
        ai_attempts: { type: Number, default: 0 },
        status: {
            type: String,
            enum: [
                'metadata_ingested', 'classification_pending', 'irrelevant',
                'document_pending', 'document_downloaded', 'ai_pending',
                'text_extraction_pending', 'text_extracted',
                'completed', 'metadata_only', 'review_required',
                'retry_pending', 'failed',
            ],
            default: 'metadata_ingested',
            index: true,
        },
        attempts: { type: Number, default: 0, min: 0 },
        error: { type: String },
    },

    anomalies: {
        high_budget_flag: { type: Boolean, default: false },
        budget_deviation_multiplier: { type: Number, default: 1.0 },
    },

    workflow: {
        status: { type: String, index: true },
        error: String,
        updated_at: Date,
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export default mongoose.models.Project || mongoose.model('Project', ProjectSchema);
