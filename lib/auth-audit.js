import { clientAddress } from './rate-limit.js';

/** Allowlisted metadata only: never include OAuth query strings or credentials. */
export function logAuthAudit(request, event, reason, extra = {}) {
    try {
        let pathname = '/';
        try {
            if (request?.url) pathname = new URL(request.url, 'http://localhost').pathname;
        } catch {
            pathname = '/';
        }
        const payload = {
            event,
            reason,
            timestamp: new Date().toISOString(),
            path: pathname,
            clientAddress: clientAddress(request?.headers).slice(0, 128),
        };
        if (typeof extra?.userId === 'string' && extra.userId) {
            payload.userId = extra.userId.slice(0, 64);
        }
        if (typeof extra?.role === 'string' && extra.role) {
            payload.role = extra.role.slice(0, 32);
        }
        console.warn(JSON.stringify(payload));
    } catch { /* Audit transport failures must not change authentication responses. */ }
}
