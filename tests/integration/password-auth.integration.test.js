import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { verifySession } from '@/lib/auth';
import { hashPassword, verifyPassword, emailFilter, safeAuthDestination } from '@/lib/password-auth';

const state = vi.hoisted(() => ({ users: [], fail: false }));
vi.mock('@/lib/db', () => ({ default: vi.fn(async () => { if (state.fail) throw new Error('private database detail'); }) }));
vi.mock('@/models/User', () => ({ User: {
    init: vi.fn().mockResolvedValue(undefined),
    findOne: vi.fn(filter => ({ select: vi.fn(async () => (filter.username
        ? state.users.find(u => u.username === filter.username)
        : state.users.find(u => new RegExp(filter.email.$regex, 'i').test(u.email))) || null) })),
    create: vi.fn(async data => {
        if (state.users.some(u => u.email === data.email)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        if (data.username && state.users.some(u => u.username === data.username)) throw Object.assign(new Error('duplicate'), { code: 11000, keyPattern: { username: 1 } });
        const user = { ...data, _id: randomUUID() }; state.users.push(user); return user;
    }),
    findById: vi.fn(id => ({ lean: async () => state.users.find(u => u._id === id) })),
} }));
const { POST: register } = await import('@/app/api/auth/register/route');
const { POST: login } = await import('@/app/api/auth/login/route');
const { GET: me } = await import('@/app/api/auth/me/route');
const { User } = await import('@/models/User');
const password = 'A long local test passphrase!';
let counter = 0;
let address;
beforeEach(() => { state.users = []; state.fail = false; vi.clearAllMocks(); address = `test-${++counter}`; });
function request(path, body, extra = {}) {
    return new NextRequest(`http://localhost:3000/api/auth/${path}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'x-forwarded-for': address, ...extra },
        body: JSON.stringify(body) });
}
const details = () => ({ name: 'Local Tester', email: `local${counter}@example.com`, password });

it('registers, stores only a salted hash, signs in with scopes, and reuses the same account on login', async () => {
    const data = details();
    delete data.name;
    const response = await register(request('register', { ...data, email: `  ${data.email.toUpperCase()}  `, role: 'admin', scopes: ['admin:write'], next: '/profile' }));
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result.redirectTo).toBe('/profile');
    expect(result.user.role).toBe('user');
    expect(result.user.name).toBeNull();
    expect(JSON.stringify(result)).not.toContain('password');
    expect(state.users[0].password).toBeUndefined();
    expect(state.users[0].passwordHash).toMatch(/^scrypt\$v1\$/);
    expect(state.users[0].passwordHash).not.toContain(password);
    const cookie = response.cookies.get('mtn_session').value;
    const session = await verifySession(cookie);
    expect(session.scopes).toContain('profile:write');
    expect(session.scopes).not.toContain('admin:write');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=lax/i);
    const loggedIn = await login(request('login', { email: data.email.toUpperCase(), password }));
    expect(loggedIn.status).toBe(200);
    expect((await loggedIn.json()).user.id).toBe(result.user.id);
    expect(state.users).toHaveLength(1);
    const who = await me(new NextRequest('http://localhost:3000/api/auth/me', { headers: { Cookie: `mtn_session=${cookie}` } }));
    expect(who.status).toBe(200);
    expect((await who.json()).user.email).toBe(data.email);
});

it('uses distinct salts and rejects wrong, missing and malformed stored hashes', async () => {
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword('Another long wrong password!', a)).toBe(false);
    expect(await verifyPassword(password, undefined)).toBe(false);
    expect(await verifyPassword(password, 'scrypt$invalid')).toBe(false);
});

it('returns the same login failure for absent, Google-only and wrong-password accounts', async () => {
    const data = details();
    const absent = await login(request('login', data));
    state.users.push({ email: data.email, googleId: 'google-123', _id: 'google', role: 'user' });
    const google = await login(request('login', data));
    state.users[0].passwordHash = await hashPassword('A completely different password!');
    const wrong = await login(request('login', data));
    expect([absent.status, google.status, wrong.status]).toEqual([401, 401, 401]);
    expect(await absent.json()).toEqual(await google.json());
    expect(await wrong.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'อีเมล/ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือโปรดใช้ Google หากสมัครด้วย Google' } });
});

it('rejects duplicate/legacy-case Google registration without changing existing credentials', async () => {
    const data = details();
    state.users.push({ email: data.email.toUpperCase(), googleId: 'original' });
    const result = await register(request('register', data));
    expect(result.status).toBe(409);
    expect(User.create).not.toHaveBeenCalled();
    expect(state.users[0].passwordHash).toBeUndefined();
    expect(new RegExp(emailFilter('a+b@example.com').email.$regex, 'i').test('aab@example.com')).toBe(false);
});

it('handles concurrent registration through the unique email constraint', async () => {
    const data = details();
    const responses = await Promise.all([register(request('register', data)), register(request('register', data))]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(state.users).toHaveLength(1);
});

it('blocks weak inputs, malformed/oversized bodies and cross-origin requests before database writes', async () => {
    expect((await register(request('register', { ...details(), password: 'short' }))).status).toBe(400);
    expect((await register(request('register', { ...details(), email: { $ne: null } }))).status).toBe(400);
    expect((await register(request('register', details(), { Origin: 'https://evil.example' }))).status).toBe(403);
    expect((await register(request('register', details(), { Origin: '' }))).status).toBe(403);
    expect((await register(request('register', { ...details(), name: 'x'.repeat(9000) }))).status).toBe(413);
    expect(User.create).not.toHaveBeenCalled();
});

it('rate limits repeated account attempts and returns retry-after', async () => {
    const data = details();
    for (let i = 0; i < 10; i++) expect((await register(request('register', { ...data, name: 'x'.repeat(101) }))).status).toBe(400);
    const blocked = await login(request('login', data));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
});

it('does not disclose database errors or accept external redirects', async () => {
    state.fail = true;
    const response = await login(request('login', details()));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private');
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example']) expect(safeAuthDestination(value)).toBe('/dashboard');
    expect(safeAuthDestination('/tors/123?tab=summary')).toBe('/tors/123?tab=summary');
});

it('stores a normalized username on registration and returns it', async () => {
    const response = await register(request('register', { ...details(), username: '  Money.Tam_01 ' }));
    expect(response.status).toBe(201);
    expect((await response.json()).user.username).toBe('money.tam_01');
    expect(state.users[0].username).toBe('money.tam_01');
});
it('derives a unique username from the email when none is supplied', async () => {
    const first = await register(request('register', { email: 'somchai@example.com', password }));
    expect((await first.json()).user.username).toBe('somchai');
    address = `test-${++counter}`;
    const second = await register(request('register', { email: 'somchai@example.org', password }));
    expect(second.status).toBe(201);
    expect((await second.json()).user.username).toBe('somchai-2');
});
it('rejects invalid or reserved usernames and reports taken ones as 409', async () => {
    for (const username of ['ab', 'has space', 'admin', '-bad-', 'x'.repeat(31), 42]) {
        address = `test-${++counter}`;
        const response = await register(request('register', { ...details(), username }));
        expect(response.status, String(username)).toBe(400);
        expect((await response.json()).error.code).toBe('INVALID_USERNAME');
    }
    expect(state.users).toHaveLength(0);
    await register(request('register', { ...details(), username: 'taken_name' }));
    address = `test-${++counter}`;
    const clash = await register(request('register', { email: 'other@example.com', password, username: 'Taken_Name' }));
    expect(clash.status).toBe(409);
    expect((await clash.json()).error.code).toBe('USERNAME_TAKEN');
    expect(state.users).toHaveLength(1);
});

it('logs in with a username (any case) or an email, with the same result', async () => {
    const data = details();
    const created = await (await register(request('register', { ...data, username: 'Login_User' }))).json();
    address = `test-${++counter}`;
    const byUsername = await login(request('login', { identifier: '  LOGIN_user ', password }));
    expect(byUsername.status).toBe(200);
    expect((await byUsername.json()).user.id).toBe(created.user.id);
    address = `test-${++counter}`;
    const byEmail = await login(request('login', { identifier: data.email, password }));
    expect(byEmail.status).toBe(200);
    address = `test-${++counter}`;
    expect((await login(request('login', { email: data.email, password }))).status).toBe(200); // legacy field
});
it('gives unknown usernames, wrong passwords and Google-only users the same 401', async () => {
    await register(request('register', { ...details(), username: 'real_user' }));
    state.users.push({ _id: randomUUID(), email: 'g@example.com', username: 'google_user' });
    const responses = [];
    for (const identifier of ['nobody_here', 'real_user', 'google_user']) {
        address = `test-${++counter}`;
        responses.push(await login(request('login', { identifier, password: identifier === 'real_user' ? 'Another long wrong passphrase!' : password })));
    }
    expect(responses.map(r => r.status)).toEqual([401, 401, 401]);
    const bodies = await Promise.all(responses.map(r => r.json()));
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
});
it('rejects malformed login identifiers before touching the database', async () => {
    for (const identifier of ['ab', 'has space', '{"$ne":null}', undefined, 42]) {
        address = `test-${++counter}`;
        const response = await login(request('login', { identifier, password }));
        expect(response.status, String(identifier)).toBe(400);
    }
    expect(User.findOne).not.toHaveBeenCalled();
});
it('shares one attempt budget per account across email and username', async () => {
    const data = details();
    await register(request('register', { ...data, username: 'budget_user' }));
    const statuses = [];
    // Each request comes from a fresh address, so only the per-account budget can trip.
    for (let i = 0; i < 12; i += 1) {
        address = `test-${++counter}`;
        const identifier = i % 2 ? data.email : 'budget_user';
        statuses.push((await login(request('login', { identifier, password: 'Wrong but long enough passphrase' }))).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses).toContain(429);
});
