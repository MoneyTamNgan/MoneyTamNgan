import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signSession } from '@/lib/auth';
import { validateProfileUpdates, publicContractorProfile } from '@/lib/profile-validation';
vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('@/models/User', () => ({ User: { findById: vi.fn(), findByIdAndUpdate: vi.fn() } }));
const { User } = await import('@/models/User');
const { GET, PUT } = await import('@/app/api/profiles/route');
let records;
const valid = { registration_number: ' 0105555555555 ', address: ' 1 Bangkok ', authorized_signatory: ' Somchai ',
    past_projects: [{ name: ' System A ', client: ' Agency ', value: 0, year: 2569, passwordHash: 'ignored', role: 'admin' }] };
const call = async (method, body, sub = 'ownerA') => {
    const token = sub ? await signSession({ sub, role: 'user' }) : '';
    const req = new Request('http://localhost:3000/api/profiles?userId=ownerB', { method,
        headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    return (method === 'GET' ? GET : PUT)(req);
};
beforeEach(() => {
    vi.clearAllMocks();
    records = new Map([
        ['ownerA', { _id: 'ownerA', email: 'a@example.test', googleId: 'secret-google', passwordHash: 'secret-password' }],
        ['ownerB', { _id: 'ownerB', email: 'b@example.test', company_name: 'Victim' }],
    ]);
    User.findById.mockImplementation(id => ({ select: () => ({ lean: async () => records.get(id) }) }));
    User.findByIdAndUpdate.mockImplementation((id, update) => ({ select: () => ({ lean: async () => {
        const user = records.get(id); if (!user) return null;
        Object.assign(user, update.$set); return user;
    } }) }));
});
describe('#136 company bid details', () => {
    it('defaults legacy users without leaking auth identifiers', async () => {
        const response = await call('GET'); const { data } = await response.json();
        expect(data).toMatchObject({ registration_number: '', address: '', authorized_signatory: '', past_projects: [] });
        expect(data).not.toHaveProperty('googleId'); expect(data).not.toHaveProperty('passwordHash');
    });
    it('PUT persists trimmed values, reloads, edits/removes rows, and ignores injected identifiers', async () => {
        const response = await call('PUT', { ...valid, role: 'admin', passwordHash: 'attack', userId: 'ownerB', _id: 'ownerB' });
        expect(response.status).toBe(200);
        const { data } = await (await call('GET')).json();
        expect(data).toMatchObject({ registration_number: '0105555555555', address: '1 Bangkok', authorized_signatory: 'Somchai',
            past_projects: [{ name: 'System A', client: 'Agency', value: 0, year: 2569 }] });
        expect(records.get('ownerB').company_name).toBe('Victim');
        expect(records.get('ownerA').passwordHash).toBe('secret-password');
        expect(records.get('ownerA').role).toBeUndefined();
        expect((await call('PUT', { past_projects: [] })).status).toBe(200);
        expect((await (await call('GET')).json()).data.past_projects).toEqual([]);
        expect(User.findByIdAndUpdate.mock.calls.every(([id]) => id === 'ownerA')).toBe(true);
    });
    it('anonymous read and write return 401', async () => {
        expect((await call('GET', undefined, null)).status).toBe(401);
        expect((await call('PUT', valid, null)).status).toBe(401);
        expect(User.findById).not.toHaveBeenCalled(); expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });
    it.each([
        { address: 123 }, { registration_number: null }, { authorized_signatory: {} },
        { past_projects: 'bad' }, { past_projects: Array(51).fill(valid.past_projects[0]) },
        { address: 'x'.repeat(2001) }, { past_projects: [{ ...valid.past_projects[0], value: -1 }] },
        { past_projects: [{ ...valid.past_projects[0], value: '100' }] },
        { past_projects: [{ ...valid.past_projects[0], year: 2569.5 }] },
        { past_projects: [{ ...valid.past_projects[0], year: 9999 }] },
        { past_projects: [{ ...valid.past_projects[0], name: ' ' }] },
        { past_projects: [{ ...valid.past_projects[0], client: 123 }] },
        { registered_capital: -1 }, { skills: [42] }, { match_score_threshold: 101 },
    ])('returns clear field errors for invalid values: %j', async invalid => {
        const response = await call('PUT', invalid);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { code: 'INVALID_PROFILE', fields: expect.any(Object) } });
        expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });
    it('bounds requests and returns a structured code for malformed JSON', async () => {
        const token = await signSession({ sub: 'size-test', role: 'user' });
        const request = body => new Request('http://localhost:3000/api/profiles', { method: 'PUT',
            headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body });
        expect((await PUT(request('{bad'))).status).toBe(400);
        expect((await PUT(request(JSON.stringify({ address: 'x'.repeat(128 * 1024) })))).status).toBe(413);
    });
    it('does not coerce NaN, Infinity, numeric strings or unknown nested fields', () => {
        for (const value of [NaN, Infinity, '100', true]) expect(validateProfileUpdates({ registered_capital: value }).errors).toHaveProperty('registered_capital');
        const clean = validateProfileUpdates(valid);
        expect(clean.errors).toEqual({}); expect(clean.updates.past_projects[0]).not.toHaveProperty('passwordHash');
        expect(publicContractorProfile({ _id: 'old' }).past_projects).toEqual([]);
    });
});
