import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = {
    get: vi.fn(),
    delete: vi.fn(),
    set: vi.fn(),
};

vi.mock('next/headers', () => ({
    cookies: vi.fn(async () => cookieStore),
}));

vi.mock('@/lib/mongodb', () => ({
    connectToDatabase: vi.fn().mockResolvedValue(undefined),
}));

const mockUser = {
    _id: '6a957e81953ea8a3edde5199',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin',
};

vi.mock('@/models/User', () => ({
    User: {
        findOneAndUpdate: vi.fn(),
    },
    default: {
        findOneAndUpdate: vi.fn(),
    },
}));

// Mock global fetch for Google OAuth endpoints
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { User } = await import('@/models/User');
const { GET } = await import('@/app/api/auth/google/callback/route');
const { verifySession } = await import('@/lib/auth');

describe('Google OAuth Callback - Admin Auto-Promotion & Default Dashboard Redirect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.JWT_SECRET = 'ci-jwt-secret-key-for-test-32chars!!';
        process.env.GOOGLE_CLIENT_ID = 'test-client-id';
        process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
        process.env.NEXT_PUBLIC_REDIRECT_URI = 'http://localhost:3000/api/auth/google/callback';
        process.env.ADMIN_EMAILS = 'admin@example.com,admin2@bangkok.go.th';

        // Setup oauth state cookie matching state param
        cookieStore.get.mockReturnValue({ value: 'valid-state|/dashboard' });
    });

    it('promotes user in ADMIN_EMAILS to admin role and redirects to /dashboard by default', async () => {
        // 1. Mock token exchange
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: 'google-access-token-123' }),
        });

        // 2. Mock google profile fetch
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: '101665045470883854654',
                email: 'admin@example.com',
                name: 'Admin User',
                picture: 'https://example.com/pic.jpg',
            }),
        });

        // 3. Mock DB findOneAndUpdate
        User.findOneAndUpdate.mockResolvedValueOnce({
            ...mockUser,
            role: 'admin',
        });

        const req = new Request('http://localhost:3000/api/auth/google/callback?code=mock-code&state=valid-state');
        const res = await GET(req);

        // Verify redirect to /dashboard
        expect(res.status).toBe(307);
        const location = res.headers.get('location');
        expect(location).toBe('http://localhost:3000/dashboard');

        // Verify DB update included role: 'admin'
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            { email: 'admin@example.com' },
            {
                $set: expect.objectContaining({
                    role: 'admin',
                    name: 'Admin User',
                    googleId: '101665045470883854654',
                }),
            },
            { upsert: true, new: true }
        );

        // Verify session cookie was set with admin role
        const sessionCookie = res.cookies.get('mtn_session');
        expect(sessionCookie).toBeTruthy();
        const payload = await verifySession(sessionCookie.value);
        expect(payload.role).toBe('admin');
        expect(payload.email).toBe('admin@example.com');
    });

    it('respects an explicit next parameter such as /admin', async () => {
        cookieStore.get.mockReturnValue({ value: 'valid-state|/admin' });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: 'token-abc' }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: '101665045470883854654',
                email: 'admin@example.com',
                name: 'Admin User',
            }),
        });
        User.findOneAndUpdate.mockResolvedValueOnce({
            ...mockUser,
            role: 'admin',
        });

        const req = new Request('http://localhost:3000/api/auth/google/callback?code=mock-code&state=valid-state');
        const res = await GET(req);

        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toBe('http://localhost:3000/admin');
    });

    it('does not set role: admin for non-admin users', async () => {
        cookieStore.get.mockReturnValue({ value: 'valid-state|' });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: 'token-xyz' }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                id: '999999999',
                email: 'regular.contractor@example.com',
                name: 'Regular Contractor',
            }),
        });
        User.findOneAndUpdate.mockResolvedValueOnce({
            _id: 'user-2',
            email: 'regular.contractor@example.com',
            name: 'Regular Contractor',
            role: 'user',
        });

        const req = new Request('http://localhost:3000/api/auth/google/callback?code=mock-code&state=valid-state');
        const res = await GET(req);

        // Verify DB update did NOT include role
        const updateArg = User.findOneAndUpdate.mock.calls[0][1].$set;
        expect(updateArg.role).toBeUndefined();

        // Redirects to /dashboard by default
        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toBe('http://localhost:3000/dashboard');

        // Session token has role: user
        const sessionCookie = res.cookies.get('mtn_session');
        const payload = await verifySession(sessionCookie.value);
        expect(payload.role).toBe('user');
    });
});
