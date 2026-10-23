import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: { find: vi.fn() } }));
vi.mock('@/lib/keywords', () => ({ loadKeywordSets: vi.fn(async () => ({})) }));
vi.mock('@/lib/job-queue', () => ({ enqueueProject: vi.fn() }));
const { POST } = await import('./route');
const { default: Project } = await import('@/models/Project');
const { enqueueProject } = await import('@/lib/job-queue');
const record = (id, title) => ({ project_id: id, project_name: title, processing: {}, workflow: {},
    toObject() { return { project_name: title }; }, save: vi.fn(async () => {}) });
beforeEach(() => { vi.clearAllMocks(); enqueueProject.mockReset(); enqueueProject.mockResolvedValue({ reused: false }); });
it('admin software classification queues processing, but non-software and uncertain records do not', async () => {
    Project.find.mockResolvedValue([record('yes', 'พัฒนาระบบสารสนเทศ'), record('no', 'ก่อสร้างอาคาร'), record('unknown', 'รายการทดสอบ')]);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scanned: 3, updated: 2, remaining: 1, jobsQueued: 1, jobsReused: 0, queueFailures: 0 });
    expect(enqueueProject).toHaveBeenCalledExactlyOnceWith('yes');
    expect(Project.find).toHaveBeenCalledWith({ is_software: null, 'classification.status': { $ne: 'manual_override' } });
});
it('one queue failure does not stop other newly-classified software projects', async () => {
    Project.find.mockResolvedValue([record('first', 'พัฒนาระบบสารสนเทศ'), record('second', 'พัฒนาระบบสารสนเทศ')]);
    enqueueProject.mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValueOnce({ reused: true });
    const response = await POST();
    expect(await response.json()).toMatchObject({ updated: 2, jobsReused: 1, queueFailures: 1,
        queueErrors: [{ projectId: 'first' }] });
});
