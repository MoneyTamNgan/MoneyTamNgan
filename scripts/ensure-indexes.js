#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ExtractionRun from '../models/ExtractionRun.js';
import ProcessingJob from '../models/ProcessingJob.js';
import ClassificationOverride from '../models/ClassificationOverride.js';
import IngestionRun from '../models/IngestionRun.js';
import AdminPipelineState from '../models/AdminPipelineState.js';
import PipelineTriggerAudit from '../models/PipelineTriggerAudit.js';
import Project from '../models/Project.js';
import VertexChunk from '../models/VertexChunk.js';
import { User } from '../models/User.js';
import { BidPrepDraft } from '../models/BidPrepDraft.js';
import DiscoveryCandidate from '../models/DiscoveryCandidate.js';
import { embeddingConfig } from '../lib/embedding-config.js';
import { ensureVectorSearchIndex, VECTOR_INDEX_NAME } from '../lib/vector-index.js';

const MODELS = [
    Project,
    Document,
    ExtractionRun,
    DocumentPage,
    DocumentSummary,
    ProcessingJob,
    VertexChunk,
    DiscoveryCandidate,
    ClassificationOverride,
    IngestionRun,
    AdminPipelineState,
    PipelineTriggerAudit,
    User,
    BidPrepDraft,
];

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    for (const model of MODELS) {
        await model.createIndexes();
        if (model === Document) {
            const indexes = await model.collection.indexes();
            if (indexes.some(index => index.name === 'uniq_document_source_entry')) {
                // Replacement index exists first. This removes no stored documents.
                await model.collection.dropIndex('uniq_document_source_entry');
            }
        }
        console.log(`Ensured indexes for ${model.collection.collectionName}`);
        if (model === Project) {
            // Atlas only: a plain mongod has no search-index support, so don't fail the run.
            try {
                const { dimensions } = embeddingConfig();
                const outcome = await ensureVectorSearchIndex(model.collection, { dimensions });
                console.log(`Vector Search index ${VECTOR_INDEX_NAME} (${dimensions} dims): ${outcome}`);
            } catch (error) {
                console.warn(`Skipped Vector Search index (needs MongoDB Atlas): ${error.message}`);
            }
        }
    }
    await mongoose.disconnect();
}

main().catch(async error => {
    console.error(`Index creation failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
