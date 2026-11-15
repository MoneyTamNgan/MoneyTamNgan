#!/usr/bin/env node
// Isolated disposable database; mocked email transport, no emails or government/Vertex calls.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ quiet: true });
const { default: mongoose } = await import('mongoose');
const { default: assert } = await import('node:assert/strict');
const { randomBytes } = await import('node:crypto');
const { writeFile } = await import('node:fs/promises');
const { connectMongoWithDnsFallback } = await import('../lib/mongo-network.js');
const { createNotificationService } = await import('../lib/services/notification-service.js');
const { buildMatchNotificationEmail } = await import('../lib/email.js');
const { notificationStore } = await import('../lib/notification-store.js');
const { default: Delivery } = await import('../models/NotificationDelivery.js');
const { default: Batch } = await import('../models/NotificationBatch.js');
const { default: User } = await import('../models/User.js');
const { default: Project } = await import('../models/Project.js');
const { default: Document } = await import('../models/Document.js');
const { default: Run } = await import('../models/ExtractionRun.js');
const { default: Summary } = await import('../models/DocumentSummary.js');
const database = `mtn_notify_test_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
process.env.MONGODB_DB_NAME = database;
const evidence = { checked_at: new Date().toISOString(), transport: 'mocked; no emails sent', checks: [] };
let connected = false;
let stage = "connect";
try {
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI); connected = true; stage = "indexes";
    for (const model of [Delivery, Batch, User, Project, Document, Run, Summary]) await model.createIndexes();
    stage = 'fixtures';
    const user = await User.create({ email: 'fixture@example.com', skills: ['React'], email_notifications_enabled: true });
    await User.create({ email: 'digest@example.com', skills: ['React'], email_notifications_enabled: true, notification_frequency: 'DAILY_DIGEST' });
    await User.create({ email: 'disabled@example.com', email_notifications_enabled: false });
    const doc = await Document.create({ project_id: 'fixture1', filename: 'fixture.pdf', sha256: 'fixturehash', source_url: 'https://example.com/fixture.pdf' });
    const run = await Run.create({ project_id: 'fixture1', document_id: doc._id, run_key: 'fixture', processor_fingerprint: 'fixture', text_sha256: 'text', page_count: 1 });
    const summary = await Summary.create({ project_id: 'fixture1', document_id: doc._id, extraction_run_id: run._id, document_sha256: doc.sha256,
        text_sha256: 'text', model: 'fixture', prompt_version: 'fixture', extraction: { summary: 'Fixture summary', tech_stack: ['React'] } });
    const p = await Project.create({ project_id: 'fixture1', project_name: 'Fixture TOR', dept_name: 'Fixture agency', budget: 1000,
        primary_document_id: doc._id, latest_extraction_run_id: run._id, latest_summary_id: summary._id });
    const sends = [], logs = [];
    const service = createNotificationService({ connect: async () => {}, send: async payload => { sends.push(payload); return { id: `mock-${sends.length}` }; }, log: e => logs.push(e) });
    stage = 'concurrent-dispatch';
    await Promise.all(Array.from({ length: 5 }, () => service.notifyUsersOfMatchingTors([p.toObject()])));
    assert.equal(sends.length, 1);
    assert.equal(await Delivery.countDocuments(), 2);
    assert.equal(await Delivery.countDocuments({ status: 'sent' }), 1);
    assert.ok(sends[0].rendered.html.includes('100%'));
    evidence.checks.push('Normalized summary hydration + 5 concurrent processing hooks: 1 immediate send, 1 queued digest, 0 disabled recipients');
    await service.notifyUsersOfMatchingTors([p.toObject()]);
    await service.sendDailyDigest(); await service.sendDailyDigest();
    assert.equal(sends.length, 2);
    assert.equal(await Delivery.countDocuments({ status: 'sent' }), 2);
    evidence.checks.push('Reprocessing and repeat digest create no duplicate user/project emails');
    stage = 'rollback';
    const match = { torId: 'rollback', title: 'Rollback fixture', matchScore: 100 };
    await notificationStore.enqueue(user, { project_id: 'rollback' }, match, 'skill-v1');
    const updateMany = Delivery.updateMany;
    Delivery.updateMany = () => { throw new Error('controlled fixture failure'); };
    try { await assert.rejects(notificationStore.prepare(user, 'IMMEDIATE', matches => buildMatchNotificationEmail({ to: user.email, matches }))); }
    finally { Delivery.updateMany = updateMany; }
    assert.equal(await Batch.countDocuments({ active_key: `match:${user._id}` }), 0);
    assert.equal((await Delivery.findOne({ project_id: 'rollback' })).status, 'pending');
    evidence.checks.push('Transaction failure rolls back both batch creation and delivery linking');
    stage = 'lease-recovery';
    const batch = await notificationStore.prepare(user, 'IMMEDIATE', matches => buildMatchNotificationEmail({ to: user.email, matches }));
    const first = await notificationStore.claim(batch, new Date());
    await Batch.updateOne({ _id: batch._id }, { $set: { lease_until: new Date(Date.now() - 1) } });
    const second = await notificationStore.claim(await Batch.findById(batch._id).select('+payload').lean(), new Date());
    assert.equal(String(first._id), String(second._id)); assert.equal(second.attempts, 2);
    assert.equal(await notificationStore.settle(first, { status: 'sent' }, new Date()), false);
    assert.equal(await notificationStore.settle(second, { status: 'sent', providerId: 'mock-recovery' }, new Date()), true);
    evidence.checks.push('Expired lease retries the same immutable batch; stale owner cannot settle newer claim');
    assert.ok(!JSON.stringify(logs).includes('fixture@example.com'));
    evidence.checks.push('Dispatcher logs use masked recipients only');
    console.log(JSON.stringify(evidence, null, 2));
    if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(evidence, null, 2) + '\n');
} catch (error) {
    console.error(`Fixture stage: ${stage}; error type: ${error?.name || 'unknown'}; code: ${Number.isInteger(error?.code) ? error.code : 'unavailable'}`);
    console.error('Notification Atlas fixture failed. Check Atlas IP allowlist and rerun; no credentials logged.');
    process.exitCode = 1;
} finally {
    if (connected) await mongoose.connection.dropDatabase().catch(() => {
        console.error("Own fixture database cleanup failed; no application database was targeted.");
        process.exitCode = 1;
    });
    await mongoose.disconnect();
}
