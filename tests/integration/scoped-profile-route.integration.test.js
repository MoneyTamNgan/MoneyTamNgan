import { beforeEach, expect, it, vi } from 'vitest';
import { signSession } from '@/lib/auth';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/models/User', () => ({ User: {
    findById: vi.fn(), findByIdAndUpdate: vi.fn(), findByIdAndDelete: vi.fn(),
} }));
const { User } = await import('@/models/User');
const { default: connectDB } = await import('@/lib/db');
const { PATCH } = await import('@/app/api/profiles/route');
const fixture = { _id: 'owner', email: 'fixture@example.test', name: 'Owner' };
beforeEach(() => {
    vi.clearAllMocks();
    User.findByIdAndUpdate.mockReturnValue({ select: () => ({ lean: async () => fixture }) });
});
const patch = (headers, body = {}) => PATCH(new Request('http://localhost:3000/api/profiles', {
    method: 'PATCH', headers: { Origin: 'http://localhost:3000', ...headers }, body: JSON.stringify(body),
}));
it('validates real JWT profile:write and only updates its owner despite injected IDs/roles', async () => {
    const Authorization = `Bearer ${await signSession({ sub: 'owner', role: 'user' })}`;
    expect((await patch({ Authorization }, { _id: 'victim', userId: 'victim', role: 'admin', scopes: ['admin:write'], name: 'Changed' })).status).toBe(200);
    const [id, update] = User.findByIdAndUpdate.mock.calls[0];
    expect(id).toBe('owner');
    expect(update.$set.name).toBe('Changed');
    expect(update.$set).not.toHaveProperty('role');
    expect(update.$set).not.toHaveProperty('scopes');
});
it('does not switch identity when bearer and cookie belong to different users', async () => {
    const Authorization = `Bearer ${await signSession({ sub: 'owner', role: 'user' })}`;
    const cookie = `mtn_session=${await signSession({ sub: 'other-user', role: 'user' })}`;
    expect((await patch({ Authorization, cookie })).status).toBe(200);
    expect(User.findByIdAndUpdate.mock.calls[0][0]).toBe('owner');
});
it('denies a read-only profile JWT before opening the database', async () => {
    const Authorization = `Bearer ${await signSession({ sub: 'owner', role: 'user', scopes: ['profile:read'] })}`;
    expect((await patch({ Authorization })).status).toBe(403);
    expect(connectDB).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
});
