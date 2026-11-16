import { expect, it, vi, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { signSession } from '@/lib/auth';
import { permissionFor } from '@/lib/request-authorization';
import { withRouteSecurity } from '@/lib/route-security';
import { proxy } from '@/proxy';

// Reviewed expectation table for RBAC_SPEC.md, not derived from permissionFor.
const routes = [
    ["GET", "/api/admin/classification/queue", "admin:read", false, true],
    ["POST", "/api/admin/classification/run", "admin:write", false, true],
    ["GET", "/api/admin/keywords", "admin:read", false, true],
    ["PUT", "/api/admin/keywords", "admin:write", false, true],
    ["GET", "/api/admin/pipeline/status", "admin:read", false, true],
    ["DELETE", "/api/admin/pipeline/status", "admin:write", false, true],
    ["POST", "/api/admin/pipeline/trigger", "admin:write", false, true],
    ["PATCH", "/api/admin/tors/[id]/classification", "tor:write", false, true],
    ["GET", "/api/admin/tors/[id]/classification", "admin:read", false, true],
    ["GET", "/api/analytics/export", "tor:read", true, false],
    ["GET", "/api/analytics/overview/export", "tor:read", true, false],
    ["GET", "/api/analytics/overview", "tor:read", true, false],
    ["GET", "/api/analytics/search", "tor:read", true, false],
    ["GET", "/api/auth/google/callback", null, true, false],
    ["GET", "/api/auth/google/login", null, true, false],
    ["GET", "/api/auth/google/start", null, true, false],
    ["POST", "/api/auth/login", null, true, false],
    ["POST", "/api/auth/logout", null, true, false],
    ["GET", "/api/auth/me", "profile:read", false, false],
    ["POST", "/api/auth/register", null, true, false],
    ["DELETE", "/api/bid-prep/data", "profile:write", false, false],
    ["POST", "/api/bid-prep/drafts/[id]/export", "profile:write", false, false],
    ["GET", "/api/bid-prep/drafts/[id]", "profile:read", false, false],
    ["PATCH", "/api/bid-prep/drafts/[id]", "profile:write", false, false],
    ["DELETE", "/api/bid-prep/drafts/[id]", "profile:write", false, false],
    ["GET", "/api/bid-prep/drafts", "profile:read", false, false],
    ["POST", "/api/bid-prep/drafts", "profile:write", false, false],
    ["GET", "/api/bid-prep/tors/[projectId]/checklist", "profile:read", false, false],
    ["GET", "/api/health", null, true, false],
    ["GET", "/api/ingestion/status", "pipeline:read", false, false],
    ["POST", "/api/ingestion/trigger", "pipeline:trigger", false, false],
    ["POST", "/api/notifications/digest", "notifications:send", false, true],
    ["GET", "/api/notifications/digest", "notifications:send", false, true],
    ["POST", "/api/notifications/test", "notifications:test", false, false],
    ["GET", "/api/processing/review", "admin:read", false, true],
    ["GET", "/api/processing/status", "pipeline:read", false, false],
    ["POST", "/api/processing/trigger", "pipeline:trigger", false, false],
    ["GET", "/api/profile", "profile:read", false, false],
    ["PATCH", "/api/profile", "profile:write", false, false],
    ["PUT", "/api/profile", "profile:write", false, false],
    ["DELETE", "/api/profile", "profile:write", false, false],
    ["GET", "/api/profiles", "profile:read", false, false],
    ["PATCH", "/api/profiles", "profile:write", false, false],
    ["PUT", "/api/profiles", "profile:write", false, false],
    ["DELETE", "/api/profiles", "profile:write", false, false],
    ["PATCH", "/api/projects/[id]/classification", "tor:write", false, true],
    ["GET", "/api/projects/[id]", "tor:read", true, false],
    ["GET", "/api/projects", "tor:read", true, false],
    ["GET", "/api/scraping/status", "pipeline:read", false, false],
    ["POST", "/api/scraping/trigger", "pipeline:trigger", false, false],
    ["GET", "/api/test-db", "admin:read", false, true],
    ["GET", "/api/tors/[id]/anomalies", "tor:read", true, false],
    ["POST", "/api/tors/[id]/proposal-draft", "profile:read", false, false],
    ["GET", "/api/tors/[id]/proposal-draft", "profile:read", false, false],
    ["GET", "/api/tors/[id]", "tor:read", true, false],
    ["GET", "/api/tors/[id]/summary", "tor:read", true, false],
    ["GET", "/api/tors/facets", "tor:read", true, false],
    ["GET", "/api/tors", "tor:read", true, false],
].map(([method, path, scope, publicRoute, admin]) => ({ method, path, scope, public: publicRoute, admin }));
afterEach(() => vi.unstubAllEnvs());

it.each(routes)('$method $path preserves guest/user/admin boundaries at both guards', async row => {
    const permission = permissionFor(row.path, row.method);
    expect(permission.scope ?? null).toBe(row.scope);
    expect(Boolean(permission.admin)).toBe(row.admin);
    expect(Boolean(permission.public)).toBe(row.public);
    const realPath = row.path.replace('[id]', 'fixture').replace('[projectId]', 'fixture');
    const guarded = withRouteSecurity(() => NextResponse.json({ ok: true }), row.path, row.method);
    const cases = [
        [null, row.public ? 200 : 401],
        [{ sub: 'user-fixture', role: 'user' }, row.admin || row.scope?.startsWith('pipeline:') ? 403 : 200],
        [{ sub: 'admin-fixture', role: 'admin' }, 200],
        [{ sub: 'limited-admin', role: 'admin', scopes: [] }, row.scope ? 403 : 200],
    ];
    for (const [claims, status] of cases) {
        const headers = { Origin: 'http://localhost:3000' };
        if (claims) headers.Authorization = `Bearer ${await signSession(claims)}`;
        const req = () => new NextRequest(`http://localhost:3000${realPath}`, { method: row.method, headers });
        expect((await proxy(req())).status).toBe(status);
        expect((await guarded(req())).status).toBe(status);
    }
});
