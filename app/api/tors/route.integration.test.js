import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockProjectRecords } from '@/lib/mock-project-records';

// No real DB: connectDB is a no-op, and Project.find/countDocuments return fixtures.
vi.mock('@/lib/db', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/models/Project', () => {
    function chain(records) {
        return {
            sort: () => chain(records),
            skip: (n) => chain(records.slice(n)),
            limit: (n) => chain(records.slice(0, n)),
            lean: async () => records,
        };
    }
    return {
        default: {
            find: vi.fn(() => chain(mockProjectRecords)),
            countDocuments: vi.fn().mockResolvedValue(mockProjectRecords.length),
        },
    };
});

const { GET } = await import('./route');

function requestFor(query) {
    return new Request(`http://localhost/api/tors${query}`);
}

describe('GET /api/tors', () => {
    it('returns a paginated list built from the (mocked) database', async () => {
        const response = await GET(requestFor('?page=1&limit=5'));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe('success');
        expect(body.page).toBe(1);
        expect(body.limit).toBe(5);
        expect(body.total).toBe(mockProjectRecords.length);
        expect(body.data).toHaveLength(5);
        expect(body.data[0]).toMatchObject({ id: mockProjectRecords[0].project_id });
    });

    it('rejects an invalid page parameter without touching the database', async () => {
        const response = await GET(requestFor('?page=0'));
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error.code).toBe('INVALID_PAGE');
    });

    it('rejects isSoftware values other than true/false', async () => {
        const response = await GET(requestFor('?isSoftware=maybe'));
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_IS_SOFTWARE');
    });

    it('rejects a dateFrom after dateTo', async () => {
        const response = await GET(requestFor('?dateFrom=2026-08-30&dateTo=2026-08-01'));
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_DATE_RANGE');
    });
});
