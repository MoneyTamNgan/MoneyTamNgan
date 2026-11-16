#!/usr/bin/env node
// Disposable Atlas telemetry fixture; never probes government sites or emails.
import { config } from 'dotenv';
config({ path: '.env.local' }); config();
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { writeFile } from 'node:fs/promises';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import Attempt from '../models/AcquisitionAttempt.js';
import { getAcquisitionHealth, recordAcquisitionAttempt } from '../lib/acquisition-health.js';
const dbName = `mtn_health_test_${Date.now()}`;
process.env.MONGODB_DB_NAME = dbName;
const output = process.argv[2] || '/tmp/mtn-health-atlas.json';
let connected = false;
try {
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI); connected = true;
    assert.equal(mongoose.connection.name, dbName);
    await Attempt.createIndexes();
    for (let n=0;n<20;n++) {
        assert.equal(await recordAcquisitionAttempt({ attemptKey: `fixture_${n}`, projectId: `69000000${String(n).padStart(3,'0')}`,
            source: 'worker', runId: 'fixture_run', status: n < 18 ? 'success' : 'failed', reasonCode: n < 18 ? null : 'temporary_timeout', startedAt: new Date() }), true);
    }
    await recordAcquisitionAttempt({ attemptKey: 'fixture_0', projectId: '69000000000', source: 'worker', status: 'failed', reasonCode: 'archive_invalid', startedAt: new Date() });
    assert.equal(await Attempt.countDocuments(), 20);
    await recordAcquisitionAttempt({ attemptKey: 'probe', projectId: '69000000001', source: 'benchmark', status: 'success', startedAt: new Date() });
    const healthy = await getAcquisitionHealth();
    assert.equal(healthy.attempted,20); assert.equal(healthy.successRate,.9); assert.equal(healthy.status,'healthy');
    assert.equal(healthy.byRun.fixture_run.attempted,20);
    for(let n=0;n<3;n++) await recordAcquisitionAttempt({ attemptKey:`failure_${n}`,projectId:'69000000001',source:'worker',status:'failed',reasonCode:'anti_bot_blocked',startedAt:new Date() });
    const degraded = await getAcquisitionHealth(); assert.equal(degraded.consecutiveFailures,5); assert.equal(degraded.status,'degraded');
    const indexes = await Attempt.collection.indexes(); assert.ok(indexes.some(index => index.expireAfterSeconds === 7776000));
    const report = { status:'passed',fixture:'isolated Atlas telemetry only; no production acquisition/OCR/Vertex success claim',
        duplicateDidNotOverwrite:true,benchmarkExcluded:true,ttlDays:90,healthy,degraded };
    await writeFile(output,JSON.stringify(report,null,2));console.log(`PASS: isolated telemetry, idempotency, source exclusion, thresholds and TTL; ${output}`);
} catch(error) {
    console.error(JSON.stringify({status:'failed',name:error.name,code:typeof error.code==='number'?error.code:null}));process.exitCode=1;
} finally {
    if(connected && mongoose.connection.name===dbName && /^mtn_health_test_\d+$/.test(dbName)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
}
