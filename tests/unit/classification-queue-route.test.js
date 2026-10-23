import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { signSession, SESSION_COOKIE } from '@/lib/auth';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/lib/low-confidence-review', () => ({ listLowConfidenceTors: vi.fn() }));
const { GET } = await import('@/app/api/admin/classification/queue/route');
const { default: connectDB } = await import('@/lib/db');
const { listLowConfidenceTors } = await import('@/lib/low-confidence-review');
const request = (query = '', headers = {}) => new Request(`http://localhost/api/admin/classification/queue${query}`, { headers });
const token = 'review-fixture-token-'.repeat(3);
beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PIPELINE_ADMIN_TOKEN', token);
    listLowConfidenceTors.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0, threshold: 0.7, confidenceType: 'either' });
});
afterEach(() => vi.unstubAllEnvs());

it('denies anonymous, forged-role and invalid bearer requests before database access', async () => {
    for (const headers of [{}, { 'x-role': 'admin' }, { Authorization: 'Bearer invalid' }]) {
        expect((await GET(request('', headers))).status).toBe(401);
    }
    expect(connectDB).not.toHaveBeenCalled();
    expect(listLowConfidenceTors).not.toHaveBeenCalled();
});
it('denies ordinary sessions and expired admin sessions', async () => {
    const user = await signSession({ sub: 'user', role: 'user' });
    expect((await GET(request('', { cookie: `${SESSION_COOKIE}=${user}` }))).status).toBe(403);
    const expired = await new SignJWT({ sub: 'expired', role: 'admin' }).setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(1).sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect((await GET(request('', { cookie: `${SESSION_COOKIE}=${expired}` }))).status).toBe(401);
    expect(connectDB).not.toHaveBeenCalled();
});
it('accepts admin sessions and configured operator bearer tokens', async () => {
    const admin = await signSession({ sub: 'admin', role: 'admin' });
    for (const headers of [{ cookie: `${SESSION_COOKIE}=${admin}` }, { Authorization: `Bearer ${token}` }]) {
        const response = await GET(request('', headers));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toContain('no-store');
        expect(response.headers.get('vary')).toBe('Cookie, Authorization');
    }
    expect(listLowConfidenceTors).toHaveBeenCalledWith({ page: 1, pageSize: 20, confidenceType: 'either' });
});
it('fails closed for unset or too-short operator tokens', async () => {
    for (const value of ['', 'short']) {
        vi.stubEnv('PIPELINE_ADMIN_TOKEN', value);
        expect((await GET(request('', { Authorization: `Bearer ${value}` }))).status).toBe(401);
    }
    expect(connectDB).not.toHaveBeenCalled();
});
it('passes validated page parameters and confidence basis to the database service', async () => {
    await GET(request('?page=2&pageSize=5&confidenceType=extraction', { Authorization: `Bearer ${token}` }));
    expect(listLowConfidenceTors).toHaveBeenCalledWith({ page: 2, pageSize: 5, confidenceType: 'extraction' });
});
it('rejects invalid or unbounded pagination and arbitrary confidence selectors', async () => {
    for (const query of ['?page=0', '?page=1.5', '?page=1000001', '?pageSize=101', '?pageSize=NaN', '?confidenceType=unknown']) {
        expect((await GET(request(query, { Authorization: `Bearer ${token}` }))).status).toBe(400);
    }
    expect(connectDB).not.toHaveBeenCalled();
});
it('database failure does not leak internal errors or credentials', async () => {
    listLowConfidenceTors.mockRejectedValueOnce(new Error('sensitive internal detail'));
    const response = await GET(request('', { Authorization: `Bearer ${token}` }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
});
