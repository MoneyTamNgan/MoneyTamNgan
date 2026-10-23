import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: { findOneAndUpdate: vi.fn() } }));
vi.mock('@/lib/job-queue', () => ({ enqueueProject: vi.fn() }));
const { PATCH } = await import('@/app/api/projects/[id]/classification/route');
const { default: Project } = await import('@/models/Project');
const { enqueueProject } = await import('@/lib/job-queue');
const context = { params: Promise.resolve({ id: 'software-project' }) };
const request = body => new Request('http://localhost/api/projects/software-project/classification', {
    method: 'PATCH', body: JSON.stringify(body),
});
beforeEach(() => {
    vi.resetAllMocks();
    Project.findOneAndUpdate.mockReturnValue({ lean: async () => ({ project_id: 'software-project', is_software: true }) });
    enqueueProject.mockResolvedValue({ job: { _id: 'job' }, reused: false });
});
it('manual software approval immediately queues the existing pipeline and resets stale review workflow', async () => {
    const response = await PATCH(request({ isSoftware: true }), context);
    expect(response.status).toBe(200);
    expect(enqueueProject).toHaveBeenCalledWith('software-project');
    expect(Project.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
        is_software: true, 'classification.status': 'manual_override',
        'workflow.status': 'document_pending', 'processing.status': 'document_pending',
    });
    expect(await response.json()).toEqual({ project_id: 'software-project', is_software: true });
});
it('non-software rejection never enqueues processing', async () => {
    await PATCH(request({ isSoftware: false }), context);
    expect(enqueueProject).not.toHaveBeenCalled();
    expect(Project.findOneAndUpdate.mock.calls[0][1].$set['workflow.status']).toBe('irrelevant');
});
it('an already-active job is accepted without forcing re-extraction', async () => {
    enqueueProject.mockResolvedValue({ job: { _id: 'existing' }, reused: true });
    expect((await PATCH(request({ isSoftware: true }), context)).status).toBe(200);
    expect(enqueueProject).toHaveBeenCalledWith('software-project');
});
it('queue failure explicitly reports that the classification was saved and can be retried', async () => {
    enqueueProject.mockRejectedValue(new Error('queue unavailable'));
    const response = await PATCH(request({ isSoftware: true }), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ classificationSaved: true,
        error: { code: 'CLASSIFICATION_ENQUEUE_FAILED' } });
});
it('invalid approval and missing projects never enqueue work', async () => {
    expect((await PATCH(request({ isSoftware: 'yes' }), context)).status).toBe(400);
    Project.findOneAndUpdate.mockReturnValue({ lean: async () => null });
    expect((await PATCH(request({ isSoftware: true }), context)).status).toBe(404);
    expect(enqueueProject).not.toHaveBeenCalled();
});
