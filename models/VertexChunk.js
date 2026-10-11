import mongoose from 'mongoose';

const schema = new mongoose.Schema({
    checkpoint_key: { type: String, required: true, unique: true },
    extraction_run_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractionRun', required: true, index: true },
    chunk_index: { type: Number, required: true, min: 0 },
    model: { type: String, required: true },
    prompt_version: { type: String, required: true },
    result: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

export default mongoose.models.VertexChunk || mongoose.model('VertexChunk', schema);
