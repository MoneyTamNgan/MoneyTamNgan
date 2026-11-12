import { NextResponse } from 'next/server';
import { authorizeScopeRequest, permissionFor } from './request-authorization.js';
import { originError, applyCors, securityHeaders } from './security-policy.js';
import { isPipelineTrigger, pipelineAuditContext, logPipelineAudit } from './admin-pipeline-audit.js';

/** Independent route guard: never trust a scope/role header supplied by a client
 * or assume Proxy was invoked. Ownership stays inside profile handlers. */
export function withRouteSecurity(handler, path, method) {
    return async function securedRoute(request, context) {
        const permission = permissionFor(path, method);
        const auth = await authorizeScopeRequest(request, permission);
        let response;
        if (!auth.authorized) response = NextResponse.json({ error: { code: auth.code, message: auth.message } }, { status: auth.status });
        else {
            const origin = request && originError({ headers: request.headers, method: permission.mutation ? 'POST' : method },
                { machine: ['pipeline', 'bearer', 'cron'].includes(auth.principal?.kind) });
            if (origin) response = NextResponse.json({ error: { code: 'FORBIDDEN_ORIGIN', message: origin } }, { status: 403 });
            else response = await handler(request, context);
        }
        if ([401, 403].includes(response.status) && isPipelineTrigger(path, method)) {
            logPipelineAudit({ ...pipelineAuditContext(request, auth.principal), outcome: 'denied', http_status: response.status });
        }
        if (!permission.public) {
            response.headers.set('Cache-Control', 'private, no-store');
            response.headers.append('Vary', 'Cookie, Authorization');
        }
        for (const { key, value } of securityHeaders()) if (!response.headers.has(key)) response.headers.set(key, value);
        // Proxy owns per-request nonce CSP; never replace it with this route fallback.
        if (request) { try { applyCors(response, request); } catch { /* origin config already fails closed */ } }
        return response;
    };
}
