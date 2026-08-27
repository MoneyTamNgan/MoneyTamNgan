import mongoose from 'mongoose';

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

    extracted_data: {
        summary: { type: String },
        qualifications: [{ type: String }],
        scope_of_work: [{ type: String }],
        tech_stack: [{ type: String }]
    },

    anomalies: {
        high_budget_flag: { type: Boolean, default: false },
        budget_deviation_multiplier: { type: Number, default: 1.0 },
        flagged_clauses: [{
            clause_text: { type: String },
            reason: { type: String }
        }]
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