import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/lib/keywords', () => ({ loadKeywordSets: vi.fn(async () => ({})) }));
vi.mock('@/lib/egp-api', async importOriginal => ({ ...await importOriginal(), fetchAllFromEGP: vi.fn() }));
vi.mock('@/lib/procurement-eligibility', async importOriginal => ({ ...await importOriginal(), verifyProcurementEligibility: vi.fn() }));
vi.mock('@/lib/job-queue', () => ({ enqueueProject: vi.fn(async () => ({ reused: false })) }));
vi.mock('@/models/Project', () => ({ default: { exists: vi.fn(async () => false), findOneAndUpdate: vi.fn() } }));
const { POST } = await import('./route');
const { fetchAllFromEGP } = await import('@/lib/egp-api');
const { verifyProcurementEligibility } = await import('@/lib/procurement-eligibility');
const { enqueueProject } = await import('@/lib/job-queue');
const { default: Project } = await import('@/models/Project');
beforeEach(() => vi.clearAllMocks());
it('only writes and queues verified open software; reports skipped records without storing them', async () => {
    fetchAllFromEGP.mockResolvedValue([
        ['open', 'พัฒนาระบบสารสนเทศ'], ['closed', 'พัฒนาระบบสารสนเทศ'],
        ['unknown', 'พัฒนาระบบสารสนเทศ'], ['not_yet_open', 'พัฒนาระบบสารสนเทศ'],
        ['nonsoft', 'ก่อสร้างอาคาร'], ['uncertain', 'รายการทดสอบ'],
    ].map(([project_id, project_name]) => ({ project_id, project_name, dept_name: 'Agency', project_money: '100' })));
    verifyProcurementEligibility.mockImplementation(async record => ({ status: record.project_id, reason: 'Fixture' }));
    const response = await POST(new Request('http://localhost/api/ingestion/trigger', {
        method: 'POST', body: JSON.stringify({ year: '2570', limit: 6, enqueueProcessing: true }),
    }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.itemsFound).toBe(6);
    expect(body.itemsNew).toBe(1);
    expect(body.jobsQueued).toBe(1);
    expect(body.skipped).toEqual({ notSoftware: 1, uncertainSoftware: 1, closed: 1, notYetOpen: 1, unverified: 1 });
    expect(Project.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Project.findOneAndUpdate.mock.calls[0][1].$set.procurement_eligibility.status).toBe('open');
    expect(enqueueProject).toHaveBeenCalledWith('open');
    expect(verifyProcurementEligibility).toHaveBeenCalledTimes(4);
});
it('defaults discovery to current Thai fiscal year, not historical 2568', async () => {
    fetchAllFromEGP.mockResolvedValue([]);
    const response = await POST(new Request('http://localhost/api/ingestion/trigger', { method: 'POST' }));
    expect(response.status).toBe(202);
    const { currentThaiFiscalYear } = await import('@/lib/procurement-eligibility');
    expect(fetchAllFromEGP.mock.calls[0][0].year).toBe(currentThaiFiscalYear());
});
