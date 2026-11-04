import { authorizeScopeRequest } from './request-authorization.js';
export { isPipelineAuthorized } from './pipeline-auth.js';

/** Admin reads require an admin JWT with admin:read; the pipeline token is
 * intentionally limited to pipeline operations. */
export async function authorizeAdminRequest(request) {
    return authorizeScopeRequest(request, { scope: 'admin:read', admin: true });
}
