import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/models/Project', () => ({ default: { aggregate: vi.fn() } }));

const { GET } = await import('./route');
const { default: Project } = await import('@/models/Project');

function requestFor(query = '') {
    return new Request(`http://localhost/api/analytics/overview${query}`);
}

describe('GET /api/analytics/overview', () => {
    it('returns dashboard-ready metrics, charts, facets, and a page of TORs', async () => {
        Project.aggregate
            .mockResolvedValueOnce([{
                metrics: [{ totalTors: 1, totalBudget: 3000, openForBidding: 1, openBudget: 3000, closingSoon: 0 }],
                fiscalYearTrend: [{ _id: 2569, count: 1, totalBudget: 3000 }],
                projectLength: [{ _id: 'one', count: 1, totalBudget: 3000 }],
                biddingStatus: [{ _id: 'open', count: 1, totalBudget: 3000 }],
                closingWindow: [{ _id: 'within_7d', count: 1, totalBudget: 3000 }],
                documentReadiness: [{ _id: 'announcement_only', count: 1, totalBudget: 3000 }],
                topAgencies: [{ _id: 'หน่วยงานตัวอย่าง', count: 1, totalBudget: 3000 }],
                total: [{ count: 1 }],
                data: [{
                    project_id: '66089621504', project_name: 'โครงการตัวอย่าง', dept_name: 'หน่วยงานตัวอย่าง',
                    project_status: 'ระหว่างดำเนินการ', is_software: true,
                    timeline: { announce_date: new Date('2026-09-01') },
                    analyticsBudget: 3000, analyticsBidCloseAt: new Date('2026-10-08T05:00:00.000Z'),
                    analyticsFiscalYear: 2570, analyticsBiddingStatus: 'open', analyticsProjectLength: 1,
                    analyticsDocumentReadiness: 'announcement_only',
                }],
            }])
            .mockResolvedValueOnce([{ agencies: [{ _id: 'หน่วยงานตัวอย่าง', count: 1 }], fiscalYears: [{ _id: 2570, count: 1 }] }]);

        const response = await GET(requestFor('?isSoftware=true&limit=10'));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({ status: 'success', total: 1, page: 1, limit: 10 });
        expect(body.data[0]).toMatchObject({ id: '66089621504', fiscalYear: 2570, biddingStatus: 'open', documentReadiness: 'announcement_only' });
        expect(body.charts.projectLength[0]).toMatchObject({ key: 'one', label: '1 ปีงบประมาณ' });
        expect(body.charts.closingWindow[0]).toMatchObject({ key: 'within_7d', label: 'ปิดรับภายใน 7 วัน' });
        expect(body.dataQuality.biddingStatus).toContain('submission_schedule');
    });

    it('rejects invalid filters before querying MongoDB', async () => {
        Project.aggregate.mockClear();
        const response = await GET(requestFor('?biddingStatus=waiting'));
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_BIDDING_STATUS');
        expect(Project.aggregate).not.toHaveBeenCalled();
    });
});
