import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: { aggregate: vi.fn() } }));
const { default: Project } = await import('@/models/Project');
const { GET } = await import('./route');
const request = (query) => new Request(`http://localhost/api/analytics/overview/export?${query}`);

beforeEach(() => vi.clearAllMocks());

describe('overview exports retain the public export safeguards', () => {
    it('escapes spreadsheet formulas and includes bidding fields', async () => {
        Project.aggregate.mockResolvedValue([{ project_id: '123', project_name: '=HYPERLINK("bad")',
            tender: { submission_start_time: '09:00', submission_end_time: '12:00' },
            analyticsBiddingStatus: 'open', analyticsDocumentReadiness: 'tor_ready' }]);
        const response = await GET(request('format=csv&isSoftware=true'));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('x-export-truncated')).toBe('false');
        const csv = await response.text();
        expect(csv).toContain("'=HYPERLINK");
        expect(csv).toContain('"09:00","12:00"');
        expect(Project.aggregate.mock.calls[0][0]).toContainEqual({ $limit: 10001 });
    });

    it('caps the download and reports truncation without changing its JSON array shape', async () => {
        Project.aggregate.mockResolvedValue(Array.from({ length: 10001 }, (_, i) => ({ project_id: String(i) })));
        const response = await GET(request('format=json'));
        expect(response.headers.get('x-export-truncated')).toBe('true');
        expect(await response.json()).toHaveLength(10000);
    });

    it('rejects an invalid filter before reading the database', async () => {
        const response = await GET(request('format=csv&biddingStatus=bad'));
        expect(response.status).toBe(400);
        expect(Project.aggregate).not.toHaveBeenCalled();
    });
});
