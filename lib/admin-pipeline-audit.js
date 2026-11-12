import { randomUUID } from 'node:crypto';
import { clientAddress } from './rate-limit.js';

export const isPipelineTrigger = (path, method) => path === '/api/admin/pipeline/trigger' && method === 'POST';

export function pipelineAuditContext(request, principal) {
    return {
        request_id: randomUUID(), at: new Date(),
        actor_id: String(principal?.session?.sub || 'anonymous').slice(0, 100),
        actor_role: String(principal?.session?.role || principal?.kind || 'anonymous').slice(0, 30),
        ip: clientAddress(request.headers).slice(0, 100),
    };
}

// Denials in Proxy must be recorded without making unauthenticated callers
// open a database connection. JSON encoding prevents log-line injection.
export function logPipelineAudit(event) {
    const { request_id, at, actor_id, actor_role, ip, outcome, http_status, run_id } = event;
    try {
        console.info(JSON.stringify({ event: 'admin_pipeline_trigger', request_id, at,
            actor_id, actor_role, ip, outcome, http_status, ...(run_id ? { run_id } : {}) }));
    } catch { /* Logging transport cannot turn an authentication denial into a different response. */ }
}
