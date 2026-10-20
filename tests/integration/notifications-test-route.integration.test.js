import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn() };

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieStore) }));
vi.mock('@/lib/db', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({
    SESSION_COOKIE: 'mtn_session',
    verifySession: vi.fn(async () => null),
}));
vi.mock('@/lib/email', () => ({
    sendMatchNotificationEmail: vi.fn(),
}));

const fakeUser = {
    _id: 'user-1',
    email: 'contractor@example.com',
    name: 'Somchai Tech',
    company_name: 'Somchai Dev Co',
};

vi.mock('@/models/User', () => ({
    User: {
        findById: vi.fn(() => ({ lean: async () => fakeUser })),
    },
}));

const { verifySession } = await import('@/lib/auth');
const { User } = await import('@/models/User');
const { sendMatchNotificationEmail } = await import('@/lib/email');
const { POST } = await import('@/app/api/notifications/test/route');

function requestWithBody(body) {
    return { headers: { get: () => null }, json: async () => body };
}

const authedRequest = { headers: { get: () => null }, json: async () => ({}) };

beforeEach(() => {
    vi.clearAllMocks();
    cookieStore.get.mockReturnValue({ value: 'valid-token' });
    vi.mocked(verifySession).mockResolvedValue({ sub: 'user-1' });
    vi.mocked(User.findById).mockReturnValue({ lean: async () => fakeUser });
    vi.mocked(sendMatchNotificationEmail).mockResolvedValue({ id: 'email-msg-999' });
});

describe('POST /api/notifications/test', () => {
    it('returns 401 when there is no valid session', async () => {
        vi.mocked(verifySession).mockResolvedValue(null);
        const response = await POST(authedRequest);
        expect(response.status).toBe(401);
    });

    it('returns 404 when user is not found', async () => {
        vi.mocked(User.findById).mockReturnValue({ lean: async () => null });
        const response = await POST(authedRequest);
        expect(response.status).toBe(404);
    });

    it('sends default sample match email to user when matches are omitted', async () => {
        const response = await POST(authedRequest);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe('success');
        expect(body.sentTo).toBe('contractor@example.com');
        expect(body.emailId).toBe('email-msg-999');

        expect(sendMatchNotificationEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'contractor@example.com',
                userName: 'Somchai Tech',
                matches: expect.arrayContaining([
                    expect.objectContaining({ torId: 'TEST-001' }),
                    expect.objectContaining({ torId: 'TEST-002' }),
                ]),
            })
        );
    });

    it('sends custom matches payload when provided in body', async () => {
        const customMatches = [
            {
                torId: 'CUSTOM-001',
                title: 'โครงการทดสอบพิเศษ',
                agency: 'สำนักงบประมาณ',
                budget: 1000000,
                matchScore: 95,
            },
        ];
        const req = requestWithBody({ matches: customMatches });
        const response = await POST(req);
        expect(response.status).toBe(200);

        expect(sendMatchNotificationEmail).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'contractor@example.com',
                matches: customMatches,
            })
        );
    });

    it('returns 500 when email delivery fails', async () => {
        vi.mocked(sendMatchNotificationEmail).mockResolvedValue(null);
        const response = await POST(authedRequest);
        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error).toContain('Failed to send email');
    });
});
