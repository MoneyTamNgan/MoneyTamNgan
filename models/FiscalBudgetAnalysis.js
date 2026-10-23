import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    project_id: { type: String, required: true, index: true },
    project_ref: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    input_key: { type: String, required: true, unique: true },
    parser_version: { type: String, required: true },
    source_snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
    result: { type: mongoose.Schema.Types.Mixed, required: true },
    processed_at: { type: Date, default: Date.now },
}, { autoCreate: false, autoIndex: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.models.FiscalBudgetAnalysis || mongoose.model('FiscalBudgetAnalysis', schema);
