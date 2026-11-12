import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn(), delete: vi.fn() };

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));
vi.mock('@/lib/db', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', async importOriginal => ({
    ...await importOriginal(),
    SESSION_COOKIE: 'mtn_session',
    verifySession: vi.fn(async () => null),
}));

const fakeUser = {
    _id: 'user-1',
    email: 'contractor@example.com',
    name: 'Ada',
    company_name: 'Acme',
    skills: ['React'],
    techStack: ['React'],
    registered_capital: 1_000_000,
    highest_past_project_value: null,
    concurrent_project_capacity: 3,
    certifications: [],
    email_notifications_enabled: false,
    match_score_threshold: 70,
    updatedAt: '2026-09-01T00:00:00.000Z',
};

vi.mock('@/models/User', () => ({
    User: {
        findById: vi.fn(() => ({ select: () => ({ lean: async () => fakeUser }) })),
        findByIdAndUpdate: vi.fn(() => ({ select: () => ({ lean: async () => fakeUser }) })),
        findByIdAndDelete: vi.fn().mockResolvedValue(fakeUser),
    },
}));

vi.mock('@/models/BidPrepDraft', () => ({
    BidPrepDraft: {
        deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        countDocuments: vi.fn().mockResolvedValue(0),
    },
}));

const { verifySession } = await import('@/lib/auth');
const { User } = await import('@/models/User');
const { BidPrepDraft } = await import('@/models/BidPrepDraft');
const { GET, PATCH, DELETE } = await import('@/app/api/profiles/route');

function requestWithBody(body) {
    return { headers: { get: name => name === 'origin' ? 'http://localhost:3000' : null }, json: async () => body };
}

const authedRequest = { headers: { get: name => name === 'origin' ? 'http://localhost:3000' : null }, json: async () => ({}) };

beforeEach(() => {
    cookieStore.get.mockReturnValue({ value: 'valid-token' });
    vi.mocked(verifySession).mockResolvedValue({ sub: 'user-1', role: 'user', scopes: ['profile:read', 'profile:write'] });
});

describe('GET /api/profiles', () => {
    it('returns 401 when there is no valid session', async () => {
        vi.mocked(verifySession).mockResolvedValue(null);
        const response = await GET(authedRequest);
        expect(response.status).toBe(401);
    });

    it('returns the mapped profile for an authenticated user', async () => {
        const response = await GET(authedRequest);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toEqual({ status: 'success', data: expect.objectContaining({ _id: 'user-1', email: fakeUser.email }) });
    });

    it('returns 404 when the session is valid but the user no longer exists', async () => {
        vi.mocked(User.findById).mockReturnValueOnce({ select: () => ({ lean: async () => null }) });
        const response = await GET(authedRequest);
        expect(response.status).toBe(404);
    });
});

describe('PATCH /api/profiles', () => {
    it('rejects unauthenticated requests before touching the database', async () => {
        vi.mocked(verifySession).mockResolvedValue(null);
        const response = await PATCH(requestWithBody({ company_name: 'New Co' }));
        expect(response.status).toBe(401);
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('updates and returns the profile for a valid body', async () => {
        const response = await PATCH(requestWithBody({ company_name: 'New Co', match_score_threshold: 80 }));
        expect(response.status).toBe(200);
        expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
            'user-1',
            { $set: expect.objectContaining({ company_name: 'New Co', match_score_threshold: 80 }) },
            { new: true, runValidators: true },
        );
    });
});

describe('DELETE /api/profiles', () => {
    it('deletes the account and clears the session cookie', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const response = await DELETE(authedRequest);
        expect(response.status).toBe(200);
        expect(BidPrepDraft.deleteMany).toHaveBeenCalledWith({ userId: 'user-1' });
        expect(BidPrepDraft.countDocuments).toHaveBeenCalledWith({ userId: 'user-1' });
        expect(User.findByIdAndDelete).toHaveBeenCalledWith('user-1');
        expect(cookieStore.delete).toHaveBeenCalledWith('mtn_session');
        const audit = warn.mock.calls.map(call => String(call[0])).find(line => line.includes('bid_prep_data_deleted'));
        expect(JSON.parse(audit)).toMatchObject({ event: 'bid_prep_data_deleted', userId: 'user-1', scope: 'account' });
        expect(JSON.parse(audit).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        warn.mockRestore();
    });

    it('rate limits authenticated profile reads', async () => {
        vi.stubEnv('BID_PREP_PROFILE_PER_MINUTE', '1');
        vi.mocked(verifySession).mockResolvedValue({ sub: 'rate-limit-user', role: 'user', scopes: ['profile:read', 'profile:write'] });
        expect((await GET(authedRequest)).status).toBe(200);
        const again = await GET(authedRequest);
        expect(again.status).toBe(429);
        expect(again.headers.get('retry-after')).toBeTruthy();
        expect(await again.json()).toEqual({ error: { code: 'RATE_LIMITED', message: expect.stringMatching(/Too many requests/) } });
        vi.unstubAllEnvs();
    });

    it('returns 401 when unauthenticated', async () => {
        vi.mocked(verifySession).mockResolvedValue(null);
        const response = await DELETE(authedRequest);
        expect(response.status).toBe(401);
    });
});
