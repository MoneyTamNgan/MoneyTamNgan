import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { connectMongoWithDnsFallback } from '../lib/mongo-network.js';
import { signSession } from '../lib/auth.js';
import State from '../models/AdminPipelineState.js';
import Audit from '../models/PipelineTriggerAudit.js';
import Project from '../models/Project.js';
import { pipelineStore } from '../lib/admin-pipeline-store.js';
import { createPipelineController } from '../lib/admin-pipeline-control.js';

// Own database and process only. The fixture is explicitly non-software, so
// no government requests, browser scraping, Vertex calls or emails are made.
const database = `mtn_admin_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const origin = 'http://localhost:3127';
process.env.MONGODB_DB_NAME = database;
process.env.JWT_SECRET = randomBytes(32).toString('hex');
let server;
let connected = false;
const evidence = { checks: [], responses: {} };
try {
    await connectMongoWithDnsFallback(mongoose, process.env.MONGODB_URI);
    connected = true;
    await Promise.all([State.init(), Audit.init(), Project.init()]);
    const actor = () => ({ request_id: randomUUID(), actor_id: 'admin-smoke', actor_role: 'admin', ip: '127.0.0.1', at: new Date() });
    const callbacks = [];
    const controller = () => createPipelineController({ store: pipelineStore, execute: async () => {} });
    const claims = await Promise.allSettled(Array.from({ length: 5 }, () => controller().triggerPipeline({}, actor(), cb => callbacks.push(cb))));
    assert.equal(claims.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(claims.filter(r => r.status === 'rejected' && r.reason.code === 'PIPELINE_ALREADY_RUNNING').length, 4);
    assert.equal(callbacks.length, 1);
    evidence.checks.push('Real MongoDB atomic lock: 1 winner across 5 independent controllers');

    let ready = false;
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3127'], {
        env: { ...process.env, APP_ORIGIN: origin, CORS_ALLOWED_ORIGINS: origin, PIPELINE_ADMIN_TOKEN: '', CRON_SECRET: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let launchError;
    server.on('error', error => { launchError = error; });
    server.stdout.on('data', chunk => { if (/Ready in/i.test(String(chunk))) ready = true; });
    server.stderr.on('data', () => {});
    for (let i = 0; i < 80 && !ready; i++) {
        if (launchError || server.exitCode !== null) throw new Error('Own test server could not start');
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Own test server bound the test port');
    const admin = await signSession({ sub: 'admin-smoke', role: 'admin' });
    const user = await signSession({ sub: 'user-smoke', role: 'user' });
    const headers = token => ({ Origin: origin, 'Content-Type': 'application/json', ...(token ? { Cookie: `mtn_session=${token}` } : {}) });
    const trigger = (token, body = {}) => fetch(origin + '/api/admin/pipeline/trigger', { method: 'POST', headers: headers(token), body: JSON.stringify(body) });
    const status = async () => {
        const response = await fetch(origin + '/api/admin/pipeline/status', { headers: headers(admin) });
        assert.equal(response.status, 200); return response.json();
    };
    const anonymous = await trigger(null); assert.equal(anonymous.status, 401);
    const forbidden = await trigger(user); assert.equal(forbidden.status, 403);
    evidence.responses['403'] = await forbidden.json();
    const conflict = await trigger(admin); assert.equal(conflict.status, 409);
    evidence.responses['409'] = await conflict.json();
    evidence.checks.push('HTTP 401/403 and 409 on occupied shared lock');
    await State.updateOne({ _id: 'admin_pipeline' }, { $set: { lease_until: new Date(Date.now() - 1) } });
    const recovered = await status();
    assert.equal(recovered.run.status, 'failed'); assert.equal(recovered.run.errorCode, 'PIPELINE_INTERRUPTED');
    assert.ok(recovered.run.startedAt);
    await callbacks[0](); // stale execution must be fenced by the database lease.
    evidence.checks.push('Restart/expired-lease recovery and stale callback fencing');
    await Project.create({ project_id: '69000000000', project_name: 'Non-software control fixture', is_software: false,
        classification: { status: 'manual_override' } });
    const accepted = await trigger(admin, { limit: 1, projectIds: ['69000000000'] });
    assert.equal(accepted.status, 202);
    evidence.responses['202'] = await accepted.json();
    assert.ok(evidence.responses['202'].jobId); assert.ok(evidence.responses['202'].startedAt);
    let final;
    for (let i = 0; i < 80; i++) {
        final = await status();
        if (final.run.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(final.run.status, 'completed'); assert.equal(final.run.summary.discovered, 1);
    assert.equal(final.run.startedAt, evidence.responses['202'].startedAt);
    assert.equal(final.run.summary.processed, 0);
    evidence.responses['completed'] = final;
    const audits = await Audit.find().lean();
    assert.ok(audits.some(a => a.actor_id === 'admin-smoke' && a.http_status === 202 && a.run_id === final.run.id));
    assert.ok(audits.some(a => a.http_status === 409));
    const serialized = JSON.stringify({ evidence, audits });
    assert.ok(!serialized.includes(admin) && !serialized.includes(user) && !serialized.includes(process.env.JWT_SECRET));
    assert.equal(final.run.owner, undefined);
    evidence.checks.push('Actual admin session trigger -> 202 -> persisted completed status', 'Durable who/when/IP audit; no credentials in evidence');
    const evidencePath = process.argv[2];
    if (evidencePath) await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'passed', database, checks: evidence.checks }, null, 2));
} catch (error) {
    console.error(`Admin pipeline smoke failed: ${error.name}: ${error.message}`); process.exitCode = 1;
} finally {
    if (server && server.exitCode === null) {
        const exited = once(server, 'exit'); server.kill('SIGTERM');
        await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
        if (server.exitCode === null) server.kill('SIGKILL');
    }
    if (connected && /^mtn_admin_test_\d+_[a-f0-9]{8}$/.test(database) && mongoose.connection.name === database) {
        await mongoose.connection.db.dropDatabase(); console.log('Removed only the isolated admin-pipeline fixture database.');
    }
    await mongoose.disconnect();
}
