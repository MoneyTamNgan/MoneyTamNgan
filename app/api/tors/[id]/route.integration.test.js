import { describe, expect, it, vi } from 'vitest';
import { mockProjectRecords } from '@/lib/mock-project-records';

const knownProject = mockProjectRecords.find((p) => p.project_id === 'DGA-2563-07-10');

vi.mock('@/lib/db', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/models/Project', () => ({
    default: {
        findOne: vi.fn(({ project_id }) => ({
            lean: async () => (project_id === knownProject.project_id ? knownProject : null),
        })),
    },
}));

const { GET } = await import('./route');

describe('GET /api/tors/[id]', () => {
    it('returns the TOR detail for a known id', async () => {
        const response = await GET(null, { params: Promise.resolve({ id: knownProject.project_id }) });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe(knownProject.project_id);
        expect(body.requirements).toEqual(knownProject.extracted_data.qualifications);
    });

    it('returns 404 TOR_NOT_FOUND for an unknown id', async () => {
        const response = await GET(null, { params: Promise.resolve({ id: 'does-not-exist' }) });
        expect(response.status).toBe(404);
        expect((await response.json()).error.code).toBe('TOR_NOT_FOUND');
    });

    it('returns 400 INVALID_TOR_ID for a blank id, without querying the database', async () => {
        const response = await GET(null, { params: Promise.resolve({ id: '   ' }) });
        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_TOR_ID');
    });
});
