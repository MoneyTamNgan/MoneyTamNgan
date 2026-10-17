import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/lib/keywords', () => ({ loadKeywordSets: vi.fn(async () => ({})) }));
vi.mock('@/lib/egp-api', async importOriginal => ({ ...await importOriginal(), fetchAllFromEGP: vi.fn() }));
vi.mock('@/lib/procurement-eligibility', async importOriginal => ({ ...await importOriginal(), verifyProcurementEligibility: vi.fn() }));
vi.mock('@/lib/job-queue', () => ({ enqueueProject: vi.fn(async () => ({ reused: false })) }));
vi.mock('@/models/Project', () => ({ default: { findOne: vi.fn(() => ({ lean: async () => null })), exists: vi.fn(async () => false), findOneAndUpdate: vi.fn() } }));
vi.mock('@/models/DiscoveryCandidate', () => ({ default: { updateOne: vi.fn() } }));
const { POST } = await import('./route');
const { fetchAllFromEGP } = await import('@/lib/egp-api');
const { verifyProcurementEligibility } = await import('@/lib/procurement-eligibility');
const { enqueueProject } = await import('@/lib/job-queue');
const { default: Project } = await import('@/models/Project');
beforeEach(() => vi.clearAllMocks());
it('preserves a manual not-software override on metadata refresh', async () => {
    fetchAllFromEGP.mockResolvedValue([{ project_id: 'manual', project_name: 'พัฒนาระบบสารสนเทศ', dept_name: 'fixture' }]);
    verifyProcurementEligibility.mockResolvedValueOnce({ status: 'open' });
    Project.findOne.mockReturnValueOnce({ lean: async () => ({ is_software: false, classification: { status: 'manual_override' } }) });
    await POST(new Request('http://localhost/api/ingestion/trigger', { method: 'POST', body: JSON.stringify({ enqueueProcessing: true, verifyInline: true }) }));
    expect(Project.findOneAndUpdate.mock.calls[0][1].$set.is_software).toBeUndefined();
    expect(enqueueProject).not.toHaveBeenCalled();
});
it('only publishes verified open software, retaining unverified candidates outside projects', async () => {
    fetchAllFromEGP.mockResolvedValue([
        ['open', 'พัฒนาระบบสารสนเทศ'], ['closed', 'พัฒนาระบบสารสนเทศ'],
        ['unknown', 'พัฒนาระบบสารสนเทศ'], ['not_yet_open', 'พัฒนาระบบสารสนเทศ'],
        ['nonsoft', 'ก่อสร้างอาคาร'], ['uncertain', 'รายการทดสอบ'],
    ].map(([project_id, project_name]) => ({ project_id, project_name, dept_name: 'Agency', project_money: '100' })));
    verifyProcurementEligibility.mockImplementation(async record => ({ status: record.project_id, reason: 'Fixture' }));
    const response = await POST(new Request('http://localhost/api/ingestion/trigger', {
        method: 'POST', body: JSON.stringify({ year: '2570', limit: 6, enqueueProcessing: true, verifyInline: true }),
    }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.itemsFound).toBe(6);
    expect(body.itemsNew).toBe(1);
    expect(body.jobsQueued).toBe(2);
    expect(body.candidatesSaved).toBe(3);
    expect(body.skipped).toEqual({ notSoftware: 1, uncertainSoftware: 1, closed: 1, notYetOpen: 1, unverified: 1 });
    expect(Project.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Project.findOneAndUpdate.mock.calls[0][1].$set.procurement_eligibility.status).toBe('open');
    expect(enqueueProject).toHaveBeenCalledWith('open');
    expect(verifyProcurementEligibility).toHaveBeenCalledTimes(4);
});
it('default ingestion queues slow verification outside the HTTP request', async () => {
    fetchAllFromEGP.mockResolvedValue([{ project_id: 'pending', project_name: 'พัฒนาระบบสารสนเทศ' }]);
    const response = await POST(new Request('http://localhost/api/ingestion/trigger', { method: 'POST', body: JSON.stringify({ enqueueProcessing: true }) }));
    const body = await response.json();
    expect(body.candidatesSaved).toBe(1);
    expect(body.itemsNew).toBe(0);
    expect(verifyProcurementEligibility).not.toHaveBeenCalled();
    expect(enqueueProject).toHaveBeenCalledWith('pending', { type: 'verify_candidate' });
});
it('defaults discovery to current Thai fiscal year, not historical 2568', async () => {
    fetchAllFromEGP.mockResolvedValue([]);
    const response = await POST(new Request('http://localhost/api/ingestion/trigger', { method: 'POST' }));
    expect(response.status).toBe(202);
    const { currentThaiFiscalYear } = await import('@/lib/procurement-eligibility');
    expect(fetchAllFromEGP.mock.calls[0][0].year).toBe(currentThaiFiscalYear());
});
