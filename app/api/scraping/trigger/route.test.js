import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/lib/keywords', () => ({ loadKeywordSets: vi.fn(async () => ({})) }));
vi.mock('@/lib/procurement-eligibility', () => ({ verifySoftwareProcurement: vi.fn(async () => ({ allowed: false, reason: 'Closed' })) }));
vi.mock('@/lib/scraper', async importOriginal => ({ ...await importOriginal(), scrapeProjectTOR: vi.fn(), scrapeBatch: vi.fn() }));
vi.mock('@/models/Project', () => ({ default: {
    findOne: vi.fn(() => ({ lean: async () => ({ project_id: '123456' }) })),
    find: vi.fn(() => ({ select: () => ({ limit: () => ({ lean: async () => [{ project_id: '123456' }] }) }) })),
} }));
const { POST } = await import('./route');
const { scrapeProjectTOR, scrapeBatch } = await import('@/lib/scraper');
beforeEach(() => vi.clearAllMocks());
for (const body of [{ projectId: '123456' }, { batchSize: 1 }]) {
    it(`scraping trigger cannot bypass closed-project gate in ${body.projectId ? 'single' : 'batch'} mode`, async () => {
        const response = await POST(new Request('http://localhost/api/scraping/trigger', {
            method: 'POST', body: JSON.stringify(body),
        }));
        expect(response.status).toBe(200);
        expect(scrapeProjectTOR).not.toHaveBeenCalled();
        expect(scrapeBatch).not.toHaveBeenCalled();
        const result = await response.json();
        if (body.projectId) expect(result.status).toBe('skipped');
        else expect(result.summary.skipped).toBe(1);
    });
}
