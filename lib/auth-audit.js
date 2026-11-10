import { clientAddress } from './rate-limit.js';

/** Allowlisted metadata only: never include OAuth query strings or credentials. */
export function logAuthAudit(request, event, reason) {
    try {
        console.warn(JSON.stringify({
            event, reason, timestamp: new Date().toISOString(),
            path: new URL(request.url).pathname,
            clientAddress: clientAddress(request.headers).slice(0, 128),
        }));
    } catch { /* Audit transport failures must not change authentication responses. */ }
}
