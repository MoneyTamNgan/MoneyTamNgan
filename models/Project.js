import mongoose from 'mongoose';

function requiredUnlessRss() {
    return this.source?.provider !== 'egp_rss';
}

const ProjectSchema = new mongoose.Schema({
    project_id: { type: String, required: true, unique: true, index: true },
    project_name: { type: String, required: true },
    // RSS-discovered tenders learn agency and price only from the invitation PDF.
    dept_name: { type: String, required: requiredUnlessRss },
    dept_sub_name: { type: String },
    budget: { type: Number, required: requiredUnlessRss },
    project_status: { type: String, default: 'Active' },
    is_software: { type: Boolean, default: null, index: true },
    // Canonical normalized references. Document, OCR, and summary content live
    // in their own versioned collections.
    primary_document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },
    latest_extraction_run_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractionRun', index: true },
    latest_summary_id: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentSummary', index: true },
    // Invitation PDF (ประกาศเชิญชวน), paired with the primary TOR document.
    announcement_document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', index: true },

    // Open-tender state from the e-GP announcement feed and invitation PDF.
    tender: {
        status: {
            type: String,
            enum: ['draft_open', 'bidding_open', 'closed', 'unknown'],
            index: true,
        },
        rss_dept_id: String,
        method: String,
        draft_url: String,
        invitation_url: String,
        published_at: Date,
        submission_date: String,
        submission_start_time: String,
        submission_end_time: String,
        closes_at: { type: Date, index: true },
        reference_price: Number,
        tor_route: { type: String, enum: ['feed', 'browser'] },
        checked_at: Date,
        error: String,
    },

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
        error_code: {
            type: String,
            enum: [
                'document_not_published', 'temporary_timeout', 'resolver_failed',
                'anti_bot_blocked', 'unsupported_layout', 'download_failed',
                'archive_invalid', 'failed',
            ],
        },
        error: { type: String },
    },

    // Revision lineage across re-announced tenders (lib/tor-lineage.js).
    lineage_key: { type: String, index: true },
    version_info: {
        version: { type: Number, min: 1 },
        is_latest: Boolean,
        lineage_id: String,
        supersedes: String,
        superseded_by: { type: String, index: true },
        status_before_superseded: String,
        linked_at: Date,
    },

    anomalies: {
        high_budget_flag: { type: Boolean, default: false },
        budget_deviation_multiplier: { type: Number, default: 1.0 },
    },

    workflow: {
        status: { type: String, index: true },
        error_code: String,
        error: String,
        updated_at: Date,
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// Full-text search across project title, issuing agency, and extracted tech stack.
ProjectSchema.index(
    { project_name: 'text', dept_name: 'text', 'extracted_data.tech_stack': 'text' },
    {
        name: 'tor_search_text_index',
        weights: { project_name: 5, dept_name: 3, 'extracted_data.tech_stack': 2 },
    }
);

// Supports agency-filtered listings sorted/ranged by budget.
ProjectSchema.index({ dept_name: 1, budget: -1 }, { name: 'agency_budget_index' });

export default mongoose.models.Project || mongoose.model('Project', ProjectSchema);
