import mongoose from 'mongoose';

const EvidenceSchema = new mongoose.Schema({
    value: { type: String, required: true },
    page: { type: Number, min: 1 },
}, { _id: false });

const FlaggedClauseSchema = new mongoose.Schema({
    clause_text: { type: String, required: true },
    reason: { type: String, required: true },
    page: { type: Number, min: 1 },
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
    project_id: { type: String, required: true, unique: true, index: true },
    project_name: { type: String, required: true },
    dept_name: { type: String, required: true },
    dept_sub_name: { type: String },
    budget: { type: Number, required: true },
    project_status: { type: String, default: 'Active' },
    is_software: { type: Boolean, default: null, index: true },
    classification_confidence: { type: Number, min: 0, max: 1, default: null },

    timeline: {
        announce_date: { type: Date },
        contract_start: { type: Date },
        contract_end: { type: Date },
        duration_days: { type: Number }
    },
    pdf_url: { type: String },

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

    document: {
        status: {
            type: String,
            enum: ['pending', 'url_found', 'downloaded', 'stored', 'unavailable', 'invalid', 'retry_pending', 'failed'],
            default: 'pending',
            index: true,
        },
        source_url: { type: String },
        filename: { type: String },
        mime_type: { type: String },
        page_count: { type: Number, min: 0 },
        error: { type: String },
    },

    processing: {
        attempts: { type: Number, default: 0, min: 0 },
        status: {
            type: String,
            enum: ['metadata_ingested', 'classification_pending', 'irrelevant', 'document_pending', 'document_downloaded', 'ai_pending', 'text_extracted', 'completed', 'review_required', 'retry_pending', 'failed'],
            default: 'metadata_ingested',
            index: true,
        },
        summary_source: { type: String, enum: ['pdf', 'metadata', null], default: null },
        error: { type: String, default: null },
    },

    extracted_data: {
        summary: { type: String },
        qualifications: [{ type: String }],
        scope_of_work: [{ type: String }],
        tech_stack: [{ type: String }],
        evidence: {
            qualifications: [EvidenceSchema],
            scope_of_work: [EvidenceSchema],
            tech_stack: [EvidenceSchema],
        },
    },

    anomalies: {
        high_budget_flag: { type: Boolean, default: false },
        budget_deviation_multiplier: { type: Number, default: 1.0 },
        flagged_clauses: [FlaggedClauseSchema]
    },

    version_info: {
        version: { type: Number, default: 1 },
        is_latest: { type: Boolean, default: true },
        superseded_by: { type: String, default: null }
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

export default mongoose.models.Project || mongoose.model('Project', ProjectSchema);
