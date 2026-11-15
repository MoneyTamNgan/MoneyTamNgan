import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getContractorProfile, saveContractorProfile, deleteCompanyBidData, saveLocalContractorProfile, loadLocalContractorProfile } from '@/lib/services/contractor-profile-service';
const profile = { company_name: 'Test Co', registration_number: '123', address: 'Private address', authorized_signatory: 'Signatory',
    past_projects: [{ name: 'Work', client: 'Client', value: 100, year: 2569 }], skills: [], registered_capital: null,
    highest_past_project_value: null, concurrent_project_capacity: null, certifications: [], email_notifications_enabled: false, match_score_threshold: 70 as const };
const storage = new Map();
const fetchMock = vi.fn();
beforeEach(() => {
    storage.clear(); vi.clearAllMocks();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => storage.get(k), setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('shows API validation errors without caching a rejected save', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Correct year', fields: { 'past_projects.0.year': 'Invalid year' } } }), { status: 400 }));
    await expect(saveContractorProfile(profile)).rejects.toMatchObject({ fields: { 'past_projects.0.year': 'Invalid year' } });
    expect(storage.size).toBe(0);
});
it('round trips remote bid fields but keeps bid identity out of browser cache', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: profile }), { status: 200 }));
    const saved = await saveContractorProfile(profile);
    expect(saved.profile.past_projects).toEqual(profile.past_projects);
    const reload = await getContractorProfile(); expect(reload.profile.address).toBe(profile.address);
    expect([...storage.values()].join('')).not.toContain('Private address');
    expect(loadLocalContractorProfile()?.past_projects).toEqual([]);
});
it('does not report a successful save when offline or unauthenticated', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(saveContractorProfile(profile)).rejects.toThrow('not been saved');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(saveContractorProfile(profile)).rejects.toThrow('sign in');
});
it('company deletion clears the cache after confirmed server deletion', async () => {
    saveLocalContractorProfile(profile);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await deleteCompanyBidData()).toBe(true);
    expect(loadLocalContractorProfile()).toMatchObject({ company_name: '', address: '', past_projects: [] });
});
