import { expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ default: vi.fn(async () => {}) }));
vi.mock('@/lib/keywords', () => ({ loadKeywordSets: vi.fn(async () => ({})) }));
vi.mock('@/lib/egp-rss', async original => ({ ...await original(), collectOpenTenders: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: { updateOne: vi.fn(async () => {}), findOne: vi.fn() } }));
vi.mock('@/lib/processing-pipeline', () => ({ processProject: vi.fn(async () => ({ status: 'completed' })) }));
vi.mock('@/lib/services/notification-service', () => ({ notifyUsersOfMatchingTors: vi.fn(async () => ({ notified: 2 })) }));
vi.mock('@/lib/tender-acquisition', () => ({ createAcquisitionContext: vi.fn(() => ({})), closeAcquisitionContext: vi.fn(async () => {}), acquireTenderDocuments: vi.fn() }));
const { runPipeline } = await import('@/lib/services/pipeline-runner');
const { collectOpenTenders } = await import('@/lib/egp-rss');
const { default: Project } = await import('@/models/Project');
const { processProject } = await import('@/lib/processing-pipeline');
const { notifyUsersOfMatchingTors } = await import('@/lib/services/notification-service');
const { closeAcquisitionContext } = await import('@/lib/tender-acquisition');
const { SCHEDULE_VERSION } = await import('@/lib/announcement-schedule');

it('keeps discovery, acquisition, processing and notification in the real pipeline executor', async () => {
    const project = { _id: 'fixture', project_id: '69000000001', primary_document_id: 'tor', announcement_document_id: 'announcement',
        classification: { status: 'manual_override' }, is_software: true,
        announcement_schedule: { status: 'parsed', parser_version: SCHEDULE_VERSION } };
    Project.findOne.mockReturnValue({ lean: async () => project });
    collectOpenTenders.mockResolvedValue([{ projectId: project.project_id, title: 'Software project' }]);
    const phases = [];
    const summary = await runPipeline({ limit: 1 }, async patch => { if (patch.phase) phases.push(patch.phase); });
    expect(phases).toEqual(['discovery', 'acquisition', 'processing', 'notification']);
    expect(collectOpenTenders).toHaveBeenCalledOnce();
    expect(processProject).toHaveBeenCalledWith(project.project_id, expect.any(Object));
    expect(notifyUsersOfMatchingTors).toHaveBeenCalledWith([project]);
    expect(summary).toMatchObject({ discovered: 1, candidates: 1, processed: 1, notified: 2 });
    expect(closeAcquisitionContext).toHaveBeenCalledOnce();
});
