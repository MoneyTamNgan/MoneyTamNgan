import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/models/Project', () => ({
    default: {
        aggregate: vi.fn(async () => [{
            project_id: '69010000001', project_name: 'ระบบสารบรรณ', dept_name: 'สำนักการคลัง',
            budget: 1500000, timeline: { announce_date: new Date('2026-01-05T00:00:00Z') },
        }]),
    },
}));

const { GET } = await import('./route');
const request = query => new Request(`http://localhost/api/analytics/export${query}`);

describe('GET /api/analytics/export', () => {
    it('downloads CSV as an attachment', async () => {
        const response = await GET(request('?format=csv&category=software'));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
        expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="tor-projects-\d{4}-\d{2}-\d{2}\.csv"$/);
        expect(response.headers.get('x-export-truncated')).toBe('false');
        expect(await response.text()).toContain('69010000001,ระบบสารบรรณ,สำนักการคลัง,,1500000');
    });

    it('downloads JSON rows', async () => {
        const response = await GET(request('?format=json'));
        expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(await response.json()).toEqual([expect.objectContaining({ id: '69010000001', budget: 1500000 })]);
    });

    it('rejects a missing format or invalid filter', async () => {
        expect((await (await GET(request(''))).json()).error.code).toBe('INVALID_FORMAT');
        expect((await (await GET(request('?format=csv&category=x'))).json()).error.code).toBe('INVALID_CATEGORY');
    });
});
