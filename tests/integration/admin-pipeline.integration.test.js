import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { signSession } from '@/lib/auth';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const spec = load(readFileSync(new URL('../../docs/api/openapi.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false }); addFormats(ajv); ajv.addSchema(spec, 'spec');
function contract(path, method, status, value) {
    const pointer = path.replaceAll('~', '~0').replaceAll('/', '~1');
    const validate = ajv.compile({ $ref: `spec#/paths/${pointer}/${method}/responses/${status}/content/application~1json/schema` });
    expect(validate(value), ajv.errorsText(validate.errors)).toBe(true);
}

const state = vi.hoisted(() => ({ tasks: [], execute: vi.fn(), store: null }));
vi.mock('next/server', async original => ({ ...await original(), after: vi.fn(task => state.tasks.push(task)) }));
vi.mock('@/lib/db', () => ({ default: vi.fn(async () => {}) }));
vi.mock('@/models/Project', () => ({ default: { countDocuments: vi.fn(async () => 42) } }));
vi.mock('@/lib/admin-pipeline-store', async () => {
    const { createPipelineMemoryStore } = await import('../helpers/pipeline-memory-store.js');
    state.store = createPipelineMemoryStore(); return { pipelineStore: state.store };
});
vi.mock('@/lib/services/pipeline-runner', async () => {
    const { createPipelineController } = await import('@/lib/admin-pipeline-control');
    const { pipelineStore } = await import('@/lib/admin-pipeline-store');
    return createPipelineController({ store: pipelineStore, execute: (...args) => state.execute(...args) });
});
const { POST } = await import('@/app/api/admin/pipeline/trigger/route');
const { GET, DELETE } = await import('@/app/api/admin/pipeline/status/route');
const { proxy } = await import('@/proxy');
beforeEach(() => {
    state.store.clear(); state.tasks.length = 0;
    state.execute.mockReset().mockImplementation(async (_options, report) => {
        await report({ phase: 'discovery' });
        await report({ phase: 'acquisition', summary: { discovered: 1 } });
        await report({ phase: 'processing' });
        await report({ phase: 'notification' });
    });
});
async function request(path = 'trigger', { role = 'admin', body = {}, method = 'POST', origin = 'http://localhost:3000' } = {}) {
    const token = role ? await signSession({ sub: `${role}-fixture`, role }) : null;
    return new NextRequest(`http://localhost:3000/api/admin/pipeline/${path}`, { method,
        headers: { ...(token ? { Cookie: `mtn_session=${token}` } : {}), ...(origin ? { Origin: origin } : {}),
            'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.5' },
        ...(['GET', 'HEAD'].includes(method) ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

it.each([[null, 401], ['user', 403]])('rejects role %s in Proxy AND the actual trigger/status/reset handlers', async (role, status) => {
    for (const [path, method, handler] of [['trigger', 'POST', POST], ['status', 'GET', GET], ['status', 'DELETE', DELETE]]) {
        expect((await proxy(await request(path, { role, method }))).status).toBe(status);
        expect((await handler(await request(path, { role, method }))).status).toBe(status);
    }
    expect(state.tasks).toHaveLength(0); expect(state.execute).not.toHaveBeenCalled();
});

it('returns 202 with job ID and Started At before executing ANY pipeline work', async () => {
    const response = await POST(await request());
    expect(response.status).toBe(202);
    const result = await response.json();
    contract('/admin/pipeline/trigger', 'post', 202, result);
    expect(result.jobId).toMatch(/^pipe_\d+_/);
    expect(result.runId).toBe(result.jobId);
    expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
    expect(result.run.startedAt).toBe(result.startedAt);
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.tasks).toHaveLength(1);
    expect(state.store.audits[0]).toMatchObject({ actor_id: 'admin-fixture', actor_role: 'admin', ip: '203.0.113.5', http_status: 202, run_id: result.jobId });
    expect((await (await GET(await request('status', { method: 'GET' }))).json()).run.status).toBe('running');
    await state.tasks[0]();
    const completed = await (await GET(await request('status', { method: 'GET' }))).json();
    contract('/admin/pipeline/status', 'get', 200, completed);
    expect(completed.run.status).toBe('completed');
    expect(completed.run.startedAt).toBe(result.startedAt);
    expect(completed.run.summary.discovered).toBe(1);
});

it('returns 409 for simultaneous and subsequent triggers and launches exactly one run', async () => {
    const responses = await Promise.all([POST(await request()), POST(await request())]);
    expect(responses.map(r => r.status).sort()).toEqual([202, 409]);
    const conflict = await responses.find(r => r.status === 409).json();
    contract('/admin/pipeline/trigger', 'post', 409, conflict);
    expect(conflict.error.code).toBe('PIPELINE_ALREADY_RUNNING');
    expect(state.tasks).toHaveLength(1);
    expect((await POST(await request())).status).toBe(409);
    expect((await DELETE(await request('status', { method: 'DELETE' }))).status).toBe(409);
    await state.tasks[0]();
    expect(state.execute).toHaveBeenCalledOnce();
    expect(state.store.audits.map(a => a.http_status)).toEqual(expect.arrayContaining([202, 409]));
});

it('reports idle, failed and completed states and keeps last start time on terminal reset', async () => {
    expect((await (await GET(await request('status', { method: 'GET' }))).json()).run.status).toBe('idle');
    const accepted = await (await POST(await request())).json();
    state.execute.mockRejectedValueOnce(new Error('secret upstream detail'));
    await state.tasks[0]();
    const failed = await (await GET(await request('status', { method: 'GET' }))).json();
    expect(failed.run.status).toBe('failed');
    expect(JSON.stringify(failed)).not.toContain('secret');
    const reset = await (await DELETE(await request('status', { method: 'DELETE' }))).json();
    expect(reset.run.status).toBe('idle'); expect(reset.run.startedAt).toBe(accepted.startedAt);
    expect(reset.run.progress).toMatchObject({ percent: 0, stage: 'idle' });
    expect((await POST(await request())).status).toBe(202);
});

it.each([{ limit: 0 }, { limit: 51 }, { sync: true }, { depts: ['bad'] }, { projectIds: ['not-an-id'] }, { tenders: [] }, 'bad json', 'null', '[]'])('rejects invalid input %j without scheduling work', async body => {
    expect((await POST(await request('trigger', { body }))).status).toBe(400);
    expect(state.tasks).toHaveLength(0); expect(state.store.audits[0].http_status).toBe(400);
});

it('blocks browser requests without an allowed Origin in both layers', async () => {
    for (const origin of [null, 'https://evil.example']) {
        expect((await proxy(await request('trigger', { origin }))).status).toBe(403);
        expect((await POST(await request('trigger', { origin }))).status).toBe(403);
    }
    expect(state.tasks).toHaveLength(0);
});

it('fails closed when the durable audit cannot be written', async () => {
    const audit = vi.spyOn(state.store, 'audit').mockRejectedValueOnce(new Error('database secret'));
    const response = await POST(await request());
    expect(response.status).toBe(503); expect(state.tasks).toHaveLength(0);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    audit.mockRestore();
});
