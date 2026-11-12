import mongoose from 'mongoose';

const { Schema, model, models } = mongoose;

const SectionSchema = new Schema({
    heading: { type: String, maxlength: 200, default: '' },
    body: { type: String, maxlength: 8000, default: '' },
    sources: { type: [String], default: [] },
}, { _id: false });

const BidPrepDraftSchema = new Schema({
    userId: { type: String, required: true },
    projectId: { type: String, required: true, maxlength: 64 },
    title: { type: String, default: '', maxlength: 200 },
    sections: { type: [SectionSchema], default: [] },
    version: { type: Number, default: 1, min: 1 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'bid_prep_drafts' });

BidPrepDraftSchema.index({ userId: 1, updatedAt: -1 });
BidPrepDraftSchema.index({ userId: 1, projectId: 1 });

export const BidPrepDraft = models.BidPrepDraft || model('BidPrepDraft', BidPrepDraftSchema);
export default BidPrepDraft;
