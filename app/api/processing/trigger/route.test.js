import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/lib/job-queue', () => ({ enqueueProject: vi.fn(async () => ({ job: { _id: 'job', status: 'queued' }, reused: false })) }));
vi.mock('@/lib/processing-recovery', () => ({ recoverPendingProjects: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: { exists: vi.fn(async () => true) } }));
vi.mock('@/models/DiscoveryCandidate', () => ({ default: { exists: vi.fn(async () => true) } }));
const { POST } = await import('./route');
const { recoverPendingProjects } = await import('@/lib/processing-recovery');
const { enqueueProject } = await import('@/lib/job-queue');
const request = body => new Request('http://localhost/api/processing/trigger', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => vi.resetAllMocks());
it('bulk processing uses shared recovery selection and exposes its cursor and reasons', async () => {
    recoverPendingProjects.mockResolvedValue({ queued: 1, reused: 0, jobs: [], skipped: { closed_procurement: 2 }, nextAfterId: 'cursor' });
    const response = await POST(request({ batchSize: 5 }));
    expect(response.status).toBe(202);
    expect(recoverPendingProjects).toHaveBeenCalledWith({ batchSize: 5, scanLimit: 100, afterId: null, dryRun: false, retryFailed: false });
    expect((await response.json()).skipped.closed_procurement).toBe(2);
});
it('passes dry-run and continuation through unchanged', async () => {
    recoverPendingProjects.mockResolvedValue({ queued: 0, wouldQueue: 3 });
    await POST(request({ dryRun: true, afterId: 'cursor', scanLimit: 240 }));
    expect(recoverPendingProjects.mock.calls[0][0]).toMatchObject({ dryRun: true, afterId: 'cursor', scanLimit: 240 });
    expect(enqueueProject).not.toHaveBeenCalled();
});
it('invalid recovery options return 400 rather than a pipeline failure', async () => {
    recoverPendingProjects.mockRejectedValue(new TypeError('Invalid cursor'));
    expect((await POST(request({ afterId: 'bad' }))).status).toBe(400);
});
it('never silently queues a single project when a caller requested a bulk-only dry-run', async () => {
    expect((await POST(request({ projectId: 'project', dryRun: true }))).status).toBe(400);
    expect(enqueueProject).not.toHaveBeenCalled();
});
