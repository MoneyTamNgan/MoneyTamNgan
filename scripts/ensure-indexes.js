#!/usr/bin/env node

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import Document from '../models/Document.js';
import DocumentPage from '../models/DocumentPage.js';
import DocumentSummary from '../models/DocumentSummary.js';
import ProcessingJob from '../models/ProcessingJob.js';
import Project from '../models/Project.js';

const MODELS = [Project, Document, DocumentPage, DocumentSummary, ProcessingJob];

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    for (const model of MODELS) {
        await model.createIndexes();
        console.log(`Ensured indexes for ${model.collection.collectionName}`);
    }
    await mongoose.disconnect();
}

main().catch(async error => {
    console.error(`Index creation failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
