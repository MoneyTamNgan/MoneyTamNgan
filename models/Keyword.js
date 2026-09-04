import mongoose from 'mongoose';

/**
 * A single classification keyword rule (FR-1.2). The admin screen edits this
 * collection; `lib/keywords.js` reads it back into the shape `classifyTor`
 * expects. Mirrors the `ClassificationKeyword` schema in docs/api/openapi.yaml.
 */
const KeywordSchema = new mongoose.Schema(
    {
        keyword: { type: String, required: true, trim: true },
        category: {
            type: String,
            enum: ['software', 'non-software'],
            required: true,
        },
        updated_by: { type: String, default: null },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

// One rule per (keyword, category) pair.
KeywordSchema.index({ keyword: 1, category: 1 }, { unique: true });

export default mongoose.models.Keyword || mongoose.model('Keyword', KeywordSchema);
