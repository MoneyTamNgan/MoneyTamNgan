import { expect, it, vi } from 'vitest';
import { createPipelineController } from '@/lib/admin-pipeline-control';
import { createPipelineMemoryStore } from '../helpers/pipeline-memory-store.js';
const actor = { request_id: 'fixture', actor_id: 'admin', actor_role: 'admin', at: new Date(), ip: '127.0.0.1' };

it('shares a lock across independent controllers, recovers a restart, and fences old callbacks', async () => {
    const store = createPipelineMemoryStore();
    let time = Date.parse('2026-11-12T00:00:00Z');
    const now = () => new Date(time);
    const oldTasks = [], newTasks = [];
    const execute = vi.fn(async () => {});
    const old = createPipelineController({ store, execute, now, leaseMs: 1000 });
    const oldRun = await old.triggerPipeline({}, actor, task => oldTasks.push(task));
    const restarted = createPipelineController({ store, execute, now, leaseMs: 1000 });
    await expect(restarted.triggerPipeline({}, actor, () => {})).rejects.toMatchObject({ code: 'PIPELINE_ALREADY_RUNNING' });
    time += 1001;
    expect(await restarted.getStatus()).toMatchObject({ id: oldRun.id, status: 'failed', errorCode: 'PIPELINE_INTERRUPTED', startedAt: oldRun.startedAt });
    const successor = await restarted.triggerPipeline({}, actor, task => newTasks.push(task));
    await oldTasks[0](); // An obsolete server callback must neither execute nor release the new lease.
    expect(execute).not.toHaveBeenCalled();
    expect(await restarted.getStatus()).toMatchObject({ id: successor.id, status: 'running' });
    await newTasks[0]();
    expect(execute).toHaveBeenCalledOnce();
    expect((await restarted.getStatus()).status).toBe('completed');
});

it('renews a live lease during slow work instead of expiring a healthy run', async () => {
    const store = createPipelineMemoryStore();
    let release;
    const controller = createPipelineController({ store, leaseMs: 100, heartbeatMs: 10,
        execute: async () => new Promise(resolve => { release = resolve; }) });
    let task;
    await controller.triggerPipeline({}, actor, cb => { task = cb; });
    const running = task();
    await new Promise(resolve => setTimeout(resolve, 160));
    expect((await controller.getStatus()).status).toBe('running');
    release(); await running;
    expect((await controller.getStatus()).status).toBe('completed');
});

it('fails an over-budget run at a checkpoint and permits a later retry', async () => {
    const store = createPipelineMemoryStore();
    let time = Date.now();
    const controller = createPipelineController({ store, now: () => new Date(time), maxRunMs: 100,
        execute: async (_options, report) => { time += 101; await report({ phase: 'acquisition' }); } });
    let task;
    await controller.triggerPipeline({}, actor, cb => { task = cb; });
    await task();
    expect((await controller.getStatus()).status).toBe('failed');
    await expect(controller.triggerPipeline({}, actor, () => {})).resolves.toMatchObject({ status: 'running' });
});
