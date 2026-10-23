#!/usr/bin/env node
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { listLowConfidenceTors } from '../lib/low-confidence-review.js';

// Isolated fixture database only. No production records, downloads or AI calls.
const databaseName = `mtn_review_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
let db;
try {
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    db = mongoose.connection.getClient().db(databaseName);
    const oid = () => new mongoose.Types.ObjectId();
    const documents = [oid(), oid(), oid()], runs = [oid(), oid(), oid()], summaries = [oid(), oid(), oid()];
    const row = (id, confidence, extra = {}) => ({ _id: oid(), project_id: id, project_name: `Project ${id}`,
        dept_name: 'Fixture agency', is_software: true, classification: { status: 'software', confidence }, ...extra });
    const rows = [row('below', 0.69, { pdf_url: 'https://official.example/bidding.zip' }), row('boundary', 0.70),
        row('high', 0.8), row('missing', null), row('negative', -1), row('percent_scale_invalid', 70),
        row('extraction', 0.9, { primary_document_id: documents[0], latest_extraction_run_id: runs[0], latest_summary_id: summaries[0] }),
        row('stale', 0.9, { primary_document_id: documents[1], latest_extraction_run_id: runs[1], latest_summary_id: summaries[1] }),
        row('legacy_classification', null, { classification_confidence: 0.65 }),
        row('legacy_extraction', 0.8, { processing: { confidence: 0.2 } }), row('nan', NaN),
        row('wrong_hash', 0.9, { primary_document_id: documents[2], latest_extraction_run_id: runs[2], latest_summary_id: summaries[2] }),
        row('zero', 0)];
    await db.collection('projects').insertMany(rows);
    await db.collection('documents').insertMany(['extraction', 'stale', 'wrong_hash'].map((id, i) => ({
        _id: documents[i], project_id: id, sha256: `hash-${i}`, source_url: `https://official.example/${id}.pdf`,
    })));
    await db.collection('extractionruns').insertMany(['extraction', 'stale', 'wrong_hash'].map((id, i) => ({
        _id: runs[i], project_id: id, document_id: documents[i],
    })));
    await db.collection('documentsummaries').insertMany(['extraction', 'stale', 'wrong_hash'].map((id, i) => ({
        _id: summaries[i], project_id: id, document_id: i === 1 ? documents[0] : documents[i],
        extraction_run_id: runs[i], document_sha256: i === 2 ? 'old-hash' : `hash-${i}`, confidence: 0.5,
        extraction: { project_title: `Extracted ${id}`, issuing_agency: 'Extracted agency' },
    })));
    const model = { aggregate: pipeline => ({ option: options => db.collection('projects').aggregate(pipeline, options).toArray() }) };
    const read = (page = 1, confidenceType = 'either', pageSize = 100) => listLowConfidenceTors({ page, pageSize, confidenceType }, { ProjectModel: model });
    const result = await read();
    assert.equal(result.total, 5);
    assert.deepEqual(result.items.map(item => item.projectId), ['zero', 'legacy_extraction', 'extraction', 'legacy_classification', 'below']);
    assert.equal(result.items.find(item => item.projectId === 'extraction').primaryPdfUrl, 'https://official.example/extraction.pdf');
    assert.equal(result.items.find(item => item.projectId === 'extraction').titleSource, 'extracted');
    assert.equal((await read(1, 'classification')).total, 3);
    assert.equal((await read(1, 'extraction')).total, 2);
    const one = await read(1, 'either', 2), two = await read(2, 'either', 2), out = await read(20, 'either', 2);
    assert.equal(one.totalPages, 3);
    assert.equal(two.items.length, 2);
    assert.equal(out.items.length, 0);
    assert.equal(out.total, 5);
    assert.ok(one.items.every(item => !two.items.some(other => other.projectId === item.projectId)));
    console.log(JSON.stringify({ status: 'passed', database: databaseName, matchingFixtures: result.total,
        checks: ['strict .70 boundary', 'missing/invalid scores', 'current summary provenance',
            'classification/extraction selectors', 'stable pagination', 'PDF and metadata mapping'] }, null, 2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
    if (db && /^mtn_review_test_\d+_[a-f0-9]{8}$/.test(databaseName) && db.databaseName === databaseName) {
        await db.dropDatabase();
        console.log('Removed isolated review-test fixture database; production data unchanged.');
    }
    await mongoose.disconnect();
}
