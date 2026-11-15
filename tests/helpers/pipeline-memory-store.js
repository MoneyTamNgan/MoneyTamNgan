// Atomic in-memory implementation of the store contract for deterministic tests.
// Production always uses MongoDB's singleton _id and conditional updates.
export function createPipelineMemoryStore() {
    let state = null;
    const audits = [];
    const copy = value => structuredClone(value);
    const owns = (owner, now) => state?.owner === owner && state.run.status === 'running' && state.lease_until > now;
    return {
        audits,
        clear() { state = null; audits.length = 0; },
        async read() { return copy(state?.run || null); },
        async recover(now) {
            if (state?.run.status === 'running' && state.lease_until <= now) {
                state.run = { ...state.run, status: 'failed', phase: 'failed', completedAt: now.toISOString(), errorCode: 'PIPELINE_INTERRUPTED' };
                delete state.owner;
            }
        },
        async claim(run, owner, now, leaseUntil) {
            if (state?.run.status === 'running') return false;
            state = { run: copy(run), owner, lease_until: leaseUntil }; return true;
        },
        async renew(owner, run, now, leaseUntil) {
            if (!owns(owner, now)) return false;
            state.run = copy(run); state.lease_until = leaseUntil; return true;
        },
        async finish(owner, run, now) {
            if (!owns(owner, now)) return false;
            state.run = copy(run); delete state.owner; return true;
        },
        async reset() {
            if (!state || state.run.status === 'running') return null;
            state.run = { ...state.run, status: 'idle', phase: 'idle', error: null, errorCode: null,
                progress: { current: 0, total: 0, percent: 0, stage: 'idle', message: 'Pipeline ready' } }; return copy(state.run);
        },
        async audit(event) { audits.push(copy(event)); },
    };
}
