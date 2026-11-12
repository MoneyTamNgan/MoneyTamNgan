import { randomUUID } from 'node:crypto';

export const initialRunState = () => ({ id: null, status: 'idle', phase: 'idle', startedAt: null,
    completedAt: null, error: null, errorCode: null,
    progress: { current: 0, total: 0, percent: 0, stage: 'idle', message: 'Pipeline ready' },
    summary: { discovered: 0, candidates: 0, documentsAcquired: 0, processed: 0, notified: 0, errors: [] },
});
const copy = value => structuredClone(value);
const conflict = run => Object.assign(new Error('A data pipeline run is already in progress'),
    { code: 'PIPELINE_ALREADY_RUNNING', currentRun: run });

export function createPipelineController({ store, execute, now = () => new Date(), leaseMs = 90000,
    heartbeatMs = 15000, maxRunMs = 30 * 60 * 1000 }) {
    async function getStatus() { await store.recover(now()); return copy(await store.read() || initialRunState()); }
    async function resetStatus() {
        const run = await getStatus();
        if (run.status === 'running') throw conflict(run);
        const reset = await store.reset();
        if (!reset && (await getStatus()).status === 'running') throw conflict(await getStatus());
        return copy(reset || initialRunState());
    }
    async function triggerPipeline(options, actor, schedule) {
        await store.recover(now());
        const start = now();
        const owner = randomUUID();
        const run = { ...initialRunState(), id: `pipe_${start.getTime()}_${randomUUID()}`, status: 'running',
            phase: 'starting', startedAt: start.toISOString(),
            progress: { current: 0, total: 0, percent: 5, stage: 'initializing', message: 'Pipeline starting' } };
        if (!(await store.claim(run, owner, start, new Date(start.getTime() + leaseMs)))) {
            const currentRun = await getStatus();
            await store.audit({ ...actor, outcome: 'already_running', http_status: 409, run_id: currentRun.id });
            throw conflict(currentRun);
        }
        try {
            await store.audit({ ...actor, outcome: 'accepted', http_status: 202, run_id: run.id });
            // after() registers work with Next's response lifecycle; no scraping
            // or expensive execution begins inside the HTTP response path.
            schedule(async () => {
                let snapshot = copy(run);
                let chain = Promise.resolve();
                const abort = new AbortController();
                const persist = () => {
                    chain = chain.then(async () => {
                        if (abort.signal.aborted) throw abort.signal.reason;
                        const at = now();
                        if (at.getTime() - start.getTime() >= maxRunMs) throw new Error('Run deadline exceeded');
                        if (!(await store.renew(owner, copy(snapshot), at, new Date(at.getTime() + leaseMs)))) throw new Error('Lease lost');
                    });
                    chain.catch(error => abort.abort(error));
                    return chain;
                };
                const report = async patch => {
                    if (abort.signal.aborted) throw abort.signal.reason;
                    snapshot = { ...snapshot, ...patch, progress: { ...snapshot.progress, ...patch.progress },
                        summary: { ...snapshot.summary, ...patch.summary } };
                    await persist();
                };
                const heartbeat = setInterval(() => { void persist().catch(() => {}); }, heartbeatMs);
                heartbeat.unref?.();
                try {
                    await report({});
                    await execute({ ...options, signal: abort.signal }, report);
                    await chain;
                    if (abort.signal.aborted) throw abort.signal.reason;
                    snapshot = { ...snapshot, status: 'completed', phase: 'completed', completedAt: now().toISOString(),
                        progress: { ...snapshot.progress, percent: 100, stage: 'completed' } };
                } catch {
                    snapshot = { ...snapshot, status: 'failed', phase: 'failed', completedAt: now().toISOString(),
                        errorCode: 'PIPELINE_EXECUTION_FAILED', error: 'Pipeline execution failed or its lease was lost',
                        progress: { ...snapshot.progress, stage: 'failed', message: 'Pipeline failed; retry is allowed' } };
                } finally {
                    clearInterval(heartbeat);
                    await chain.catch(() => {});
                    // A stale callback cannot overwrite a successor's state.
                    await store.finish(owner, snapshot, now()).catch(() => {});
                }
            });
        } catch (error) {
            await store.finish(owner, { ...run, status: 'failed', phase: 'failed',
                errorCode: 'PIPELINE_START_FAILED', error: 'Pipeline could not be scheduled or audited', completedAt: now().toISOString() }, now());
            throw error;
        }
        return copy(run);
    }
    return { getStatus, resetStatus, triggerPipeline };
}
