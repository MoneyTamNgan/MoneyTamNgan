import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
    default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/models/Project', () => ({
    default: {
        countDocuments: vi.fn().mockResolvedValue(42),
        findOne: vi.fn(),
        updateOne: vi.fn(),
    },
}));

vi.mock('@/lib/keywords', () => ({
    loadKeywordSets: vi.fn().mockResolvedValue({
        softwareKeywords: ['ซอฟต์แวร์', 'โปรแกรม', 'erp'],
        nonSoftwareKeywords: ['ก่อสร้าง'],
    }),
}));

const { GET: getStatusRoute, DELETE: deleteStatusRoute } = await import(
    '@/app/api/admin/pipeline/status/route'
);
const { POST: postTriggerRoute } = await import(
    '@/app/api/admin/pipeline/trigger/route'
);
const { resetStatus, getStatus } = await import(
    '@/lib/services/pipeline-runner'
);

describe('Admin Pipeline API Endpoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStatus();
    });

    it('GET /api/admin/pipeline/status returns initial idle status', async () => {
        const res = await getStatusRoute();
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.status).toBe('ok');
        expect(data.run).toBeDefined();
        expect(data.run.status).toBe('idle');
        expect(data.run.phase).toBe('idle');
        expect(data.dbStats).toEqual({ totalProjects: 42, withSummary: 42 });
    });

    it('POST /api/admin/pipeline/trigger validates request body parameters', async () => {
        // Invalid limit
        const badLimitReq = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ limit: -1 }),
        });
        const badLimitRes = await postTriggerRoute(badLimitReq);
        expect(badLimitRes.status).toBe(400);
        const badLimitData = await badLimitRes.json();
        expect(badLimitData.error.code).toBe('INVALID_PIPELINE_REQUEST');

        // Invalid limit exceeding max
        const overflowLimitReq = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ limit: 999 }),
        });
        const overflowLimitRes = await postTriggerRoute(overflowLimitReq);
        expect(overflowLimitRes.status).toBe(400);

        // Invalid depts
        const badDeptsReq = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ depts: 'not-an-array' }),
        });
        const badDeptsRes = await postTriggerRoute(badDeptsReq);
        expect(badDeptsRes.status).toBe(400);
    });

    it('POST /api/admin/pipeline/trigger starts background run and returns 202 Accepted', async () => {
        const req = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ limit: 5 }),
        });

        const res = await postTriggerRoute(req);
        expect(res.status).toBe(202);

        const data = await res.json();
        expect(data.status).toBe('accepted');
        expect(data.runId).toMatch(/^pipe_\d+/);
        expect(data.statusUrl).toBe('/api/admin/pipeline/status');
        expect(data.run.status).toBe('running');

        // Verify status endpoint reflects running state
        const statusCheck = getStatus();
        expect(statusCheck.status).toBe('running');
    });

    it('POST /api/admin/pipeline/trigger returns 409 Conflict if already running', async () => {
        // 1. First trigger starts running
        const firstReq = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ limit: 5 }),
        });
        const firstRes = await postTriggerRoute(firstReq);
        expect(firstRes.status).toBe(202);

        // 2. Second trigger should conflict
        const secondReq = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ limit: 5 }),
        });
        const secondRes = await postTriggerRoute(secondReq);
        expect(secondRes.status).toBe(409);

        const conflictData = await secondRes.json();
        expect(conflictData.status).toBe('conflict');
        expect(conflictData.error.code).toBe('PIPELINE_ALREADY_RUNNING');
    });

    it('DELETE /api/admin/pipeline/status resets state back to idle', async () => {
        // Start a run
        const req = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ limit: 5 }),
        });
        await postTriggerRoute(req);
        expect(getStatus().status).toBe('running');

        // Reset it
        const delRes = await deleteStatusRoute();
        expect(delRes.status).toBe(200);

        const data = await delRes.json();
        expect(data.status).toBe('ok');
        expect(data.run.status).toBe('idle');
        expect(getStatus().status).toBe('idle');
    });

    it('POST /api/admin/pipeline/trigger in sync mode returns 200 with completed results', async () => {
        // Test with empty project list in sync mode
        const req = new Request('http://localhost:3000/api/admin/pipeline/trigger', {
            method: 'POST',
            body: JSON.stringify({ limit: 1, tenders: [], sync: true }),
        });

        const res = await postTriggerRoute(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.status).toBe('completed');
        expect(data.summary).toBeDefined();
        expect(data.summary.discovered).toBe(0);
        expect(data.completedAt).toBeDefined();
    });
});
